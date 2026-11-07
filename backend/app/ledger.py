"""Append-only, hash-chained event log (tamper-evident audit trail).

Each event stores the SHA-256 of the previous event. Editing, deleting, or
reordering any past line breaks every hash after it, which verify() detects.
This makes tampering *detectable*, not impossible: someone with file access
could rewrite the whole chain. Production would anchor the head hash
externally (e.g. periodically to a separate service).

No personal data goes in here: only order IDs, staff/dasher IDs, and hashes.
"""

import hashlib
import json
import threading
import time
from pathlib import Path

GENESIS = "0" * 64


def _digest(event: dict) -> str:
    body = {k: v for k, v in event.items() if k != "hash"}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class Ledger:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self.events: list[dict] = []
        if self.path.exists():
            for line in self.path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    self.events.append(json.loads(line))

    def append(self, event_type: str, actor: str, **data) -> dict:
        with self._lock:
            event = {
                "seq": len(self.events),
                "ts": round(time.time(), 3),
                "type": event_type,
                "actor": actor,
                "data": data,
                "prev": self.events[-1]["hash"] if self.events else GENESIS,
            }
            event["hash"] = _digest(event)
            self.events.append(event)
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(event, sort_keys=True) + "\n")
            return event

    def verify(self) -> dict:
        prev = GENESIS
        for i, event in enumerate(self.events):
            if event.get("prev") != prev or event.get("hash") != _digest(event) or event.get("seq") != i:
                return {"valid": False, "broken_at": i}
            prev = event["hash"]
        return {"valid": True, "head": prev, "count": len(self.events)}
