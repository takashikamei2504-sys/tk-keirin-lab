"""Summarize observed coverage and missing features in the sealed input bundle."""
import argparse
from collections import Counter, defaultdict
from pathlib import Path

from .source import COMMON, PERSONAL, payload, write


def counts(rows):
    found = [r["result"] for r in rows if r["result"]]
    return {
        "snapshots": len(rows), "confirmed": sum(r["confirmed"] for r in found),
        "B_and_top3": sum(bool(r["labels"]) for r in found),
        "exacta_payout": sum(bool(r["payouts"]) for r in found),
        "full_final_odds": sum(bool(r["final_quote"]) for r in found),
        "accident": sum(r["accident"] for r in found),
        "t10_quote_records": sum(r.get("t10") is not None for r in rows),
        "t5_quote_records": sum(r.get("t5") is not None for r in rows),
    }


def summarize(rows):
    groups = defaultdict(list)
    for row in rows:
        field = str(len(row["cars"]))
        for key in ("all", f"field:{field}", f"group:{row['class']}",
                    f"{field}:{row['split']}", f"{field}:{row['class']}"):
            groups[key].append(row)
    athletes = [rider for row in rows for rider in row["personal"]]
    def null_share(values, names):
        return {name: sum(item[i] is None for item in values) / len(values) for i, name in enumerate(names)}
    return {"counts": {group: counts(data) for group, data in groups.items()},
            "by_date": dict(Counter(row["date"] for row in rows)),
            "common_missing": null_share([r["common"] for r in rows], COMMON),
            "personal_missing": null_share(athletes, PERSONAL)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, action="append", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    write(args.out, summarize([row for path in args.dataset for row in payload(path)]))
