"""Build a read-only catalog of actual immutable research files; no predictions."""
import json
import re
from pathlib import Path

def build(root):
    area = Path(root) / "data/mrt_research/micro_forward"
    ids = []
    for p in (area / "snapshots").glob("*.json"):
        if re.fullmatch(r"\d{12}", p.stem) and p.is_file():
            ids.append(p.stem)
    return {"schema": "tk-mrt-micro-view-index/v1", "race_ids": sorted(set(ids))}

if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    target = root / "data/mrt_research/micro_forward/view_index.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(build(root), ensure_ascii=False, indent=2) + "\n")
