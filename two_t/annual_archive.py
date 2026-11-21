"""Fetch pinned monthly race facts and reconstruct date-disjoint rider histories."""
import argparse
from collections import Counter, defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import date, timedelta
from hashlib import sha1, sha256
from pathlib import Path
import re
from urllib.request import urlopen

from .source import payload, write

TRAIN_START = date(2025, 1, 1)
VALIDATION_START = date(2026, 1, 1)
TEST_START = date(2026, 2, 1)
END = date(2026, 11, 16)
RACE_ID = re.compile(r"(\d\d)(\d{8})(\d\d)00(\d\d)")
PAYOUT = re.compile(r"([1-9])-([1-9])\s*([\d,]+)円")
MEN = {"SS", "S1", "S2", "A1", "A2", "A3"}


def verify(blob, expected):
    return sha1(f"blob {len(blob)}\0".encode() + blob).hexdigest() == expected


def fetch(cache, manifest):
    cache.mkdir(parents=True, exist_ok=True)

    def get(item):
        name, digest = item
        path = cache / name
        if path.exists() and verify(path.read_bytes(), digest):
            return path
        url = f"https://raw.githubusercontent.com/{manifest['repository']}/{manifest['commit']}/keirin_data/{name}"
        with urlopen(url, timeout=45) as response:
            blob = response.read()
        if not verify(blob, digest):
            raise ValueError(f"archive checksum mismatch: {name}")
        pending = path.with_suffix(".download")
        pending.write_bytes(blob)
        pending.replace(path)
        return path

    with ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(get, sorted(manifest["files"].items())))


def digits(word):
    return int(word) if word.isdecimal() else None


def rider_id(row):
    # Some releases split the first character of the prefecture into the name.
    names = row["player_name"].split()
    term = digits(re.sub(r"\.0+$", "", row["term"]))
    if len(names) < 2 or not term or not all(len(x) > 0 for x in names[:2]):
        return None
    if len(names) > 3 or (len(names) == 3 and len(names[2]) != 1):
        return None
    return "".join(names[:2]), term


