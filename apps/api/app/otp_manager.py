# otp_manager.py
"""
OTP Manager — receives SMS webhooks from Telcel (or any carrier API),
extracts the WhatsApp OTP, and enters it into the correct docker-android
container via ADB.

Flow:
  1. POST /api/otp/start-registration  → creates docker-android container,
                                          starts WhatsApp, saves phone→port mapping
  2. WhatsApp sends OTP SMS to the number
  3. Telcel webhook → POST /api/otp/webhook  → extracts code → ADB inputs it
  4. WhatsApp registers → Evolution API picks up the session
"""
import re
import subprocess
import threading
import time
import logging
from datetime import datetime, timedelta

log = logging.getLogger(__name__)

# phone_number → { "adb_port": int, "container": str, "status": str, "created_at": datetime }
_registrations: dict = {}
_lock = threading.Lock()

# How long to wait for OTP before giving up
OTP_TIMEOUT_MINUTES = 10


# ── ADB helpers ───────────────────────────────────────────────────────────────

def _adb(port: int, *args) -> tuple[int, str]:
    """Run an ADB command against a specific emulator port."""
    cmd = ["adb", "-s", f"emulator:{port}"] + list(args)
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        return r.returncode, r.stdout + r.stderr
    except subprocess.TimeoutExpired:
        return 1, "adb timeout"
    except FileNotFoundError:
        return 1, "adb not found — install android-tools-adb"


def _wait_for_device(port: int, timeout: int = 60) -> bool:
    """Wait until ADB can reach the emulator."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        code, _ = _adb(port, "shell", "echo", "ok")
        if code == 0:
            return True
        time.sleep(2)
    return False


def _input_text(port: int, text: str) -> bool:
    code, out = _adb(port, "shell", "input", "text", text)
    return code == 0


def _tap(port: int, x: int, y: int) -> bool:
    code, _ = _adb(port, "shell", "input", "tap", str(x), str(y))
    return code == 0


def _open_whatsapp(port: int) -> bool:
    code, _ = _adb(port, "shell", "monkey", "-p", "com.whatsapp", "-c",
                   "android.intent.category.LAUNCHER", "1")
    return code == 0


# ── OTP extraction ────────────────────────────────────────────────────────────

def extract_otp(sms_body: str) -> str | None:
    """Extract a 6-digit OTP from an SMS body. Handles common WhatsApp formats."""
    patterns = [
        r"\b(\d{6})\b",               # plain 6 digits
        r"(\d{3}[-\s]\d{3})",         # 123-456 or 123 456
        r"code[:\s]+(\d{6})",         # "code: 123456"
        r"código[:\s]+(\d{6})",       # "código: 123456"
    ]
    for pat in patterns:
        m = re.search(pat, sms_body, re.IGNORECASE)
        if m:
            return m.group(1).replace("-", "").replace(" ", "")
    return None


# ── Registration state machine ────────────────────────────────────────────────

def start_registration(phone_number: str, adb_port: int, container_name: str):
    """
    Called after the docker-android container is up and WhatsApp is open.
    Records the mapping and marks the registration as 'waiting_otp'.
    """
    with _lock:
        _registrations[phone_number] = {
            "adb_port":      adb_port,
            "container":     container_name,
            "status":        "waiting_otp",
            "created_at":    datetime.now(),
            "otp_entered_at": None,
            "error":         None,
        }
    log.info("[OTPManager] registration started for %s on port %d", phone_number, adb_port)

    # Background watchdog — marks as timed_out if OTP never arrives
    def _watchdog():
        time.sleep(OTP_TIMEOUT_MINUTES * 60)
        with _lock:
            reg = _registrations.get(phone_number)
            if reg and reg["status"] == "waiting_otp":
                reg["status"] = "timed_out"
                log.warning("[OTPManager] OTP timeout for %s", phone_number)

    threading.Thread(target=_watchdog, daemon=True).start()


def handle_incoming_sms(phone_number: str, sms_body: str) -> dict:
    """
    Called by the Telcel webhook handler.
    Extracts OTP and enters it into the correct Android container via ADB.
    Returns {"ok": bool, "detail": str}
    """
    with _lock:
        reg = _registrations.get(phone_number)

    if not reg:
        log.debug("[OTPManager] SMS for unregistered number %s — ignoring", phone_number)
        return {"ok": False, "detail": "no_pending_registration"}

    if reg["status"] != "waiting_otp":
        return {"ok": False, "detail": f"wrong_status:{reg['status']}"}

    otp = extract_otp(sms_body)
    if not otp:
        log.warning("[OTPManager] could not extract OTP from SMS: %s", sms_body[:100])
        return {"ok": False, "detail": "otp_not_found"}

    log.info("[OTPManager] entering OTP %s for %s on port %d", otp, phone_number, reg["adb_port"])

    port = reg["adb_port"]

    # Wait for device to be reachable
    if not _wait_for_device(port, timeout=30):
        _set_status(phone_number, "error", "adb_unreachable")
        return {"ok": False, "detail": "adb_unreachable"}

    # Enter OTP — WhatsApp auto-advances after 6 digits
    ok = _input_text(port, otp)
    if not ok:
        _set_status(phone_number, "error", "adb_input_failed")
        return {"ok": False, "detail": "adb_input_failed"}

    _set_status(phone_number, "otp_entered")
    log.info("[OTPManager] OTP entered successfully for %s", phone_number)
    return {"ok": True, "detail": "otp_entered"}


def get_status(phone_number: str) -> dict | None:
    with _lock:
        reg = _registrations.get(phone_number)
    if not reg:
        return None
    return {
        "phone_number": phone_number,
        "status":       reg["status"],
        "container":    reg["container"],
        "created_at":   reg["created_at"].isoformat(),
        "error":        reg["error"],
    }


def _set_status(phone_number: str, status: str, error: str | None = None):
    with _lock:
        reg = _registrations.get(phone_number)
        if reg:
            reg["status"] = status
            if error:
                reg["error"] = error
            if status == "otp_entered":
                reg["otp_entered_at"] = datetime.now()
