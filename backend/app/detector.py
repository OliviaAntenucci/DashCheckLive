"""Local object detection with YOLO-World. Frames never leave this machine."""

import importlib.util
import io
import threading

from PIL import Image

from . import config


class DetectorUnavailable(Exception):
    pass


class Detector:
    def __init__(self) -> None:
        self._model = None
        self._classes: tuple[str, ...] | None = None
        self._lock = threading.Lock()
        self.error: str | None = None

    def status(self) -> str:
        if self._model is not None:
            return "ready"
        if self.error:
            return f"error: {self.error}"
        if importlib.util.find_spec("ultralytics") is None:
            return "not installed"
        return "available (loads on first frame)"

    def _load(self) -> None:
        try:
            from ultralytics import YOLOWorld

            self._model = YOLOWorld(config.YOLO_WEIGHTS)
        except Exception as e:
            self.error = type(e).__name__
            raise DetectorUnavailable(f"Detector failed to load: {e}") from e

    def detect(self, image_bytes: bytes, labels: list[str]) -> dict:
        """Return {"width", "height", "boxes": [{label, conf, box:[x1,y1,x2,y2]}]}."""
        try:
            image = Image.open(io.BytesIO(image_bytes))
            image.verify()  # reject truncated/garbage files before decoding fully
            image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        except Exception as e:
            raise ValueError("not a valid image") from e

        with self._lock:  # one shared model; set_classes + predict must not interleave
            if self._model is None:
                if importlib.util.find_spec("ultralytics") is None:
                    raise DetectorUnavailable("ultralytics not installed; use staff confirmation")
                self._load()
            classes = tuple(labels)
            if classes != self._classes:
                self._model.set_classes(list(classes))
                self._classes = classes
            result = self._model.predict(image, conf=config.CONF_REVIEW, verbose=False)[0]

        boxes = []
        for xyxy, conf, cls in zip(result.boxes.xyxy.tolist(), result.boxes.conf.tolist(),
                                   result.boxes.cls.tolist()):
            boxes.append({"label": result.names[int(cls)], "conf": round(float(conf), 3),
                          "box": [round(v, 1) for v in xyxy]})
        return {"width": image.width, "height": image.height, "boxes": boxes}


detector = Detector()
