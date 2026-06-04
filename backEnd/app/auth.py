# auth.py — User authentication and session management
import bcrypt
import uuid
from datetime import datetime
from bson import ObjectId
from app.database import MongoDBManager


def _db():
    return MongoDBManager().db


def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode(), bcrypt.gensalt()).decode()


def verify_pin(pin: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pin.encode(), hashed.encode())
    except Exception:
        return False


ALLOWED_DOMAIN = "detucel.mx"

def create_user(username: str, display_name: str, pin: str,
                email: str = "", evolution_instance: str = "", role: str = "agent") -> dict:
    db = _db()
    if email:
        domain = email.strip().lower().split("@")[-1]
        if domain != ALLOWED_DOMAIN:
            raise ValueError(f"Solo se permiten correos @{ALLOWED_DOMAIN}")
    if db.users.find_one({"username": username.lower()}):
        raise ValueError(f"El usuario '{username}' ya existe")
    if email and db.users.find_one({"email": email.strip().lower()}):
        raise ValueError(f"Este correo ya está registrado")
    recovery_code = str(uuid.uuid4()).replace("-", "").upper()[:12]
    doc = {
        "username":           username.lower().strip(),
        "display_name":       display_name.strip(),
        "email":              email.strip().lower() if email else "",
        "pin_hash":           hash_pin(pin),
        "recovery_code":      recovery_code,
        "evolution_instance": evolution_instance,
        "connected_number":   "",
        "role":               role,
        "session_token":      None,
        "active":             True,
        "created_at":         datetime.now(),
    }
    result = db.users.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    user = _serialize_user(doc)
    user["recovery_code"] = recovery_code   # shown only once on creation
    return user


def recover_pin(username: str, recovery_code: str, new_pin: str) -> bool:
    db = _db()
    user = db.users.find_one({"username": username.lower(), "active": True})
    if not user or user.get("recovery_code") != recovery_code.upper().strip():
        return False
    new_code = str(uuid.uuid4()).replace("-", "").upper()[:12]
    db.users.update_one({"_id": user["_id"]}, {
        "$set": {"pin_hash": hash_pin(new_pin), "recovery_code": new_code, "session_token": None}
    })
    return True


def login(username: str, pin: str) -> dict | None:
    db = _db()
    user = db.users.find_one({"username": username.lower(), "active": True})
    if not user or not verify_pin(pin, user["pin_hash"]):
        return None
    token = str(uuid.uuid4())
    db.users.update_one({"_id": user["_id"]}, {"$set": {"session_token": token, "last_login": datetime.now()}})
    user["session_token"] = token
    return _serialize_user(user)


def get_user_by_token(token: str) -> dict | None:
    if not token:
        return None
    db = _db()
    user = db.users.find_one({"session_token": token, "active": True})
    return _serialize_user(user) if user else None


def logout(token: str):
    _db().users.update_one({"session_token": token}, {"$set": {"session_token": None}})


def update_evolution(token: str, instance: str, number: str = ""):
    _db().users.update_one(
        {"session_token": token},
        {"$set": {"evolution_instance": instance, "connected_number": number}},
    )


def list_users() -> list:
    db = _db()
    return [_serialize_user(u) for u in db.users.find({"active": True}, {"pin_hash": 0, "session_token": 0})]


def _serialize_user(user: dict) -> dict:
    if not user:
        return {}
    return {
        "id":                 str(user.get("_id", "")),
        "username":           user.get("username", ""),
        "display_name":       user.get("display_name", ""),
        "email":              user.get("email", ""),
        "evolution_instance": user.get("evolution_instance", ""),
        "connected_number":   user.get("connected_number", ""),
        "role":               user.get("role", "agent"),
        "session_token":      user.get("session_token"),
        "created_at":         user.get("created_at", ""),
    }
