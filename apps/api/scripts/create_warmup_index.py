"""
Crea el índice compuesto en warmup_sessions para la query de búsqueda de pares.
Idempotente — si ya existe, PyMongo lo salta.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))
from app.database import MongoDBManager
db = MongoDBManager()

result = db.db.warmup_sessions.create_index(
    [("date", 1), ("instance_a", 1), ("instance_b", 1)],
    name="date_pair",
)
print(f"Índice creado/confirmado: {result}")

existing = list(db.db.warmup_sessions.index_information().keys())
print(f"Índices actuales: {existing}")
