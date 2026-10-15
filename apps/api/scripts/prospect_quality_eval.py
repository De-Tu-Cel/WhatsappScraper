"""Evaluate frozen prospect candidates against independent website reviews.

Default is offline. --replay invokes only the configured LLM search filters,
never discovery providers, MongoDB, processing jobs or WhatsApp.
"""
import argparse
from collections import Counter
import hashlib
import html
import json
from pathlib import Path
import sys
import time


def measure(labels, accepted_ids):
    ids = {row['id'] for row in labels}
    if len(ids) != len(labels) or not set(accepted_ids) <= ids:
        raise ValueError('Duplicate labels or accepted candidates without a review')
    allowed = {'confirmed', 'invalid', 'inconclusive'}
    if any(row['review_status'] not in allowed for row in labels):
        raise ValueError('Invalid review status')
    total = Counter(row['review_status'] for row in labels)
    accepted = Counter(row['review_status'] for row in labels if row['id'] in accepted_ids)
    n = sum(accepted.values())
    clear = accepted['confirmed'] + accepted['invalid']
    return {
        'candidates': len(labels), 'reviewed': dict(total), 'accepted': n,
        'accepted_review': {key: accepted[key] for key in sorted(allowed)},
        'precision_on_conclusive_reviews': accepted['confirmed'] / clear if clear else None,
        'confirmed_share_of_all_accepted': accepted['confirmed'] / n if n else None,
        'precision_upper_if_all_inconclusive_are_valid': (accepted['confirmed'] + accepted['inconclusive']) / n if n else None,
        'recall_within_reviewed_sample': accepted['confirmed'] / total['confirmed'] if total['confirmed'] else None,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--replay', action='store_true')
    args = parser.parse_args()
    directory = args.directory.resolve()
    raw_labels = (directory / 'quality-labels.json').read_bytes()
    labels = json.loads(raw_labels)
    replay_path = directory / 'quality-replay.json'
    if args.replay:
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from app import searcher, llm
        if llm.active_provider() == 'none':
            raise RuntimeError('Cannot evaluate live filters without a configured LLM')
        calls = []
        original_call = llm.call_llm

        def traced_call(*a, **kw):
            if len(calls) >= 24:
                raise RuntimeError('Evaluation call budget exhausted')
            entry = {'ok': False}
            calls.append(entry)
            start = time.perf_counter()
            try:
                result = original_call(*a, **kw)
                entry['ok'] = True
                return result
            finally:
                entry['seconds'] = round(time.perf_counter() - start, 3)

        llm.call_llm = traced_call
        replay = {'labels_sha256': hashlib.sha256(raw_labels).hexdigest(),
                  'provider': llm.active_provider(), 'model': llm.OPENAI_MODEL if llm.active_provider() == 'openai' else llm.DEEPSEEK_MODEL,
                  'calls': calls, 'cities': []}
        for city in dict.fromkeys(row['city'] for row in labels):
            rows = [row for row in labels if row['city'] == city]
            snippets = {row['url']: {'title': row['title'], 'body': row['body']} for row in rows}
            urls = [row['url'] for row in rows]
            stages = {}
            degraded = []
            start = time.perf_counter()
            urls = searcher._ai_filter_urls(urls, rows[0]['industry'], snippets, rows[0]['country'])
            stages['industry'] = list(urls)
            urls = searcher._reject_wrong_country(urls, snippets, rows[0]['country'], city=city, degraded=degraded)
            stages['geography'] = list(urls)
            urls = searcher._reject_directories_and_institutions(urls, snippets, degraded=degraded)
            stages['directories'] = list(urls)
            replay['cities'].append({'city': city, 'seconds': round(time.perf_counter() - start, 3),
                                     'stages': stages, 'degraded': degraded,
                                     'accepted_ids': [row['id'] for row in rows if row['url'] in urls]})
            replay_path.write_text(json.dumps(replay, ensure_ascii=False, indent=2), encoding='utf-8')
            print(city, len(rows), '->', len(urls), flush=True)
    replay = json.loads(replay_path.read_text(encoding='utf-8'))
    if replay['labels_sha256'] != hashlib.sha256(raw_labels).hexdigest():
        raise ValueError('Reviews changed after replay; rerun with a frozen review set')
    expected_cities = {row['city'] for row in labels}
    if {city['city'] for city in replay['cities']} != expected_cities or len(replay['cities']) != len(expected_cities):
        raise ValueError('Incomplete or duplicated city replay; finish evaluation before reporting')
    accepted_ids = {ident for city in replay['cities'] for ident in city['accepted_ids']}
    report = {'overall': measure(labels, accepted_ids),
              'replay': {'provider': replay['provider'], 'model': replay['model'],
                         'llm_calls': len(replay['calls']), 'failed_calls': sum(not call['ok'] for call in replay['calls']),
                         'labels_sha256': replay['labels_sha256'],
                         'stages': {city['city']: {stage: len(urls) for stage, urls in city['stages'].items()} for city in replay['cities']},
                         'degraded': {city['city']: city['degraded'] for city in replay['cities']}},
              'cities': {city: measure([row for row in labels if row['city'] == city], accepted_ids & {row['id'] for row in labels if row['city'] == city}) for city in dict.fromkeys(row['city'] for row in labels)},
              'limitations': ['Assistant review of website evidence, not a human gold standard or legal identity check.',
                              'Frozen DuckDuckGo sample: three cities, two business sectors, not all providers or countries.',
                              'Inconclusive reviews are not valid leads; precision bounds are not confidence intervals.',
                              'Replay tests snippet filters, not the end-to-end extraction/saving pipeline.',
                              'Recall is restricted to this reviewed sample, not market coverage.',
                              'No WhatsApp registration or contact operability was tested.']}
    diagnosis_path = directory / 'quality-deterministic-diagnosis.json'
    if diagnosis_path.exists():
        report['deterministic_diagnosis'] = json.loads(diagnosis_path.read_text(encoding='utf-8'))
    (directory / 'quality-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    for name, selected in [('accepted', True), ('rejected', False)]:
        (directory / ('quality-' + name + '.json')).write_text(json.dumps([row for row in labels if (row['id'] in accepted_ids) == selected], ensure_ascii=False, indent=2), encoding='utf-8')
    rows_html = ''.join('<tr><td>' + '</td><td>'.join(html.escape(str(value)) for value in [row['city'], row['url'], row['review_status'], 'Aceptado' if row['id'] in accepted_ids else 'Excluido', row['reason']]) + '</td></tr>' for row in labels)
    page = '<!doctype html><html lang="es"><meta charset="utf-8"><title>Evaluación del buscador</title><style>body{font:15px system-ui;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px;text-align:left}pre{white-space:pre-wrap}</style><h1>Evaluación del buscador · 9 octubre 2026</h1><p>Revisión del asistente sobre evidencia pública. No equivale a una revisión humana ni garantiza autenticidad legal.</p><pre>' + html.escape(json.dumps(report, ensure_ascii=False, indent=2)) + '</pre><table><tr><th>Ciudad</th><th>Sitio</th><th>Evidencia</th><th>Filtro</th><th>Motivo</th></tr>' + rows_html + '</table></html>'
    (directory / 'quality-report.html').write_text(page, encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True))


if __name__ == '__main__':
    main()
