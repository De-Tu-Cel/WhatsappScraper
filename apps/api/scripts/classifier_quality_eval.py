"""Read-only comparison against a frozen, independently labelled BSON snapshot.

Usage: python scripts/classifier_quality_eval.py SNAPSHOT LABELS OUTPUT
No database connection is opened. Conversation data and model outputs are private;
keep the output in an ignored directory. Assistant labels are an audit reference,
not human-verified ground truth or a production accuracy estimate.
"""
import argparse
import copy
import csv
import hashlib
import json
from pathlib import Path
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from bson import json_util
from app import config, classifier, classification_compare as compare, llm


def metrics(rows, labels, method):
    scored = [(labels[r['id']]['label'],
               None if r[method].get('error') else r[method].get('common')) for r in rows
              if labels[r['id']]['confidence'] == 'clear']
    categories = sorted({a for a, _ in scored})
    per_category = {}
    for cat in categories:
        tp = sum(a == b == cat for a, b in scored)
        actual = sum(a == cat for a, b in scored)
        predicted = sum(b == cat for a, b in scored)
        precision = tp / predicted if predicted else 0
        recall = tp / actual if actual else 0
        per_category[cat] = dict(support=actual, precision=precision, recall=recall,
                                f1=2*precision*recall/(precision+recall) if precision+recall else 0)
    return dict(n=len(scored), correct=sum(a == b for a, b in scored),
                accuracy=sum(a == b for a, b in scored)/len(scored) if scored else None,
                macro_f1=sum(x['f1'] for x in per_category.values())/len(categories) if categories else None,
                compatible=sum(compare._same(a, b) is True for a, b in scored),
                per_category=per_category,
                confusion={a: {str(b): sum(x == a and y == b for x, y in scored)
                               for b in {y for x, y in scored if x == a}} for a in categories})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('labels', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--reuse-cache', type=Path,
                        help='Reuse identical model requests from an earlier run.')
    parser.add_argument('--provider', choices=['openai','deepseek','anthropic'],
                        help='Evaluate a provider without changing production or Chat IA.')
    parser.add_argument('--model', help='Model override for this isolated evaluation.')
    parser.add_argument('--limit', type=int, help='Limit the number of conversations (positive).')
    parser.add_argument('--with-range', action='store_true', help='Also evaluate resemblance ranges on replied threads.')
    args = parser.parse_args()
    snapshot = json_util.loads(args.snapshot.read_text(encoding='utf-8'))
    code_hashes = {str(path.name): hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in [Path(classifier.__file__), Path(compare.__file__)]}
    labels = json.loads(args.labels.read_text(encoding='utf-8'))
    if {c['id'] for c in snapshot['cases']} != set(labels):
        parser.error('Snapshot and reference IDs must match exactly.')
    if args.limit is not None:
        if args.limit <= 0:
            parser.error('--limit must be positive')
        snapshot['cases'] = snapshot['cases'][:args.limit]
    if args.model:
        config.CLASSIFIER_MODEL = args.model
    eval_provider = args.provider or llm.active_provider()
    if not llm.provider_credentials(eval_provider):
        parser.error('Selected provider has no configured API key.')
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'progress.jsonl').write_text('', encoding='utf-8')
    context = threading.local()

    class FrozenManager:
        def __init__(self):
            self.db = self
            self.message_logs = self

        def find(self, *args, **kwargs):
            return []  # Failed-send diagnostics only; conversation comes from snapshot.

        def get_classifier_notes(self):
            return copy.deepcopy(snapshot['industry_notes'])

        def get_classifier_settings(self):
            return copy.deepcopy(snapshot['settings'])

    classifier.MongoDBManager = FrozenManager
    compare._messages = lambda db, cid, limit=0, number=None: copy.deepcopy(
        context.case['messages'][:limit] if limit else context.case['messages'])
    original_call = llm.call_llm
    cache_path = args.output / 'llm-cache.json'
    cache = json.loads(cache_path.read_text(encoding='utf-8')) if cache_path.exists() else {}
    if args.reuse_cache:
        cache.update(json.loads(args.reuse_cache.read_text(encoding='utf-8')))
    cache_lock = threading.Lock()
    usage = {'requests': 0, 'input_tokens': 0, 'output_tokens': 0}
    if eval_provider == 'anthropic':
        original_post = llm.requests.post
        def observed_post(url, **kwargs):
            response = original_post(url, **kwargs)
            if url == 'https://api.anthropic.com/v1/messages' and response.ok:
                data = response.json().get('usage') or {}
                with cache_lock:
                    usage['requests'] += 1
                    usage['input_tokens'] += data.get('input_tokens', 0)
                    usage['output_tokens'] += data.get('output_tokens', 0)
            return response
        llm.requests.post = observed_post

    def cached_call(messages, **kwargs):
        if args.provider:
            kwargs['provider'] = args.provider
        key = hashlib.sha256(json.dumps(dict(provider=eval_provider, messages=messages,
                                            kwargs=kwargs), sort_keys=True).encode()).hexdigest()
        with cache_lock:
            cached = cache.get(key)
        if cached is not None:
            return cached
        result = original_call(messages, **kwargs)
        with cache_lock:
            cache[key] = result
            cache_path.write_text(json.dumps(cache, ensure_ascii=False), encoding='utf-8')
        return result

    llm.call_llm = cached_call

    def evaluate(case):
        context.case = case
        db = FrozenManager()
        row = {k: case[k] for k in ('id', 'name', 'source', 'snapshot_hash')}
        row['timing'] = compare.run_timing(db, case['company_id'], now=snapshot['created_at'])
        row['ia'] = compare.run_ai_only(db, case['company_id'])
        trace = []
        analysis = classifier.classify_conversation(case['company_id'], case['name'],
                        case['industry'], trace=trace, messages=copy.deepcopy(case['messages']), with_thread=args.with_range)
        row['before_last_message'] = copy.deepcopy(analysis)
        last = next((m.get('message_body') or '' for m in reversed(case['messages'])
                     if m['direction'] == 'inbound'), '')
        analysis = classifier._apply_last_message_corrections(analysis, last, trace)
        if args.with_range:
            compare.finish_parecido(analysis, case['name'], case['industry'])
        row['hibrido'] = compare._hybrid_result(analysis, trace)
        return row

    rows = []
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = {pool.submit(evaluate, case): case for case in snapshot['cases']}
        for job in as_completed(jobs):
            case = jobs[job]
            try:
                row = job.result()
            except Exception as exc:
                row = dict(id=case['id'], name=case['name'], source=case['source'],
                           error=f'{type(exc).__name__}: {exc}',
                           **{m: {'common': None, 'error': True} for m in compare.METHODS})
            rows.append(row)
            with (args.output / 'progress.jsonl').open('a', encoding='utf-8') as out:
                out.write(json_util.dumps(row, ensure_ascii=False) + '\n')
            print(f"{len(rows)}/{len(jobs)} {case['id']} " +
                  ' '.join(f"{m}={row[m].get('common')}" for m in compare.METHODS), flush=True)
    rows.sort(key=lambda r: r['id'])
    summary = {}
    for group, subset in [('all_clear_audit', rows),
                          ('team_confirmed', [r for r in rows if r['source'] == 'team_confirmed']),
                          ('new_review', [r for r in rows if r['source'] == 'new_review'])]:
        summary[group] = {m: metrics(subset, labels, m) for m in compare.METHODS}
    summary['limitations'] = ['Only team_confirmed labels were confirmed by a person.',
                             'Other labels are an assistant audit; ambiguous cases excluded.',
                             'Earlier samples were previously used to tune the classifier.',
                             'New sample is small and concentrated in Gas companies.']
    summary['model'] = config.CLASSIFIER_MODEL
    summary['provider'] = eval_provider
    summary['usage'] = usage
    summary['code_sha256'] = code_hashes
    summary['snapshot_sha256'] = hashlib.sha256(args.snapshot.read_bytes()).hexdigest()
    summary['labels_sha256'] = hashlib.sha256(args.labels.read_bytes()).hexdigest()
    (args.output/'results.json').write_text(json_util.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
    (args.output/'metrics.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    with (args.output/'review.csv').open('w', encoding='utf-8-sig', newline='') as out:
        writer = csv.writer(out)
        writer.writerow(['ID', 'Empresa', 'Origen', 'Certeza de referencia', 'Referencia',
                         'Alternativas por revisar', 'Timing', 'IA', 'Timing + IA',
                         'Motivo de referencia', 'Diagnóstico Timing + IA'])
        for row in rows:
            ref = labels[row['id']]
            writer.writerow([row['id'], row['name'], row['source'], ref['confidence'], ref.get('label'),
                             ' / '.join(ref['allowed_labels']),
                             *(row[m].get('common') for m in compare.METHODS), ref['reason'],
                             row['hibrido'].get('notes', '')])
    print(json.dumps({g: {m: {k: v for k, v in value.items() if k in ('n', 'correct', 'accuracy', 'macro_f1')}
                          for m, value in vals.items()} for g, vals in summary.items() if isinstance(vals, dict) and g not in ('code_sha256','usage')}, indent=2))
    print(json.dumps({'provider':eval_provider, 'model':config.CLASSIFIER_MODEL, 'usage':usage}))


if __name__ == '__main__':
    main()