def read_races(paths):
    by_id = {}
    conflicting = set()
    invalid = Counter()
    for path in paths:
        with path.open(encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                race_id = row["race_id"]
                if not (match := RACE_ID.fullmatch(race_id)):
                    invalid["race_id_rows"] += 1
                    continue
                track, meeting, session, race = match.groups()
                try:
                    supplied_day = date.fromisoformat(row["date"])
                    meeting_start = date.fromisoformat(meeting)
                    day = meeting_start + timedelta(days=int(session)-1)
                except ValueError:
                    invalid["bad_date_rows"] += 1
                    continue
                car = digits(row["banum"])
                if day > END:
                    continue
                if supplied_day not in (day, meeting_start) or not 1 <= int(session) <= 7 or digits(row["race_no"]) != int(race):
                    conflicting.add(race_id)
                    invalid["date_or_race_number_rows"] += 1
                    continue
                if supplied_day != day:
                    invalid["meeting_start_date_normalized_rows"] += 1
                if car not in range(1, 10):
                    conflicting.add(race_id)
                    invalid["car_rows"] += 1
                    continue
                value = (rider_id(row), row["player_class"], row["rank"].strip(), row["ni_sha_tan"].strip())
                day_key = (day, track, row["venue_slug"])
                saved, riders = by_id.setdefault(race_id, (day_key, {}))
                if day_key != saved or (car in riders and riders[car] != value):
                    conflicting.add(race_id)
                riders[car] = value
    invalid["identity_or_date_conflicting_races"] = len(conflicting)
    return sorted((key, rid, riders) for rid, (key, riders) in by_id.items() if rid not in conflicting), invalid


def payout(riders, labels):
    entries = {value[3] for value in riders.values()}
    if len(entries) != 1:
        return None
    picks = PAYOUT.findall(entries.pop())
    if len(picks) != 1:
        return None
    a, b, amount = picks[0]
    yen = int(amount.replace(",", ""))
    return yen if yen > 0 and [int(a), int(b)] == labels[:2] else None


def rider_features(history, day, track):
    # Drop near-boundary results because this archive does not preserve publication timestamps.
    mature = day - timedelta(days=7)
    history = [event for event in history or () if event[0] <= mature]
    if not history:
        return [None] * 19
    old = [r for r in history if day - r[0] <= timedelta(days=120)]
    at_track = [r for r in old if r[1] == track]
    tail = [r[2] for r in list(history)[-10:]][::-1]
    output = []
    for recent in (old, at_track, list(history)):
        ranks = [r[2] for r in recent]
        output.extend([len(ranks), *[sum(x <= n for x in ranks) / len(ranks) if ranks else None
                                     for n in (1, 2, 3)]])
    output.extend((tail + [None] * 3)[:3])
    for level in (1, 2, 3):
        output.append(next((i for i, rank in enumerate(tail) if rank > level), len(tail)))
    output.append((day - history[-1][0]).days)
    return output


def partition(day):
    if day < TRAIN_START:
        return "warmup"
    if day < VALIDATION_START:
        return "train"
    return "validation" if day < TEST_START else "test"


def construct(paths, size):
    races, excluded = read_races(paths)
    history = defaultdict(deque)
    pending = {}
    day_before = None
    rows = []
    monthly = defaultdict(Counter)
    for (day, track, _), race_id, riders in races:
        if day != day_before:
            for rider, event in pending.items():
                if event is not None:
                    history[rider].append(event)
            pending.clear()
            day_before = day
        classes = [row[1] for row in riders.values()]
        if not classes or not set(classes) <= MEN:
            continue
        tier = "S" if all(x.startswith("S") for x in classes) else ("challenge" if "A3" in classes else "A")
        cars = sorted(riders)
        keys = [riders[c][0] for c in cars]
        ranks = [digits(riders[c][2]) for c in cars]
        candidate = len(cars) == size and partition(day) != "warmup"
        bucket = monthly[day.strftime("%Y-%m")]
        if candidate:
            bucket["candidate"] += 1
            if None in keys or len(set(keys)) != size:
                bucket["unresolved_rider"] += 1
            elif len(set(ranks)) != size or set(ranks) != set(range(1, size + 1)):
                bucket["incomplete_or_abnormal_result"] += 1
            else:
                targets = [cars[ranks.index(rank)] for rank in (1, 2, 3)]
                amount = payout(riders, targets)
                if amount is None:
                    bucket["payout_unverified"] += 1
                else:
                    personal = [rider_features(history.get(key), day, track) for key in keys]
                    bucket["riders_without_history"] += sum(feats[0] is None for feats in personal)
                    bucket["usable"] += 1
                    rows.append({"race_id": race_id, "date": day.isoformat(), "split": partition(day),
                                 "cars": cars, "tier": tier, "common": [int(track), tier == "S", tier == "challenge"],
                                 "personal": personal, "targets": targets, "payout_yen": amount})
        for key, rank in zip(keys, ranks, strict=True):
            if key is not None and rank is not None and 1 <= rank <= len(cars):
                pending[key] = None if key in pending else (day, track, rank)
    report = {"train_window": [TRAIN_START.isoformat(), (VALIDATION_START-timedelta(days=1)).isoformat()],
              "validation_start": VALIDATION_START.isoformat(), "test_window": [TEST_START.isoformat(), END.isoformat()],
              "identified_races_all_fields": len(races), "rejected": dict(excluded), "car_count": size,
              "counts": dict(Counter(x["split"] for x in rows)), "monthly": dict(monthly),
              "files": {p.name: sha256(p.read_bytes()).hexdigest() for p in paths}}
    return rows, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--size", type=int, choices=(7, 9), default=9)
    args = parser.parse_args()
    source = payload(Path(__file__).with_name("annual_sources.json"))
    rows, report = construct(fetch(args.cache, source), args.size)
    args.out.mkdir(parents=True, exist_ok=True)
    write(args.out / f"annual-{args.size}.json", rows)
    write(args.out / f"coverage-{args.size}.json", report)
    print(report["counts"], flush=True)


if __name__ == "__main__":
    main()
