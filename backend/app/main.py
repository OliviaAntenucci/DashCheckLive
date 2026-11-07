"""DashCheckLive API.

A merchant-app feature DoorDash provides to restaurants: restaurant staff turn
an order into a packing checklist, check the laid-out items with a local camera
model, confirm and seal, and only then can the assigned Dasher pick it up.

Roles (RBAC):
  merchant_staff  view orders, prepare checklist, run checks, seal, view audit log
  dasher          redeem a pickup QR for an order assigned to them
"""

import base64
import hashlib
import io
import json
import secrets
import time
from collections import Counter

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from . import config
from .checklist import compare
from .detector import DetectorUnavailable, detector
from .ledger import Ledger
from .orders import MENU, OrderStore
from .parser import parse_note
from .scrub import scrub
from .security import login, require_role, sign, token_fingerprint, verify

app = FastAPI(title="DashCheckLive", docs_url="/api/docs", openapi_url="/api/openapi.json")
ledger = Ledger(config.DATA_DIR / "ledger.jsonl")
store = OrderStore()

staff_only = require_role("merchant_staff")
dasher_only = require_role("dasher")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
        "style-src 'self'; script-src 'self'; frame-ancestors 'none'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()"
    response.headers["Cache-Control"] = "no-store"
    return response


def _order(order_id: str):
    order = store.get(order_id)
    if not order:
        raise HTTPException(404, "Order not found")
    return order


def _checklist(order) -> tuple[list[dict], bool]:
    if order.last_check:
        return order.last_check["items"], order.last_check["all_ok"]
    return compare(order.expected, order.excluded, {}, set(), order.sources)


# --- Public ----------------------------------------------------------------

class LoginRequest(BaseModel):
    user_id: str = Field(min_length=2, max_length=40)
    pin: str = Field(min_length=4, max_length=12)


@app.post("/api/auth/login")
def auth_login(req: LoginRequest):
    try:
        session = login(req.user_id, req.pin)
    except HTTPException as e:
        ledger.append("login_failed", req.user_id, status=e.status_code)
        raise
    ledger.append("login", session["user_id"], role=session["role"])
    return session


@app.get("/api/health")
def health():
    return {
        "detector": detector.status(),
        "parser": f"openrouter:{config.PARSE_MODEL}" if config.OPENROUTER_KEY else "rules (no OPENROUTER_KEY)",
        "images_leave_device": False,
    }


# --- Restaurant staff --------------------------------------------------------

@app.get("/api/orders")
def list_orders(_: dict = Depends(staff_only)):
    return [
        {"id": o.id, "display_name": o.display_name, "status": o.status,
         "item_count": sum(q for _, q in o.items), "dasher_id": o.dasher_id}
        for o in store.orders.values()
    ]


@app.get("/api/orders/{order_id}")
def get_order(order_id: str, _: dict = Depends(staff_only)):
    order = _order(order_id)
    items, all_ok = _checklist(order) if order.status != "new" else ([], False)
    return {**order.public(), "checklist": items, "all_ok": all_ok}


@app.post("/api/orders/{order_id}/prepare")
def prepare_order(order_id: str, session: dict = Depends(staff_only)):
    """Scrub personal data from the note, then parse it into checklist adjustments."""
    order = _order(order_id)
    if order.status != "new":
        raise HTTPException(409, f"Order is already {order.status}")
    clean, redactions = scrub(order.raw_note, names=(order.customer_name,))
    parsed, parser_used = parse_note(clean, [MENU[k]["name"] for k, _ in order.items])
    order.scrubbed_note, order.redactions = clean, redactions
    order.apply_parsed({**parsed, "parser": parser_used})
    order.status = "prepared"
    ledger.append(
        "order_prepared", session["sub"], order_id=order.id, parser=parser_used,
        redactions=redactions, note_sha256=hashlib.sha256(clean.encode()).hexdigest(),
        expected=order.expected, excluded=order.excluded,
    )
    return get_order(order_id, session)


