# phone_utils.py — single phone-digit normalizer shared by all WhatsApp providers.
# Previously waha/wasender/evolution each carried a byte-identical copy of this
# function and wwebjs had a weaker inline version missing the 10-digit rule — the
# same real number could normalize to two different strings depending on provider,
# which matters now that daily_cap dedups by this exact string.
def clean_digits(number: str) -> str:
    """Normalize to international digits without + or spaces; a bare 10-digit
    local number gets the Mexican country code prefixed."""
    digits = "".join(filter(str.isdigit, number or ""))
    if len(digits) == 10:
        digits = "52" + digits
    return digits
