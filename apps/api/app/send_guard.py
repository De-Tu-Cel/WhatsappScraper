# send_guard.py
"""
One place that decides whether a message may go out to a number / company.

Every send path calls it right before sending — manual /send-message, the bulk
send queue (search / batch / CSV / Ideas / Enviar Campaña), scheduled campaigns
and Andy's replies — so a block applies to whatever is still queued, not only
to sends started after it. Reads Mongo every time: a new entry applies at once
in both API processes and for every user.

Audit 2026-10-04: scheduled campaigns checked nothing, the bulk queue never
checked the number, and numbers were compared as exact digit strings, so the
same phone stored as 52… (how contacts are scraped) never matched 521… (how
WhatsApp delivers inbound messages).
"""
import re


def phone_key(number) -> str:
    """Comparable form of a phone: its last 10 digits. The same Mexican number
    shows up as +52 664…, 52664…, 521664… or 664… depending on where it came from."""
    digits = "".join(filter(str.isdigit, str(number or "")))
    return digits[-10:] if len(digits) >= 10 else digits


def is_phone_blacklisted(db, number) -> bool:
    key = phone_key(number)
    if len(key) < 7:
        return False
    return db.db.blacklist.find_one(
        {"type": "phone", "value": {"$regex": re.escape(key) + "$"}}, {"_id": 1}
    ) is not None


def blacklisted_phone_keys(db) -> set:
    """All blocked phones as keys — for marking many numbers in one pass."""
    return {phone_key(e.get("value")) for e in db.db.blacklist.find({"type": "phone"}, {"value": 1})}


def company_block_reason(db, company_id: str):
    """{"reason": "blocked" | "domain" | "industry", "matched": ...} or None."""
    if not company_id or len(company_id) != 24:
        return None
    from bson import ObjectId
    from app.pipeline import _check_blacklist
    company = db.db.companies.find_one({"_id": ObjectId(company_id)}, {"domain": 1, "industry": 1, "name": 1, "blocked": 1})
    if not company:
        return None
    if company.get("blocked"):
        return {"reason": "blocked", "matched": ""}
    # Not gated on domain — a company with no stored domain still gets its
    # industry checked (WhatsApp-only businesses, Maps leads without a website).
    return _check_blacklist(company.get("domain") or "", company.get("industry") or "", company.get("name") or "")


def send_block_reason(db, company_id: str, number):
    """Why this message must not go out, or None. The number is checked first —
    it can be blocked without its company being flagged at all."""
    if number and is_phone_blacklisted(db, number):
        return {"reason": "phone", "matched": phone_key(number)}
    return company_block_reason(db, company_id)
