"""Recover unused pre-race records while preserving the original evaluation cohort."""

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

from .source import (GRADES, card_input, checked_time, encode, get_page, payload, query,
                     result_data, source_url, stamp, state, write)


ENGINE_PATHS = ("line_history", "routed_history", "b_upset")


def freeze_shape(race, race_id, saved, cutoff):
    return card_input({
        "input": race, "race_id": race_id, "saved_at": saved, "cutoff": cutoff,
        "pre_race": True, "identity": [[r["no"], r["meta"]["rider_id"], r["name"]] for r in race["riders"]],
    })


def engine_card(record, group):
    out = record["out"]
    if out["mode"] != "pre-race":
        raise ValueError("engine record was not saved before the race")
    inputs = out["input"]
    if group == "line_history":
        race, as_of, cutoff = inputs["race"], inputs["as_of"], inputs["cutoff"]
    else:
        race, as_of, cutoff = inputs, out["as_of"], out["cutoff"]
    if not checked_time(as_of, record["saved_at"], cutoff):
        raise ValueError("engine input timing mismatch")
    return freeze_shape(race, record["race_id"], record["saved_at"], cutoff)


def published_card(raw, day, published, saved, source_url):
    if (raw.get("is_girls") is not False or raw.get("result_top3")
            or raw.get("result_combos") or any((raw.get("payouts") or {}).values())):
        raise ValueError("not an unfinished men's racecard")
    entry = raw["entries"]
    if len(entry) not in (7, 9) or any(r.get("is_absent") for r in entry):
        raise ValueError("card with unsupported field size or withdrawal")
    line_map = defaultdict(dict)
    riders = []
    for r in entry:
        match = re.fullmatch(r"(\d+)-(\d+)", str(r.get("line_position", "")))
        if not match:
            raise ValueError("no documented line position")
        group, position = map(int, match.groups())
        if position in line_map[group]:
            raise ValueError("line position conflict")
        car = int(r["car_number"])
        line_map[group][position] = car
        riders.append({"no": car, "name": r["rider_full_name"], "score": r["competition_score"],
                       "style": r["running_style"], "meta": {"rider_id": r["rider_id"], "rank": r["class_rank"]}})
    if any(sorted(line) != list(range(1, len(line)+1)) for line in line_map.values()):
        raise ValueError("line position sequence is incomplete")
    grade = raw["grade"]
    if grade not in GRADES:
        grade = {"F1":"FI", "F2":"FII", "G1":"GI", "G2":"GII", "G3":"GIII"}.get(grade)
    no, venue, start = int(raw["race_number"]), raw["venue"], raw["start_time"]
    race = {"date": day, "venue": venue, "race_no": no, "start": start, "riders": riders,
            "class": raw["round_name"], "grade": grade, "lineup": [
                [line[k] for k in sorted(line)] for _, line in sorted(line_map.items())],
            "source": {"mode": "live-public-feed", "url": source_url, "generated_at": published}}
    return freeze_shape(race, f"{day}:{venue}:{no}", saved, f"{day}T{start}:00+09:00")


def add(rows, row, path, channel):
    row["feature_path"] = path
    row["archive_channel"] = channel
    row["feature_sha256"] = sha256(encode(row)).hexdigest()
    old = rows.get(row["race_id"])
    if old is None or stamp(row["saved_at"]) < stamp(old["saved_at"]):
        rows[row["race_id"]] = row


def collect_cards(root, skip, public_checkout, refs):
    rows, failed, new_by_channel = {}, Counter(), defaultdict(set)
    for group in ENGINE_PATHS:
        for path in sorted((root / "data" / group).glob("*/*.json")):
            if len(path.stem) != 64:
                continue
            with path.open("rb") as archive:
                match = re.search(rb'"race_id"\s*:\s*"([^"]+)"', archive.read(4096))
            if match and match[1].decode() in skip:
                continue
            record = payload(path)
            if record.get("race_id") in skip:
                continue
            try:
                row = engine_card(record, group)
                add(rows, row, str(path.relative_to(root)), group)
                new_by_channel[group].add(row["race_id"])
            except (ValueError, KeyError, TypeError) as error:
                failed[f"{group}:{error}"] += 1
    for ref, day in refs:
        revision = subprocess.check_output(["git", "-C", str(public_checkout), "rev-parse", ref]).decode().strip()
        saved = subprocess.check_output(["git", "-C", str(public_checkout), "show", "-s", "--format=%cI", revision]).decode().strip()
        feed = json.loads(subprocess.check_output(
            ["git", "-C", str(public_checkout), "show", f"{revision}:{day}.json"]))
        if feed["date"] != day:
            raise ValueError("public racecard date mismatch")
        url = f"https://github.com/kurinaka12-afk/keirin-app-data/blob/{revision}/{day}.json"
        for item in feed["races"]:
            if f"{day}:{item['venue']}:{item['race_number']}" in skip:
                continue
            try:
                row = published_card(item, day, feed["generated_at"], saved, url)
                add(rows, row, f"{revision}:{day}.json", "public_commit")
                new_by_channel["public_commit"].add(row["race_id"])
            except (ValueError, KeyError, TypeError) as error:
                failed[f"public_commit:{error}"] += 1
    return rows, failed, {k: len(v) for k, v in new_by_channel.items()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--baseline", type=Path, action="append", required=True)
    parser.add_argument("--public-checkout", type=Path)
    parser.add_argument("--ref-day", nargs=2, action="append", default=[])
    parser.add_argument("--venue-page", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.ref_day and not args.public_checkout:
        parser.error("--public-checkout is required with --ref-day")
    ids = {row["race_id"] for file in args.baseline for row in payload(file)}
    rows, failures, source_counts = collect_cards(args.root, ids, args.public_checkout, args.ref_day)
    if args.venue_page:
        venues = {v["name"]: v for v in query(state(args.venue_page.read_text()),
                                              "FETCH_KEIRIN_VENUE_LIST")["venues"]}
        meetings = payload(args.root / "data/roi/meeting-days.json")
        for row in rows.values():
            if stamp(row["start"]) >= datetime.now(timezone.utc):
                continue
            try:
                url = source_url(row, venues, meetings)
                row["result"] = result_data(state(get_page(url)), row, url)
            except (OSError, ValueError, KeyError, TypeError, StopIteration) as error:
                failures[f"result:{row['race_id']}:{error}"] += 1
                if getattr(error, "code", None) in (403, 429):
                    break
    write(args.out, {"rows": sorted(rows.values(), key=lambda row: row["race_id"]),
                     "source_counts": source_counts, "errors": failures})
