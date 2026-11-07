"""Menu catalog, sample receipts, and in-memory order state.

Orders load from sample_data/doordash_sample_receipts.json: fictional demo
orders laid out like a DoorDash merchant receipt. In production they would come
from the DoorDash order pipeline, and the restaurant's tablet would only ever
see the minimized `public()` view.
"""

import json
from dataclasses import dataclass, field
from pathlib import Path

from .checklist import Smoother

SAMPLE_FILE = Path(__file__).parent / "sample_data" / "doordash_sample_receipts.json"
TAX_RATE = 0.07

# Every menu item maps to a label the local detector looks for (see labels.py).
MENU = {
    "turkey_club": {"name": "Turkey Club Sandwich", "detect": "sandwich", "price": 11.49},
    "bottled_soda": {"name": "Bottled Soda (20 oz)", "detect": "bottle", "price": 2.49},
    "canned_soda": {"name": "Canned Soda", "detect": "can", "price": 1.99},
    "monster_energy": {"name": "Monster Energy (16 oz can)", "detect": "energy drink", "price": 3.49},
    "bottled_water": {"name": "Bottled Water", "detect": "bottle", "price": 1.79},
    "tofu_block": {"name": "Organic Firm Tofu", "detect": "tofu", "price": 2.99},
    "garden_salad": {"name": "Garden Salad", "detect": "salad", "price": 8.99},
    "knife": {"name": "Knife", "detect": "knife", "price": 0.00},
    "spoon": {"name": "Spoon", "detect": "spoon", "price": 0.00},
    "hot_dog": {"name": "All-Beef Hot Dog", "detect": "hot dog", "price": 4.99},
    "pizza_slice": {"name": "Cheese Pizza Slice", "detect": "pizza", "price": 3.99},
    "glazed_donut": {"name": "Glazed Donut", "detect": "donut", "price": 1.79},
    "apple": {"name": "Fresh Apple", "detect": "apple", "price": 0.99},
    "banana": {"name": "Banana", "detect": "banana", "price": 0.79},
    "orange": {"name": "Orange", "detect": "orange", "price": 0.99},
    "ranch_cup": {"name": "Ranch Cup", "detect": "sauce cup", "price": 0.50},
    "mustard_cup": {"name": "Mustard Cup", "detect": "sauce cup", "price": 0.00},
    "fork": {"name": "Fork", "detect": "fork", "price": 0.00},
}

# Customer notes may add (or ask to leave out) only these free extras.
# Notes can never remove a paid menu item; that takes a staff override.
NOTE_EXTRAS = {"sauce cup": 4, "fork": 4}


def _load_samples() -> tuple[dict, list[dict]]:
    data = json.loads(SAMPLE_FILE.read_text(encoding="utf-8"))
    return data["store"], data["orders"]


