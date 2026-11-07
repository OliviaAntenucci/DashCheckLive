"""Vision vocabulary.

Each checklist label maps to:
  prompts  several phrasings for YOLO-World (open-vocabulary). Asking for
           "soda bottle" and "plastic bottle" as well as "bottle" catches far
           more real objects than one word alone.
  coco     class names in the COCO-trained YOLO model. These classes are
           detected much more reliably and act as a second opinion.
"""

VISION_LABELS: dict[str, dict] = {
    "bottle": {"prompts": ["bottle", "soda bottle", "plastic bottle", "water bottle", "glass bottle"],
               "coco": ["bottle"]},
    "can": {"prompts": ["soda can", "aluminum can", "drink can", "beverage can"], "coco": []},
    "energy drink": {"prompts": ["monster energy drink can", "energy drink can", "tall energy drink can"],
                     "coco": []},
    # Dishes: the whole dish/container is one item. Prompts avoid bare "tofu",
    # which made detectors box each cube.
    "tofu": {"prompts": ["dish of tofu", "tofu in a container", "plate of tofu", "tofu package"], "coco": [],
             "note": "a whole dish, container or package of tofu is ONE item; never count individual tofu cubes"},
    "salad": {"prompts": ["bowl of salad", "salad container", "salad"], "coco": ["bowl"],
              "note": "one bowl or container of salad is ONE item; never count leaves or toppings"},
    "knife": {"prompts": ["knife", "plastic knife", "butter knife"], "coco": ["knife"]},
    "sandwich": {"prompts": ["sandwich", "sub sandwich", "wrapped sandwich"], "coco": ["sandwich"]},
    "hot dog": {"prompts": ["hot dog", "hot dog in a bun"], "coco": ["hot dog"]},
    "pizza": {"prompts": ["pizza", "pizza slice"], "coco": ["pizza"]},
    "donut": {"prompts": ["donut", "doughnut"], "coco": ["donut"]},
    "apple": {"prompts": ["apple"], "coco": ["apple"]},
    "banana": {"prompts": ["banana"], "coco": ["banana"]},
    "orange": {"prompts": ["orange", "orange fruit", "mandarin"], "coco": ["orange"]},
    "sauce cup": {"prompts": ["small sauce cup", "condiment cup", "dipping sauce cup", "small plastic cup with lid"],
                  "coco": ["cup"]},
    "fork": {"prompts": ["fork", "plastic fork"], "coco": ["fork"]},
    "spoon": {"prompts": ["spoon", "plastic spoon"], "coco": ["spoon"]},
}


def prompts_for(labels: list[str]) -> tuple[list[str], dict[str, str]]:
    """Return (unique prompt list, prompt -> label)."""
    back: dict[str, str] = {}
    for label in labels:
        for prompt in VISION_LABELS.get(label, {"prompts": [label]})["prompts"]:
            back.setdefault(prompt, label)
    return list(back), back


def coco_map(labels: list[str]) -> dict[str, str]:
    """COCO class name -> label, for the labels in this order."""
    out: dict[str, str] = {}
    for label in labels:
        for name in VISION_LABELS.get(label, {}).get("coco", []):
            out.setdefault(name, label)
    return out
