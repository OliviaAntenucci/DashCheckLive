"""Data minimization: remove personal data from order text before it leaves the device."""

import re

# Order matters: card numbers before phones so a 16-digit run isn't half-matched as a phone.
_PATTERNS = [
    ("[EMAIL]", re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")),
    ("[URL]", re.compile(r"https?://\S+", re.I)),
    ("[CARD]", re.compile(r"\b(?:\d[ -]?){13,16}\b")),
    # Gate/door codes are physical-access secrets: the kitchen never needs them.
    ("[ACCESS_CODE]", re.compile(
        r"\b(?:gate|door|access|entry|lockbox|buzzer|building)\s*(?:code)?\s*(?:is|:|#)?\s*\d{3,8}\b", re.I)),
    ("[PHONE]", re.compile(r"(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b")),
    (
        "[ADDRESS]",
        re.compile(
            r"\b\d{1,6}\s+(?:[A-Za-z0-9.]+\s+){0,4}?"
            r"(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place)\b\.?"
            r"(?:,?\s*(?:apt|apartment|unit|suite|ste|#)\.?\s*\w+)?",
            re.I,
        ),
    ),
]


def scrub(text: str, names: tuple[str, ...] = ()) -> tuple[str, dict[str, int]]:
    """Return (scrubbed_text, {placeholder: count}).

    `names` are known personal names (e.g. the customer's) to redact as [NAME].
    """
    counts: dict[str, int] = {}
    out = text or ""
    for placeholder, pattern in _PATTERNS:
        out, n = pattern.subn(placeholder, out)
        if n:
            counts[placeholder] = n
    for name in names:
        for part in name.split():
            if len(part) < 2:
                continue
            out, n = re.subn(rf"\b{re.escape(part)}\b", "[NAME]", out, flags=re.I)
            if n:
                counts["[NAME]"] = counts.get("[NAME]", 0) + n
    return out, counts
