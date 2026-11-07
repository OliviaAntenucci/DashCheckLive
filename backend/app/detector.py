"""Local object detection. Frames never leave this machine.

Two models run on each frame and their boxes are merged:
  - YOLO-World (open-vocabulary): finds anything we can describe in words,
    e.g. "small sauce cup". Flexible but lower-confidence.
  - YOLO11 trained on COCO (closed-set): only 80 classes, but very reliable for
    the ones it knows (bottle, cup, fork, sandwich, donut, apple, ...).
Either model alone is enough to run; both load in the background at startup.
"""

import importlib.util
import io
import threading

from PIL import Image, ImageOps

from . import config
from .labels import coco_map, prompts_for


class DetectorUnavailable(Exception):
    pass


class DetectorLoading(Exception):
    pass


def _iou(a: list[float], b: list[float]) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def merge_boxes(boxes: list[dict], width: int, height: int) -> list[dict]:
    """Greedy NMS across both models and all prompts.

    Same label overlapping >50% is one object (keep the most confident).
    Different labels overlapping >80% are one object seen two ways.
    Boxes covering most of the frame are usually the table, not an item.
    """
    frame_area = width * height
    kept: list[dict] = []
    for b in sorted(boxes, key=lambda x: -x["conf"]):
        x1, y1, x2, y2 = b["box"]
        if (x2 - x1) * (y2 - y1) > 0.85 * frame_area:
            continue
        if any(_iou(b["box"], k["box"]) > (0.5 if k["label"] == b["label"] else 0.8) for k in kept):
            continue
        kept.append(b)
    # A box mostly inside a bigger box of the same label is a piece of it
    # (tofu cubes inside the tofu dish), not a second item.
    return [b for b in kept if not any(
        k is not b and k["label"] == b["label"] and _area(k["box"]) > _area(b["box"])
        and _inside(b["box"], k["box"]) > 0.7 for k in kept)]


def _area(box: list[float]) -> float:
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def _inside(small: list[float], big: list[float]) -> float:
    """Fraction of `small` that lies within `big`."""
    ix = max(0.0, min(small[2], big[2]) - max(small[0], big[0]))
    iy = max(0.0, min(small[3], big[3]) - max(small[1], big[1]))
    area = _area(small)
    return ix * iy / area if area else 0.0


class Detector:
    def __init__(self) -> None:
        self._world = None
        self._world_prompts: tuple[str, ...] | None = None
        self._coco = None
        self._lock = threading.Lock()
        self.state = "idle"  # idle -> loading -> ready | error
        self.errors: dict[str, str] = {}

    def status(self) -> dict:
        if self.state == "idle" and importlib.util.find_spec("ultralytics") is None:
            return {"state": "not installed", "backends": [], "errors": {}}
        backends = [name for name, m in (("yolo-world", self._world), ("yolo-coco", self._coco)) if m]
        return {"state": self.state, "backends": backends, "errors": self.errors}

    def warm_up(self) -> None:
        """Load both models in a background thread so the first frame isn't a multi-minute wait."""
        if self.state != "idle" or importlib.util.find_spec("ultralytics") is None:
            return
        self.state = "loading"
        threading.Thread(target=self._load, daemon=True, name="detector-warmup").start()

    def _load(self) -> None:
        from ultralytics import YOLO, YOLOWorld

        with self._lock:
            try:
                world = YOLOWorld(config.YOLO_WORLD_WEIGHTS)
                world.set_classes(["bottle"])  # forces the CLIP text encoder to load now
                self._world, self._world_prompts = world, ("bottle",)
            except Exception as e:
                self.errors["yolo-world"] = f"{type(e).__name__}: {e}"[:200]
                print(f"YOLO-World unavailable: {e}")
            try:
                self._coco = YOLO(config.COCO_WEIGHTS)
            except Exception as e:
                self.errors["yolo-coco"] = f"{type(e).__name__}: {e}"[:200]
                print(f"COCO model unavailable: {e}")
            self.state = "ready" if (self._world or self._coco) else "error"
            print(f"Detector {self.state}: {self.status()['backends']}")

    def detect(self, image_bytes: bytes, labels: list[str]) -> dict:
        """Return {"width", "height", "boxes": [{label, conf, box:[x1,y1,x2,y2], model}]}."""
        if self.state == "idle":
            self.warm_up()
        if self.state == "loading":
            raise DetectorLoading("Vision models are loading (first run downloads them)…")
        if self.state != "ready":
            raise DetectorUnavailable("No vision model available; confirm items by hand")

        try:
            image = Image.open(io.BytesIO(image_bytes))
            image.verify()  # reject truncated/garbage files before decoding fully
            image = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
        except Exception as e:
            raise ValueError("not a valid image") from e

        boxes: list[dict] = []
        with self._lock:  # one shared model each; set_classes + predict must not interleave
            if self._world is not None:
                prompts, back = prompts_for(labels)
                if tuple(prompts) != self._world_prompts:
                    self._world.set_classes(prompts)
                    self._world_prompts = tuple(prompts)
                r = self._world.predict(image, conf=config.CONF_REVIEW, iou=0.5,
                                        imgsz=config.DETECT_IMGSZ, verbose=False)[0]
                boxes += self._boxes(r, lambda name: back.get(name), "world")

            mapping = coco_map(labels)
            if self._coco is not None and mapping:
                ids = [i for i, name in self._coco.names.items() if name in mapping]
                r = self._coco.predict(image, conf=config.CONF_REVIEW, iou=0.5, classes=ids,
                                       imgsz=config.DETECT_IMGSZ, verbose=False)[0]
                boxes += self._boxes(r, lambda name: mapping.get(name), "coco")

        return {"width": image.width, "height": image.height,
                "boxes": merge_boxes(boxes, image.width, image.height)}

    @staticmethod
    def _boxes(result, to_label, model: str) -> list[dict]:
        out = []
        for xyxy, conf, cls in zip(result.boxes.xyxy.tolist(), result.boxes.conf.tolist(),
                                   result.boxes.cls.tolist()):
            label = to_label(result.names[int(cls)])
            if label:
                out.append({"label": label, "conf": round(float(conf), 3),
                            "box": [round(v, 1) for v in xyxy], "model": model})
        return out


detector = Detector()
