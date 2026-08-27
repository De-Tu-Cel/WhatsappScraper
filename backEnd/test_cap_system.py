"""
Mock test — daily cap + NC cap system con X instancias asignadas.
No requiere MongoDB real ni EC2. Verifica:
  1. get_daily_count por instancia es independiente
  2. increment_daily_count deduplica por número
  3. check_new_contact_cap bloquea al llegar al límite
  4. _nc_aware_pick balancea nuevos contactos entre instancias
  5. Suma total de cupo refleja X instancias
  6. Al llegar al NC cap de inst1, nuevos van a inst2
"""
import sys, types, uuid
sys.path.insert(0, r'c:\Repos\WhatsappScraper\backEnd')

# ── Mock DB ───────────────────────────────────────────────────────────────────
class MockCollection:
    def __init__(self): self._docs = []

    def find_one(self, q, proj=None):
        for d in self._docs:
            if self._match(d, q): return dict(d)
        return None

    def find(self, q=None, proj=None):
        return [dict(d) for d in self._docs if self._match(d, q or {})]

    def update_one(self, q, upd, upsert=False):
        for d in self._docs:
            if self._match(d, q):
                self._apply(d, upd)
                return type('R', (), {'modified_count': 1})()
        if upsert:
            new = {}
            self._apply(new, {"$set": {k: v for k, v in q.items() if not k.startswith('$')}})
            self._apply(new, upd)
            self._docs.append(new)
        return type('R', (), {'modified_count': 0})()

    def insert_one(self, doc): self._docs.append(dict(doc))

    def distinct(self, field, q=None):
        return list({d[field] for d in self._docs if self._match(d, q or {}) and field in d})

    def count_documents(self, q):
        return sum(1 for d in self._docs if self._match(d, q))

    def _match(self, doc, q):
        for k, v in q.items():
            if k.startswith('$'): continue
            dv = doc.get(k)
            if isinstance(v, dict):
                if '$exists' in v and bool(v['$exists']) != (k in doc): return False
                if '$ne' in v and dv == v['$ne']: return False
                if '$in' in v and dv not in v['$in']: return False
                if '$gte' in v and (dv is None or dv < v['$gte']): return False
                if '$lt'  in v and (dv is None or dv >= v['$lt']): return False
            elif dv != v: return False
        return True

    def _apply(self, doc, upd):
        for op, fields in upd.items():
            if op == '$set':
                doc.update(fields)
            elif op == '$addToSet':
                for fk, fv in fields.items():
                    doc.setdefault(fk, [])
                    if fv not in doc[fk]: doc[fk].append(fv)
            elif op == '$inc':
                for fk, fv in fields.items():
                    doc[fk] = doc.get(fk, 0) + fv


class MockDB:
    def __init__(self):
        self.instance_daily_sends = MockCollection()
        self.instances            = MockCollection()
        self.message_logs         = MockCollection()
        self.companies            = MockCollection()
    @property
    def db(self): return self


# ── Setup ─────────────────────────────────────────────────────────────────────
db = MockDB()

INSTANCES = ["inst1", "inst2", "inst3", "inst4"]
for name in INSTANCES:
    db.instances._docs.append({"name": name, "warmup_mode": False, "assigned_to": "user1"})

from app.daily_cap import (
    get_daily_count, increment_daily_count,
    check_new_contact_cap, get_instance_cap,
    count_new_contacts_today_for_instance, NORMAL_NEW_CONTACTS_CAP,
)
from app.scheduler import _nc_aware_pick

OK = "\033[92mOK  \033[0m"
FAIL = "\033[91mFAIL\033[0m"

def check(label, cond):
    print(f"  {OK if cond else FAIL} {label}")
    return cond

all_ok = True

print("\n=== 1. Contadores por instancia son independientes ===")
increment_daily_count(db, "inst1", "5211111111")
increment_daily_count(db, "inst2", "5222222222")
increment_daily_count(db, "inst2", "5233333333")
all_ok &= check("inst1 count = 1", get_daily_count(db, "inst1") == 1)
all_ok &= check("inst2 count = 2", get_daily_count(db, "inst2") == 2)
all_ok &= check("inst3 count = 0", get_daily_count(db, "inst3") == 0)

print("\n=== 2. Deduplicación por número (mismo número no suma dos veces) ===")
increment_daily_count(db, "inst1", "5211111111")  # misma que antes
increment_daily_count(db, "inst1", "5211111111")  # otra vez
all_ok &= check("inst1 sigue en 1 tras doble envío al mismo número", get_daily_count(db, "inst1") == 1)

print("\n=== 3. NC cap por instancia — bloquea al llegar al límite ===")
# inst3 arranca en 0 — simulamos 12 nuevos contactos
for i in range(NORMAL_NEW_CONTACTS_CAP):
    cid = f"company_{i:04d}"
    db.message_logs._docs.append({
        "direction":     "outbound",
        "instance_name": "inst3",
        "company_id":    cid,
        "created_at":    __import__('datetime').datetime.now(),
    })

nc_ok_13, count_13, limit_13 = check_new_contact_cap(db, "inst3", "company_nueva_A")
all_ok &= check(f"inst3 bloqueada al llegar a {NORMAL_NEW_CONTACTS_CAP} nuevos", not nc_ok_13)
nc_ok_free, _, _ = check_new_contact_cap(db, "inst1", "company_nueva_A")
all_ok &= check("inst1 aún tiene cupo NC", nc_ok_free)

print("\n=== 4. _nc_aware_pick balancea hacia instancia con más cupo ===")
# inst3 está llena, inst1 tiene 0 NC usados, inst2 tiene 0, inst4 tiene 0
picked = _nc_aware_pick(db, INSTANCES, "company_nueva_B")
all_ok &= check(f"no elige inst3 (llena) — eligió {picked}", picked != "inst3")

print("\n=== 5. Suma total de cupo = X instancias × cap_por_instancia ===")
total_cap = sum(get_instance_cap(db, n) for n in INSTANCES)
expected  = 4 * 150  # 4 instancias normales × 150
all_ok &= check(f"total daily cap = {total_cap} (esperado {expected})", total_cap == expected)
total_nc = 4 * NORMAL_NEW_CONTACTS_CAP
all_ok &= check(f"total NC cap = {total_nc} nuevos/día entre 4 instancias", total_nc == 48)

print("\n=== 6. Al llegar NC cap de inst1, nuevos van a otra instancia ===")
# Llenar inst1 de nuevos contactos también
for i in range(NORMAL_NEW_CONTACTS_CAP):
    cid = f"company_inst1_{i:04d}"
    db.message_logs._docs.append({
        "direction":     "outbound",
        "instance_name": "inst1",
        "company_id":    cid,
        "created_at":    __import__('datetime').datetime.now(),
    })
# inst1 e inst3 llenas, inst2 e inst4 libres
picked2 = _nc_aware_pick(db, INSTANCES, "company_nueva_C")
all_ok &= check(f"no elige inst1 ni inst3 — eligió {picked2}", picked2 not in ("inst1", "inst3"))

print(f"\n{'='*50}")
print(f"  {'✅ TODOS OK' if all_ok else '❌ HAY FALLOS'}")
print(f"{'='*50}\n")
