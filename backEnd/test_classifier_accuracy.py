"""
Analiza la exactitud y distribucion del clasificador en datos reales.
Ejecutar: cd backEnd && python test_classifier_accuracy.py
"""
import sys, os, io
sys.path.insert(0, '.')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app'))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from app.database import MongoDBManager
from app.classifier import _quick_classify

db = MongoDBManager()
logs = db.db.message_logs

# ─── 1. Cuantos mensajes inbound tienen clasificacion ────────────────────────
total_inbound = logs.count_documents({"direction": "inbound"})
classified    = logs.count_documents({"direction": "inbound", "analysis.category": {"$exists": True}})
unclassified  = total_inbound - classified

print(f"\n{'='*58}")
print(f"  Clasificador — precision en datos reales de produccion")
print(f"{'='*58}")
print(f"  Mensajes inbound totales:     {total_inbound}")
print(f"  Clasificados:                 {classified}  ({100*classified//max(total_inbound,1)}%)")
print(f"  Sin clasificacion:            {unclassified}")

# ─── 2. Distribucion de categorias ───────────────────────────────────────────
print(f"\n--- Distribucion de categorias ---")
cats = logs.aggregate([
    {"$match": {"direction": "inbound", "analysis.category": {"$exists": True}}},
    {"$group": {"_id": "$analysis.category", "count": {"$sum": 1}}},
    {"$sort": {"count": -1}},
])
cat_counts = {}
for c in cats:
    label = c["_id"] or "sin_categoria"
    cat_counts[label] = c["count"]
    pct = 100 * c["count"] // max(classified, 1)
    bar = "#" * (c["count"] // max(1, classified // 30))
    print(f"  {label:<12}  {c['count']:>5}  ({pct:>2}%)  {bar}")

# ─── 3. Reglas vs LLM ────────────────────────────────────────────────────────
print(f"\n--- Resolucion: reglas sin LLM vs llamada a LLM ---")
by_rules  = logs.count_documents({"direction": "inbound", "analysis.category": {"$exists": True},
                                   "analysis.notes": {"$regex": "sin IA|determinista|reglas", "$options": "i"}})
by_llm    = classified - by_rules
print(f"  Por reglas (sin LLM):  {by_rules:>5}  ({100*by_rules//max(classified,1)}%)")
print(f"  Via LLM:               {by_llm:>5}  ({100*by_llm//max(classified,1)}%)")

# ─── 4. Tasa de error del LLM ────────────────────────────────────────────────
errors = logs.count_documents({"direction": "inbound", "analysis.error": True})
print(f"\n--- Errores de clasificacion (LLM fallo / timeout) ---")
print(f"  Errores totales:  {errors}  ({100*errors//max(classified,1)}%)")

# ─── 5. Muestra de cada categoria para validacion visual ─────────────────────
print(f"\n--- Muestra de mensajes por categoria (validacion visual) ---")
for cat in ["humano", "bot", "hibrido"]:
    samples = list(logs.find(
        {"direction": "inbound", "analysis.category": cat},
        {"message_body": 1, "analysis.notes": 1, "analysis.is_ai": 1},
    ).sort("_id", -1).limit(3))
    if not samples:
        continue
    print(f"\n  [{cat.upper()}] — {cat_counts.get(cat, 0)} mensajes")
    for s in samples:
        body  = (s.get("message_body") or "")[:90].replace("\n", " ")
        notes = (s.get("analysis", {}).get("notes") or "")[:60]
        is_ai = " (IA)" if s.get("analysis", {}).get("is_ai") else ""
        print(f"    \"{body}\"")
        print(f"     -> {notes}{is_ai}")

# ─── 6. Mensajes humano con tiempo de reaccion (calidad de lead) ─────────────
print(f"\n--- Mensajes 'humano' con tiempo de reaccion disponible ---")
fast_humans = list(logs.aggregate([
    {"$match": {"direction": "inbound", "analysis.category": "humano",
                "analysis.reaction_time_min": {"$exists": True, "$ne": None}}},
    {"$group": {
        "_id": None,
        "avg_min": {"$avg": "$analysis.reaction_time_min"},
        "min_min": {"$min": "$analysis.reaction_time_min"},
        "max_min": {"$max": "$analysis.reaction_time_min"},
        "count":   {"$sum": 1},
    }},
]))
if fast_humans:
    r = fast_humans[0]
    print(f"  Con tiempo de reaccion: {r['count']}")
    print(f"  Tiempo promedio:        {r['avg_min']:.1f} min")
    print(f"  Mas rapido:             {r['min_min']:.1f} min")
    print(f"  Mas lento:              {r['max_min']:.1f} min")
else:
    print(f"  Sin datos de tiempo de reaccion aun")

# ─── 7. Retroalimentacion correcta del clasificador contra reglas rapidas ─────
print(f"\n--- Validacion cruzada: clasificaciones LLM vs reglas rapidas ---")
llm_classified = list(logs.find(
    {"direction": "inbound", "analysis.category": {"$exists": True},
     "analysis.notes": {"$not": {"$regex": "sin IA|determinista|reglas", "$options": "i"}}},
    {"message_body": 1, "analysis.category": 1},
).limit(200))

agree = conflict_bot = conflict_human = 0
for doc in llm_classified:
    body   = doc.get("message_body") or ""
    llm_cat = doc.get("analysis", {}).get("category")
    quick  = _quick_classify(body)
    if quick is None:
        agree += 1  # LLM clasifico, reglas dicen "ambiguo" — sin conflicto
    elif quick.get("category") == llm_cat:
        agree += 1
    elif quick.get("category") == "bot" and llm_cat == "humano":
        conflict_bot += 1
    else:
        conflict_human += 1

print(f"  Muestra analizada:          {len(llm_classified)}")
print(f"  Sin conflicto:              {agree}")
print(f"  Regla dice BOT, LLM humano: {conflict_bot}  <- posible falso negativo del LLM")
print(f"  Otros conflictos:           {conflict_human}")

print(f"\n{'='*58}\n")