@dataclass
class Order:
    id: str
    ref: str
    placed_at: str
    fulfillment: str
    customer: dict  # name/phone/address: never leaves the server (not in public(), logs, or LLM calls)
    dasher: dict
    items: list[dict]
    customer_note: str

    # Workflow: new -> prepared -> sealed -> picked_up
    status: str = "new"
    scrubbed_note: str = ""
    redactions: dict[str, int] = field(default_factory=dict)
    parsed: dict | None = None
    expected: dict[str, int] = field(default_factory=dict)
    excluded: list[str] = field(default_factory=list)
    sources: dict[str, str] = field(default_factory=dict)
    smoother: Smoother = field(default_factory=Smoother)
    last_check: dict | None = None
    last_logged_summary: str | None = None
    seal: dict | None = None
    pickup_nonce: str | None = None

    @property
    def dasher_id(self) -> str:
        return self.dasher["id"]

    @property
    def customer_name(self) -> str:
        return self.customer["name"]

    @property
    def display_name(self) -> str:
        """First name + last initial only (least data needed to call out an order)."""
        first, *rest = self.customer_name.split()
        return f"{first} {rest[-1][0]}." if rest else first

    @property
    def delivery_city(self) -> str:
        """City + state only ("Pittsburgh, PA"): enough for staff, not the street address."""
        parts = [p.strip() for p in self.customer.get("address", "").split(",")]
        if len(parts) >= 3:
            return f"{parts[-2]}, {parts[-1].split()[0]}"
        return parts[-2] if len(parts) == 2 else ""

    @property
    def item_count(self) -> int:
        return sum(it["qty"] for it in self.items)

    def labels(self) -> list[str]:
        return sorted({MENU[it["menu"]]["detect"] for it in self.items})

    def item_names(self) -> list[str]:
        return [MENU[it["menu"]]["name"] for it in self.items]

    def base_expected(self) -> tuple[dict[str, int], dict[str, str]]:
        """Counts from the receipt itself (trusted POS data): items plus modifiers that add something."""
        counts: dict[str, int] = {}
        sources: dict[str, str] = {}
        for it in self.items:
            label = MENU[it["menu"]]["detect"]
            counts[label] = counts.get(label, 0) + it["qty"]
            sources.setdefault(label, "menu")
            for mod in it.get("modifiers", []):
                if mod.get("adds"):
                    add = MENU[mod["adds"]]["detect"]
                    counts[add] = counts.get(add, 0) + mod.get("qty", 1) * it["qty"]
                    sources.setdefault(add, "modifier")
        return counts, sources

    def receipt_prep(self) -> list[str]:
        """Modifiers the camera can't see (e.g. "No onions") become hand-check prep items."""
        return [
            f"{MENU[it['menu']]['name']}: {mod['text']}"
            for it in self.items for mod in it.get("modifiers", []) if not mod.get("adds")
        ]

    def apply_parsed(self, parsed: dict) -> None:
        self.parsed = parsed
        self.expected, self.sources = self.base_expected()
        for label, n in parsed["extras"].items():
            if n > 0:
                self.expected[label] = self.expected.get(label, 0) + n
                self.sources.setdefault(label, "note")
        # A note can ask to leave out a free extra, but not a paid item.
        self.excluded = [label for label in parsed["exclude"] if label not in self.expected]

    def receipt(self) -> dict:
        lines = []
        subtotal = 0.0
        for it in self.items:
            unit = MENU[it["menu"]]["price"] + sum(
                MENU[m["adds"]]["price"] * m.get("qty", 1) for m in it.get("modifiers", []) if m.get("adds"))
            total = round(unit * it["qty"], 2)
            subtotal += total
            lines.append({"name": MENU[it["menu"]]["name"], "qty": it["qty"], "total": total,
                          "detect": MENU[it["menu"]]["detect"],
                          "modifiers": [m["text"] for m in it.get("modifiers", [])]})
        tax = round(subtotal * TAX_RATE, 2)
        return {"lines": lines, "subtotal": round(subtotal, 2), "tax": tax,
                "total": round(subtotal + tax, 2)}

    def public(self, store: dict) -> dict:
        """The view sent to the restaurant's packing screen: no contact details, no raw note."""
        return {
            "id": self.id,
            "ref": self.ref,
            "placed_at": self.placed_at,
            "fulfillment": self.fulfillment,
            "store": store["name"],
            "delivery_city": self.delivery_city,
            "display_name": self.display_name,
            "dasher_id": self.dasher_id,
            "dasher_name": self.dasher["name"],
            "status": self.status,
            "receipt": self.receipt(),
            "note": self.scrubbed_note if self.status != "new" else None,
            "redactions": self.redactions,
            "parsed": self.parsed,
            "last_check": self.last_check,
            "seal": self.seal,
            # Need-to-know: the street address is revealed only once the order is
            # sealed (for the bag label/handoff). Phone never leaves the server.
            "delivery_address": self.customer.get("address") if self.status in ("sealed", "picked_up") else None,
        }


class OrderStore:
    def __init__(self) -> None:
        self.store: dict = {}
        self.orders: dict[str, Order] = {}
        self.reset()

    def reset(self) -> None:
        self.store, samples = _load_samples()
        self.orders = {
            s["id"]: Order(
                id=s["id"], ref=s["ref"], placed_at=s["placed_at"], fulfillment=s["fulfillment"],
                customer=s["customer"], dasher=s["dasher"], items=s["items"],
                customer_note=s.get("customer_note", ""),
            )
            for s in samples
        }

    def get(self, order_id: str) -> Order | None:
        return self.orders.get(order_id)
