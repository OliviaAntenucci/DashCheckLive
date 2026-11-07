# DashCheckLive — Scope (4–5 hour hackathon build)

## Product framing

A feature DoorDash ships in the **merchant app**, at the moment staff mark an order “ready”. The restaurant does the checking; DoorDash provides the checklist, camera assist, seal rule and pickup QR. For the hackathon we build a **standalone prototype that simulates** the merchant tablet and the Dasher phone. We do **not** connect to real DoorDash APIs.

## In scope (MVP)

- Seeded orders (3) with messy notes, PII to scrub, and one prompt-injection attempt
- Staff and Dasher sign-in (demo PINs), role-based access
- PII scrubbing before any AI call
- Note → checklist via OpenRouter (`gpt-4o-mini`) with allow-list validation; offline rules fallback
- Local YOLO-World detection on a laptop webcam, ~2 fps, 5-frame median smoothing
- Photo upload fallback
- Checklist statuses: ok / missing / check manually / unexpected
- Staff confirm + per-item override reasons; seal enforced server-side
- Signed, expiring, one-time pickup QR bound to the assigned Dasher; wrong Dasher and replay rejected
- Hash-chained audit log with in-UI verification

## Demo constraints

- Short list of easy-to-detect props: sandwich, bottle, donut, apple, banana, orange, fork, small sauce cup
- Plain light background, good lighting, items laid **flat, outside the bag**
- Test props in the first hour; adjust labels/thresholds in `orders.py` / `.env`

## Stretch goals

- Vision-LLM second opinion on uncertain items (e.g. `openai/gpt-4o` via OpenRouter). **Off by default**, because it sends an image off-device; would need an explicit opt-in and frame cropping
- Real QR scanning in the Dasher simulator (camera decode instead of paste)
- Customer-facing “verified packed” receipt
- Advanced order parsing (combos, modifiers, multi-bag orders)
- Bag labels without PII (order #, first name + initial, item count)
- Unit tests and a tamper demo button that edits a log line
- Persistent storage; anchoring the log head hash externally

## Out of scope / non-promises

- Real DoorDash integration, merchant hardware, or POS feeds
- Identifying items **inside** closed bags or containers
- Verifying **allergens**, ingredients, or prep (e.g. “no onions”). These are flagged for humans only
- Recognizing arbitrary menu items without prop testing
- Production auth (SSO/MFA), HTTPS deployment, multi-store tenancy

## Team split

1. **Detection + smoothing**: `detector.py`, `checklist.py`, prop testing
2. **Order parsing + scrubbing**: `scrub.py`, `parser.py`, OpenRouter
3. **Webcam UI + overlay**: `frontend/`
4. **Security (auth, QR, log) + slides + props**: `security.py`, `ledger.py`, `SECURITY.md`

## Timeline

| Time | Milestone |
|---|---|
| 0:00–0:45 | Setup, deps, model download, prop test |
| 0:45–2:00 | Each track builds its module against the API contract in README |
| 2:00–3:00 | Integrate end-to-end on order #42 |
| 3:00–4:00 | Orders #43/#44, fallbacks, polish |
| 4:00–4:30 | Demo rehearsal ×2, slides |
