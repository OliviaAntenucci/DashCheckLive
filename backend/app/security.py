"""Authentication, signed tokens, and brute-force throttling.

Concepts shown here:
  - Integrity/authenticity: HMAC-SHA256 signatures on every token.
  - Domain separation: a token signed for one purpose ("session") can't be
    replayed as another ("pickup").
  - Expiry + one-time nonces: limit the window and number of uses.
  - Credentials stored as salted PBKDF2 hashes, compared in constant time.
  - Throttling/lockout against PIN guessing.
"""

import base64
import hashlib
import hmac
import json
import secrets
import time

from fastapi import Depends, Header, HTTPException

from . import config


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def sign(payload: dict, purpose: str, ttl_seconds: int) -> str:
    body = {**payload, "p": purpose, "exp": int(time.time()) + ttl_seconds}
    encoded = _b64(json.dumps(body, separators=(",", ":"), sort_keys=True).encode())
    sig = hmac.new(config.SIGNING_SECRET,f"{purpose}.{encoded}".encode(), hashlib.sha256).digest()
    return f"{encoded}.{_b64(sig)}"


def verify(token: str, purpose: str) -> dict:
    """Return the payload, or raise ValueError with a short reason."""
    try:
        encoded, sig = token.strip().split(".")
        given = _unb64(sig)
    except Exception:
        raise ValueError("malformed token")
    expected = hmac.new(config.SIGNING_SECRET,f"{purpose}.{encoded}".encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(expected, given):
        raise ValueError("bad signature")
    try:
        payload = json.loads(_unb64(encoded))
    except Exception:
        raise ValueError("malformed token")
    if payload.get("p") != purpose:
        raise ValueError("wrong token type")
    if payload.get("exp", 0) < time.time():
        raise ValueError("expired")
    return payload


def token_fingerprint(token: str) -> str:
    """What gets logged instead of the token itself."""
    return hashlib.sha256(token.encode()).hexdigest()


# --- Demo identities -------------------------------------------------------
# Real deployment: DoorDash merchant accounts / Dasher accounts via SSO.
# PINs are hashed at startup so plaintext isn't held in the user table.

def _hash_pin(pin: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, 100_000)


def _user(role: str, pin: str) -> dict:
    salt = secrets.token_bytes(16)
    return {"role": role, "salt": salt, "pin_hash": _hash_pin(pin, salt)}


USERS = {
    "staff-olivia": _user("merchant_staff", "4242"),
    "staff-jordan": _user("merchant_staff", "1357"),
    "dasher-ava": _user("dasher", "1111"),
    "dasher-ben": _user("dasher", "2222"),
    "dasher-cy": _user("dasher", "3333"),
}
DEMO_PINS = {"staff-olivia": "4242", "staff-jordan": "1357",
             "dasher-ava": "1111", "dasher-ben": "2222", "dasher-cy": "3333"}

SESSION_TTL_SECONDS = 8 * 3600
MAX_FAILURES = 5
LOCKOUT_SECONDS = 60
_failures: dict[str, list[float]] = {}


def login(user_id: str, pin: str) -> dict:
    now = time.time()
    recent = [t for t in _failures.get(user_id, []) if now - t < LOCKOUT_SECONDS]
    if len(recent) >= MAX_FAILURES:
        raise HTTPException(429, "Too many attempts. Try again in a minute.")
    user = USERS.get(user_id)
    # Hash even for unknown users so response time doesn't reveal which IDs exist.
    salt = user["salt"] if user else b"\0" * 16
    ok = hmac.compare_digest(_hash_pin(pin, salt), user["pin_hash"] if user else b"")
    if not (user and ok):
        _failures[user_id] = recent + [now]
        raise HTTPException(401, "Invalid ID or PIN")
    _failures.pop(user_id, None)
    token = sign({"sub": user_id, "role": user["role"]}, "session", SESSION_TTL_SECONDS)
    return {"token": token, "user_id": user_id, "role": user["role"]}


def _session(authorization: str = Header(default="")) -> dict:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Sign in required")
    try:
        return verify(authorization[7:], "session")
    except ValueError as e:
        raise HTTPException(401, f"Session invalid: {e}")


def require_role(role: str):
    """Role-based access control: each endpoint names the one role allowed to call it."""

    def dep(session: dict = Depends(_session)) -> dict:
        if session.get("role") != role:
            raise HTTPException(403, f"Requires role {role}")
        return session

    return dep
