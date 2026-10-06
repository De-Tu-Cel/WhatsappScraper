"""
Práctica del clasificador con conversaciones reales.

classifier_cases.json guarda solo el nombre de la empresa y la clasificación
correcta (confirmada a mano) — el hilo se lee de Mongo al correr, así que no se
sube contenido de producción al repo. El script corre el mismo análisis de
conversación completa que prod (classify_conversation + las correcciones por el
último mensaje) y dice cuántos acierta. Solo lectura: no guarda nada.

Cada vez que alguien encuentre un chat mal clasificado, se agrega aquí con la
etiqueta correcta, se ajusta el clasificador y se vuelve a correr para confirmar
que el caso nuevo pasa sin romper los anteriores.

Manual-run, llamadas reales al LLM — deliberadamente NO se llama test_*.py.

Uso (desde apps/api):
  python scripts/classifier_real_cases.py                       # todos los casos
  python scripts/classifier_real_cases.py --solo "Fame Querétaro"
  python scripts/classifier_real_cases.py --agregar "Empresa" humano "por qué"

Etiquetas (las de Análisis): humano · automatico_humano · automatico_sin_respuesta ·
bot · agente_ia. "Bot + Humano" cuenta como automatico_humano, igual que en la comparación.
"""
import argparse
import json
import os
import sys

API = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(API, "app"), API]
os.chdir(API)

CASES = os.path.join(API, "scripts", "classifier_cases.json")
LABELS = ("humano", "automatico_humano", "automatico_sin_respuesta", "bot", "agente_ia")


def label_of(analysis: dict) -> str:
    from app.classification_compare import to_common
    return to_common(analysis.get("category"), analysis.get("is_ai")) or "?"


def find_company(db, name: str) -> dict | None:
    return db.companies.find_one({"name": name}, {"name": 1, "industry": 1})


def classify(db, company: dict) -> dict:
    from app.classifier import classify_conversation, _apply_last_message_corrections
    cid = str(company["_id"])
    analysis = classify_conversation(cid, company["name"], company.get("industry", ""))
    last = db.message_logs.find_one({"company_id": cid, "direction": "inbound"},
                                    {"message_body": 1}, sort=[("created_at", -1)])
    return _apply_last_message_corrections(analysis, (last or {}).get("message_body") or "")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--solo", help="correr solo esta empresa")
    ap.add_argument("--agregar", nargs=3, metavar=("EMPRESA", "ETIQUETA", "MOTIVO"),
                    help="agregar un caso confirmado a classifier_cases.json")
    args = ap.parse_args()

    from app.database import MongoDBManager
    db = MongoDBManager().db
    cases = json.load(open(CASES, encoding="utf-8"))

    if args.agregar:
        name, expected, why = args.agregar
        if expected not in LABELS:
            sys.exit(f"Etiqueta inválida '{expected}' — usa una de: {', '.join(LABELS)}")
        if not find_company(db, name):
            sys.exit(f"No encontré la empresa '{name}' (el nombre debe ser exacto).")
        cases = [c for c in cases if c["empresa"] != name] + [{"empresa": name, "esperado": expected, "motivo": why}]
        with open(CASES, "w", encoding="utf-8") as f:
            json.dump(cases, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print(f"Agregado: {name} → {expected}")
        return

    if args.solo:
        cases = [c for c in cases if c["empresa"] == args.solo]
    ok = 0
    for c in cases:
        company = find_company(db, c["empresa"])
        if not company:
            print(f"  ?  {c['empresa'][:42]:42} no existe en la base")
            continue
        analysis = classify(db, company)
        got = label_of(analysis)
        ok += got == c["esperado"]
        mark = "✓" if got == c["esperado"] else "✗"
        print(f"  {mark}  {c['empresa'][:42]:42} esperado {c['esperado']:24} obtuvo {got}")
        if got != c["esperado"]:
            print(f"       nota: {(analysis.get('notes') or '')[:220]}")
    print(f"\nAciertos: {ok}/{len(cases)}")


if __name__ == "__main__":
    main()
