"""
Mock test — routing de instancias:
  1. Al llegar daily cap de inst asignada, redirige a otra (no 429)
  2. _stamp_assigned_instance no sobreescribe asignacion existente
  3. NC cap en inst asignada tambien hace fallback
"""
import sys, datetime
sys.path.insert(0, r'c:\Repos\WhatsappScraper\backEnd')

# ── Mock DB (reutiliza mismo patron que test_cap_system.py) ───────────────────
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

    @staticmethod
    def _norm(v):
        """Normaliza ObjectId a string para comparaciones en el mock."""
        try:
            from bson import ObjectId
            if isinstance(v, ObjectId): return str(v)
        except ImportError:
            pass
        return v

    def _match(self, doc, q):
        for k, v in q.items():
            if k.startswith('$'): continue
            dv = self._norm(doc.get(k))
            v  = self._norm(v)
            if isinstance(v, dict):
                if '$exists' in v and bool(v['$exists']) != (k in doc): return False
                if '$ne'     in v and dv == self._norm(v['$ne']): return False
                if '$in'     in v and dv not in [self._norm(x) for x in v['$in']]: return False
                if '$nin'    in v and dv in [self._norm(x) for x in v['$nin']]: return False
                if '$gte'    in v and (dv is None or dv < v['$gte']): return False
                if '$lt'     in v and (dv is None or dv >= v['$lt']): return False
                if '$lte'    in v and (dv is None or dv > v['$lte']): return False
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


OK   = "OK  "
FAIL = "FAIL"
all_ok = True

def check(label, cond):
    global all_ok
    print(f"  {OK if cond else FAIL} {label}")
    if not cond: all_ok = False
    return cond


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
from app.daily_cap import (
    get_daily_count, increment_daily_count, get_instance_cap,
    check_new_contact_cap, DAILY_CAP, NORMAL_NEW_CONTACTS_CAP,
)
from app.scheduler import _nc_aware_pick, _stamp_assigned_instance


def make_db(instances=("inst1", "inst2"), warmup=False):
    db = MockDB()
    for name in instances:
        db.instances._docs.append({"name": name, "warmup_mode": warmup, "assigned_to": "user1"})
    return db


def fill_daily_cap(db, inst_name, cap=None):
    """Simula que inst_name ya llego a su daily cap."""
    cap = cap or DAILY_CAP
    for i in range(cap):
        increment_daily_count(db, inst_name, f"52100{i:06d}")


def fill_nc_cap(db, inst_name, cap=None):
    """Simula que inst_name ya llego a su NC cap de nuevos contactos hoy."""
    cap = cap or NORMAL_NEW_CONTACTS_CAP
    for i in range(cap):
        cid = f"co_{inst_name}_{i:04d}"
        db.message_logs._docs.append({
            "direction":     "outbound",
            "instance_name": inst_name,
            "company_id":    cid,
            "created_at":    datetime.datetime.now(),
        })


# =============================================================================
print("\n=== 1. Daily cap en inst asignada -> fallback a otra instancia ===")
# =============================================================================
# Escenario: empresa asignada a inst1, inst1 llego al daily cap
# El sistema debe elegir inst2 en vez de bloquear

db1 = make_db(["inst1", "inst2"])
fill_daily_cap(db1, "inst1")

# Simular la logica de _send_message: verifica daily cap antes de usar preferred
inst_name = "inst1"
company_id = "aaaaaaaaaaaaaaaaaaaaaaaa"  # 24 chars

_daily_ok = get_daily_count(db1, inst_name) < get_instance_cap(db1, inst_name)
_nc_ok, _, _ = check_new_contact_cap(db1, inst_name, company_id)

check("inst1 detectada como daily cap llena", not _daily_ok)
check("NC cap de inst1 esta libre (solo daily esta llena)", _nc_ok)

# Como _daily_ok es False, debe caer al nc_aware_pick
candidates = ["inst1", "inst2"]
if not _daily_ok or not _nc_ok:
    picked = _nc_aware_pick(db1, candidates, company_id)
else:
    picked = inst_name

check(f"fallback elige inst2 (no inst1 llena) — eligio: {picked}", picked == "inst2")


# =============================================================================
print("\n=== 2. NC cap en inst asignada -> fallback a otra instancia ===")
# =============================================================================
db2 = make_db(["inst1", "inst2"])
fill_nc_cap(db2, "inst1")

_daily_ok2 = get_daily_count(db2, "inst1") < get_instance_cap(db2, "inst1")
_nc_ok2, count2, limit2 = check_new_contact_cap(db2, "inst1", "bbbbbbbbbbbbbbbbbbbbbbbb")

check("inst1 daily cap libre", _daily_ok2)
check(f"inst1 NC cap llena ({count2}/{limit2})", not _nc_ok2)

if not _daily_ok2 or not _nc_ok2:
    picked2 = _nc_aware_pick(db2, ["inst1", "inst2"], "bbbbbbbbbbbbbbbbbbbbbbbb")
else:
    picked2 = "inst1"

check(f"fallback elige inst2 por NC cap — eligio: {picked2}", picked2 == "inst2")


# =============================================================================
print("\n=== 3. _stamp_assigned_instance NO sobreescribe asignacion existente ===")
# =============================================================================
db3 = make_db(["inst1", "inst2"])
company_id3 = "cccccccccccccccccccccccc"

# Empresa ya tiene inst1 asignada
db3.companies._docs.append({"_id": company_id3, "assigned_instance": "inst1"})

# Intentar asignar inst2 (simula un fallback por NC cap que no debe sobreescribir)
_stamp_assigned_instance(db3, company_id3, "inst2")

co = db3.companies.find_one({"_id": company_id3})
check("assigned_instance sigue siendo inst1 (no sobreescrita por inst2)",
      co.get("assigned_instance") == "inst1")


# =============================================================================
print("\n=== 4. _stamp_assigned_instance SI asigna cuando no hay asignacion previa ===")
# =============================================================================
db4 = make_db(["inst1", "inst2"])
company_id4 = "dddddddddddddddddddddddd"

db4.companies._docs.append({"_id": company_id4})  # sin assigned_instance

_stamp_assigned_instance(db4, company_id4, "inst1")

co4 = db4.companies.find_one({"_id": company_id4})
check("assigned_instance = inst1 asignada correctamente en empresa nueva",
      co4.get("assigned_instance") == "inst1")


# =============================================================================
print("\n=== 5. Ambas instancias llenas -> _nc_aware_pick retorna None ===")
# =============================================================================
db5 = make_db(["inst1", "inst2"])
fill_nc_cap(db5, "inst1")
fill_nc_cap(db5, "inst2")

picked5 = _nc_aware_pick(db5, ["inst1", "inst2"], "eeeeeeeeeeeeeeeeeeeeeeee")
check("nc_aware_pick retorna None cuando todas las inst estan al NC cap",
      picked5 is None)


# =============================================================================
print(f"\n{'='*52}")
print(f"  {'TODOS OK' if all_ok else 'HAY FALLOS'}")
print(f"{'='*52}\n")
