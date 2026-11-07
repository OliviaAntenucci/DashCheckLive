"""Frame smoothing and expected-vs-detected comparison."""

from collections import Counter, deque
from statistics import median_low

from . import config


class Smoother:
    """Median count per label over the last N frames, so the checklist doesn't flicker."""

    def __init__(self, window: int = config.SMOOTH_WINDOW) -> None:
        self.frames: deque[Counter] = deque(maxlen=window)

    def reset(self) -> None:
        self.frames.clear()

    def push(self, counts: Counter) -> dict[str, int]:
        self.frames.append(counts)
        labels = set().union(*self.frames)
        return {label: median_low([f.get(label, 0) for f in self.frames]) for label in labels}


def compare(
    expected: dict[str, int],
    excluded: list[str],
    detected: dict[str, int],
    review: set[str],
    sources: dict[str, str] | None = None,
) -> tuple[list[dict], bool]:
    """Return (checklist rows, all_ok).

    Status per row:
      ok          detected count meets expected (or excluded item absent)
      missing     fewer detected than expected
      check       fewer detected, but a low-confidence box exists: staff should look
      unexpected  customer asked to leave this out, but it's in frame
    """
    sources = sources or {}
    rows = []
    for label, want in sorted(expected.items()):
        got = detected.get(label, 0)
        if got >= want:
            status = "ok"
        elif label in review:
            status = "check"
        else:
            status = "missing"
        rows.append(
            {"label": label, "expected": want, "detected": got, "status": status,
             "source": sources.get(label, "menu")}
        )
    for label in sorted(excluded):
        got = detected.get(label, 0)
        rows.append(
            {"label": label, "expected": 0, "detected": got,
             "status": "ok" if got == 0 else "unexpected", "source": "note"}
        )
    return rows, all(r["status"] == "ok" for r in rows)