@app.post("/api/orders/{order_id}/frame")
async def check_frame(
    order_id: str,
    frame: UploadFile = File(...),
    mode: str = Form("live"),
    session: dict = Depends(staff_only),
):
    """Run local detection on one frame. The image is hashed, never stored or uploaded."""
    order = _order(order_id)
    if order.status != "prepared":
        raise HTTPException(409, "Prepare the order before checking it")
    if frame.content_type not in config.ALLOWED_FRAME_TYPES:
        raise HTTPException(415, "Frame must be JPEG, PNG or WebP")
    data = await frame.read(config.MAX_FRAME_BYTES + 1)
    if len(data) > config.MAX_FRAME_BYTES:
        raise HTTPException(413, "Frame too large")
    frame_hash = hashlib.sha256(data).hexdigest()

    labels = sorted(set(order.expected) | set(order.excluded))
    try:
        result = await run_in_threadpool(detector.detect, data, labels)
    except DetectorUnavailable as e:
        raise HTTPException(503, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    finally:
        del data  # drop the image bytes as soon as detection is done

    accepted = Counter(b["label"] for b in result["boxes"] if b["conf"] >= config.CONF_ACCEPT)
    review = {b["label"] for b in result["boxes"] if b["conf"] < config.CONF_ACCEPT}
    if mode == "photo":
        order.smoother.reset()
    smoothed = order.smoother.push(accepted)
    items, all_ok = compare(order.expected, order.excluded, smoothed, review, order.sources)
    order.last_check = {
        "frame_sha256": frame_hash, "source": "photo" if mode == "photo" else "live",
        "ts": time.time(), "items": items, "all_ok": all_ok,
    }

    # Log on state changes only, so a 2 fps webcam loop doesn't flood the audit trail.
    summary = json.dumps([(i["label"], i["status"]) for i in items])
    if summary != order.last_logged_summary or mode == "photo":
        order.last_logged_summary = summary
        ledger.append(
            "vision_check", session["sub"], order_id=order.id, frame_sha256=frame_hash,
            source=order.last_check["source"], all_ok=all_ok,
            statuses={i["label"]: i["status"] for i in items},
        )
    return {**result, "items": items, "all_ok": all_ok, "frame_sha256": frame_hash}


class SealRequest(BaseModel):
    confirmed: bool
    prep_acknowledged: bool = False
    overrides: dict[str, str] = Field(default_factory=dict)


@app.post("/api/orders/{order_id}/seal")
def seal_order(order_id: str, req: SealRequest, session: dict = Depends(staff_only)):
    """Sealing is a rule in code. AI output alone can never satisfy it:
    every row must be ok, or a signed-in staff member must give a reason for it."""
    order = _order(order_id)
    if order.status != "prepared":
        raise HTTPException(409, f"Order is {order.status}, cannot seal")
    if not req.confirmed:
        raise HTTPException(400, "Staff must confirm the order was checked")
    parsed = order.parsed or {}
    if (parsed.get("prep_instructions") or parsed.get("allergy_flags")) and not req.prep_acknowledged:
        raise HTTPException(400, "Acknowledge prep instructions / allergy flags first")

    items, all_ok = _checklist(order)
    needs_override = [i["label"] for i in items if i["status"] != "ok"]
    missing_reason = [l for l in needs_override if len(req.overrides.get(l, "").strip()) < 3]
    if missing_reason:
        raise HTTPException(400, f"Override reason required for: {', '.join(missing_reason)}")
    overrides = {l: req.overrides[l].strip()[:120] for l in needs_override}

    nonce = secrets.token_urlsafe(12)
    token = sign({"o": order.id, "d": order.dasher_id, "n": nonce}, "pickup", config.PICKUP_TTL_SECONDS)
    order.pickup_nonce = nonce
    order.status = "sealed"
    order.seal = {
        "staff_id": session["sub"], "ts": time.time(), "vision_all_ok": all_ok,
        "frame_sha256": order.last_check["frame_sha256"] if order.last_check else None,
        "overrides": overrides,
    }
    ledger.append("order_sealed", session["sub"], order_id=order.id, **{
        k: v for k, v in order.seal.items() if k not in ("staff_id", "ts")})
    ledger.append("pickup_token_issued", session["sub"], order_id=order.id,
                  dasher_id=order.dasher_id, token_sha256=token_fingerprint(token))

    import qrcode  # local import: only needed here

    buf = io.BytesIO()
    qrcode.make(token).save(buf, format="PNG")
    return {
        "order": get_order(order_id, session),
        "pickup_token": token,
        "qr_png": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
        "expires_in": config.PICKUP_TTL_SECONDS,
    }


@app.get("/api/log")
def audit_log(_: dict = Depends(staff_only)):
    return {**ledger.verify(), "events": ledger.events[-50:]}


@app.post("/api/demo/reset")
def demo_reset(session: dict = Depends(staff_only)):
    store.reset()
    ledger.append("demo_reset", session["sub"])
    return {"ok": True}


# --- Dasher ------------------------------------------------------------------

class PickupRequest(BaseModel):
    token: str = Field(min_length=10, max_length=600)


@app.post("/api/pickup")
def pickup(req: PickupRequest, session: dict = Depends(dasher_only)):
    """Who is picking up comes from the Dasher's signed session, never from the request body."""
    dasher_id = session["sub"]
    fingerprint = token_fingerprint(req.token)

    def reject(reason: str, order_id: str | None = None):
        ledger.append("pickup_rejected", dasher_id, order_id=order_id, reason=reason,
                      token_sha256=fingerprint)
        raise HTTPException(403, f"Pickup rejected: {reason}")

    try:
        payload = verify(req.token, "pickup")
    except ValueError as e:
        reject(str(e))
    order = store.get(payload["o"])
    if not order:
        reject("unknown order")
    if payload["d"] != dasher_id or order.dasher_id != dasher_id:
        reject("order is assigned to a different Dasher", order.id)
    if order.status == "picked_up":
        reject("already picked up (replay)", order.id)
    if order.status != "sealed" or payload["n"] != order.pickup_nonce:
        reject("token is not the current one for this order", order.id)

    order.status = "picked_up"
    order.pickup_nonce = None  # burn the nonce: one-time use
    ledger.append("picked_up", dasher_id, order_id=order.id, token_sha256=fingerprint)
    return {"ok": True, "order_id": order.id, "display_name": order.display_name,
            "item_count": sum(q for _, q in order.items)}


# Serve the single-page frontend last so /api routes take precedence.
app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")
