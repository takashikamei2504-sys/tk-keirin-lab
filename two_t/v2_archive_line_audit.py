"""Audit the documented line positions in dated historical feeds.

This measures observed finishes by line. The input feeds were archived after
their race dates, so this is separate from forecast accuracy evaluation.
"""
import argparse
from collections import Counter, defaultdict
from datetime import date, timedelta
from hashlib import sha256
import json
from pathlib import Path
import re
from zipfile import ZipFile

from .source import write


def line_finish(race):
    if race.get("is_girls") is not False or race.get("n_cars") != 7:
        return "outside_scope", None
    entries = race["entries"]
    if len(entries) != 7 or any(e.get("is_absent") for e in entries):
        return "invalid_roster", None
    cars = [e.get("car_number") for e in entries]
    if len(set(cars)) != 7 or any(type(c) is not int or not 1 <= c <= 9 for c in cars):
        return "invalid_roster", None
    by_car, groups = {}, defaultdict(list)
    ranks = [str(e.get("class_rank", "")) for e in entries]
    group = ("S" if all(r.startswith("S") for r in ranks) else
             "challenge" if all(r == "A3" for r in ranks) else
             "A" if all(r in {"A1", "A2", "A3"} for r in ranks) else None)
    if group is None:
        return "invalid_class", None
    for e in entries:
        position = re.fullmatch(r"(\d+)-(\d+)", str(e.get("line_position")))
        if position is None:
            return "invalid_line", None
        line, order = map(int, position.groups())
        by_car[e["car_number"]] = (line, order)
        groups[line].append(order)
    if any(sorted(positions) != list(range(1, len(positions) + 1)) for positions in groups.values()):
        return "invalid_line", None
    order = race.get("result_top3")
    if (not isinstance(order, list) or len(order) < 2 or order[0] == order[1]
            or any(type(c) is not int or c not in by_car for c in order[:2])):
        return "missing_finish", None
    first, second = order[:2]
    exacta = (race.get("payouts") or {}).get("exacta")
    if exacta is not None and (len(exacta) != 1 or exacta[0].get("combo") != [first, second]
                               or type(exacta[0].get("payout")) is not int or exacta[0]["payout"] <= 0):
        return "ambiguous_exacta", None
    places = race.get("result_places")
    if places is not None and (not isinstance(places, list) or places[:2] != [[first], [second]]):
        return "ambiguous_finish", None
    first_line, first_position = by_car[first]
    return "scored", (group, first_line == by_car[second][0], len(groups[first_line]), first_position,
                      exacta is not None)


def run(root, source_bundle, first, last):
    with ZipFile(source_bundle) as z:
        manifest = json.loads(z.read("90day_8engine_verified_summary.json"))
    counts = Counter()
    buckets = defaultdict(Counter)
    seen = set()
    for i in range((last - first).days + 1):
        day = (first + timedelta(days=i)).isoformat()
        raw = (root / (day + ".json")).read_bytes()
        if sha256(raw).hexdigest() != manifest["source_day_sha256"][day]:
            raise ValueError(f"source digest mismatch for {day}")
        feed = json.loads(raw)
        if feed["date"] != day:
            raise ValueError(f"source date mismatch for {day}")
        for race in feed["races"]:
            key = race["race_id"]
            if key in seen:
                raise ValueError(f"duplicate race {key}")
            seen.add(key)
            status, row = line_finish(race)
            counts[status] += 1
            if row is None:
                continue
            group, won_same, line_size, position, has_exacta = row
            labels = ("all", "month:" + day[:7], "class:" + group, "winner_line_size:" + str(line_size))
            if line_size > 1:
                labels += ("winner_position:" + ("3+" if position >= 3 else str(position)),)
            if has_exacta:
                labels += ("exacta_verified_in_feed",)
            for label in labels:
                bucket = buckets[label]
                bucket["races"] += 1
                bucket["same"] += int(won_same)
                bucket["teammates"] += line_size - 1
    return {"period": [first.isoformat(), last.isoformat()], "source_commit": manifest["source_commit"],
            "counts": dict(counts), "buckets": {
                key: {**row, "same_rate": row["same"] / row["races"],
                      "uniform_conditional_rate": row["teammates"] / (6 * row["races"])}
                for key, row in sorted(buckets.items())}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--manifest-bundle", type=Path, required=True)
    parser.add_argument("--first", type=date.fromisoformat, required=True)
    parser.add_argument("--last", type=date.fromisoformat, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.last < args.first:
        parser.error("date interval must be nonempty")
    write(args.out, run(args.source, args.manifest_bundle, args.first, args.last))


if __name__ == "__main__":
    main()
