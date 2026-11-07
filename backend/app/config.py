"""Runtime settings, loaded from the repo-root .env file."""

import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

# OpenRouter (text-only order-note parsing). The hacker guide uses OPENROUTER_KEY;
# OPENROUTER_API_KEY is accepted too since the guide's sample service uses it.
OPENROUTER_KEY = os.getenv("OPENROUTER_KEY") or os.getenv("OPENROUTER_API_KEY") or ""
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
PARSE_MODEL = os.getenv("PARSE_MODEL", "openai/gpt-4o-mini")
LLM_TIMEOUT_SECONDS = 15

# Camera counting. "openrouter": a vision model on OpenRouter counts items in each
# frame (images leave the device). "local": YOLO on this machine only.
VISION_BACKEND = os.getenv("VISION_BACKEND", "openrouter").lower()
VISION_MODEL = os.getenv("VISION_MODEL", "google/gemini-2.5-flash")
VISION_FALLBACK = os.getenv("VISION_FALLBACK", "local").lower()  # "local" or "none"
VISION_MIN_INTERVAL = float(os.getenv("VISION_MIN_INTERVAL", "1.5"))  # seconds between calls (cost cap)
VISION_TIMEOUT_SECONDS = 20
VISION_MAX_SIDE = 768  # downscale before upload: less data out, lower cost

# Local detection: open-vocabulary YOLO-World + COCO-trained YOLO11, merged.
# Weights download into backend/ on first run.
YOLO_WORLD_WEIGHTS = os.getenv("YOLO_WORLD_WEIGHTS") or os.getenv("YOLO_WEIGHTS", "yolov8s-worldv2.pt")
COCO_WEIGHTS = os.getenv("COCO_WEIGHTS", "yolo11s.pt")
DETECT_IMGSZ = int(os.getenv("DETECT_IMGSZ", "640"))
# Every box the detectors return (>= CONF_ACCEPT) counts toward the checklist,
# even low-confidence ones. Boxes under CONF_CONFIDENT still count but are drawn
# dashed and flagged "low confidence" so staff can glance at them.
CONF_ACCEPT = float(os.getenv("CONF_ACCEPT", "0.10"))
CONF_REVIEW = float(os.getenv("CONF_REVIEW", str(CONF_ACCEPT)))  # detector floor
CONF_CONFIDENT = float(os.getenv("CONF_CONFIDENT", "0.25"))  # display only
# OpenRouter frames arrive ~every 1.5–3 s, so remember fewer of them.
SMOOTH_WINDOW = int(os.getenv("SMOOTH_WINDOW", "2" if VISION_BACKEND == "openrouter" else "3"))
# Frames out of the last SMOOTH_WINDOW a count must appear in. 1 = any single detection counts.
SMOOTH_MIN_HITS = int(os.getenv("SMOOTH_MIN_HITS", "1"))
MAX_FRAME_BYTES = 5 * 1024 * 1024
ALLOWED_FRAME_TYPES = {"image/jpeg", "image/png", "image/webp"}

# HMAC key for session and pickup tokens. Random per process if unset,
# so all tokens become invalid on restart.
SIGNING_SECRET = (os.getenv("SIGNING_SECRET") or secrets.token_hex(32)).encode()
PICKUP_TTL_SECONDS = int(os.getenv("PICKUP_TTL_SECONDS", "3600"))

DATA_DIR = ROOT / "data"
FRONTEND_DIR = ROOT / "frontend"
