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

# Local detection
YOLO_WEIGHTS = os.getenv("YOLO_WEIGHTS", "yolov8s-worldv2.pt")
CONF_ACCEPT = float(os.getenv("CONF_ACCEPT", "0.35"))
CONF_REVIEW = float(os.getenv("CONF_REVIEW", "0.20"))
SMOOTH_WINDOW = 5
MAX_FRAME_BYTES = 5 * 1024 * 1024
ALLOWED_FRAME_TYPES = {"image/jpeg", "image/png", "image/webp"}

# HMAC key for session and pickup tokens. Random per process if unset,
# so all tokens become invalid on restart.
SIGNING_SECRET = (os.getenv("SIGNING_SECRET") or secrets.token_hex(32)).encode()
PICKUP_TTL_SECONDS = int(os.getenv("PICKUP_TTL_SECONDS", "3600"))

DATA_DIR = ROOT / "data"
FRONTEND_DIR = ROOT / "frontend"
