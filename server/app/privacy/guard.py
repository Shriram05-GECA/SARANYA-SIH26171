"""Server-side defense in depth: refuse to process a request that still contains PII-shaped values.

The extension is the primary privacy boundary. This guard exists so that a buggy or malicious client
cannot make the server forward raw identifiers to an AI provider. It never returns or logs matched values.
"""
import re
from typing import Any, Iterable

_P = [
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")),
    ("card", re.compile(r"(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])")),
    ("phone", re.compile(r"(?<!\d)(?:(?:\+|00)?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)")),
    ("aadhaar", re.compile(r"(?<!\d)[2-9]\d{3}[ -]\d{4}[ -]\d{4}(?!\d|[ -]\d)")),
    ("aadhaar", re.compile(r"(?<![\d.,])[2-9]\d{11}(?![\d.,])")),
    ("pan", re.compile(r"(?<![A-Za-z0-9])[A-Z]{5}\d{4}[A-Z](?![A-Za-z0-9])")),
    ("ifsc", re.compile(r"(?<![A-Za-z0-9])[A-Z]{4}0[A-Z0-9]{6}(?![A-Za-z0-9])")),
    ("identifier", re.compile(r"(?<![A-Za-z0-9])[A-Z]{2,5}-\d{4}-\d{3,8}(?![A-Za-z0-9])")),
    ("account", re.compile(r"(?<![\d.,])\d{9,18}(?![\d.,])")),
]


def _luhn(d: str) -> bool:
    s, dbl = 0, False
    for ch in reversed(d):
        n = ord(ch) - 48
        if dbl:
            n *= 2
            if n > 9:
                n -= 9
        s += n
        dbl = not dbl
    return s % 10 == 0


def _strings(v: Any) -> Iterable[str]:
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict):
        for k, x in v.items():
            yield str(k)
            yield from _strings(x)
    elif isinstance(v, (list, tuple)):
        for x in v:
            yield from _strings(x)


def scan_payload(payload: Any) -> dict[str, int]:
    """Returns {pii_type: count}. Empty dict means clean."""
    found: dict[str, int] = {}
    for s in _strings(payload):
        if s == "[REDACTED]":
            continue
        for name, rx in _P:
            for m in rx.finditer(s):
                if name == "card" and not _luhn(re.sub(r"\D", "", m.group(0))):
                    continue
                found[name] = found.get(name, 0) + 1
    return found
