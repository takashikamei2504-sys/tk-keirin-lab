"""Read archived pre-race cards and public race result pages."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from itertools import permutations
import json
import math
from pathlib import Path
import re
from threading import Event
from urllib.error import HTTPError
from urllib.request import Request, urlopen

JST = timezone(timedelta(hours=9))
UTC = timezone.utc
BASE = "https://www.winticket.jp"
HOLDOUT = date(2026, 11, 13)
VALIDATION = date(2026, 11, 10)
GRADES = {"FII": 0, "FI": 1, "GIII": 2, "GII": 3, "GI": 4, "GP": 5}
PERSONAL = ["score", "age", "escape", "versatile", "line_position", "s", "h", "b",
            "total_4m", "first_4m", "second_4m", "third_4m", "mean_score_4m",
            "last1", "last2", "last3", "streak1", "streak2", "streak3"]
COMMON = ["date_ordinal", "track_length", "straight_length", "bank_angle", "grade",
          "s_class", "challenge"]


def stamp(value):
    dt = datetime.fromisoformat(value)
    if dt.utcoffset() is None:
        raise ValueError("timestamp must carry an offset")
    return dt


def checked_time(*values):
    times = [stamp(v) for v in values]
    return times == sorted(times)


def payload(path):
    return json.loads(path.read_bytes())


def encode(data):
    return json.dumps(data, ensure_ascii=False, sort_keys=True, allow_nan=False).encode()


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encode(data) + b"\n")


def number(value):
    return value if type(value) in (int, float) and math.isfinite(value) else None


def id_of(value):
    result = str(value).lstrip("0")
    if not result.isdecimal():
        raise ValueError("missing rider id")
    return result


def pairs(cars):
    return {f"{a}-{b}" for a, b in permutations(cars, 2)}


def split(day):
    d = date.fromisoformat(day)
    if d >= HOLDOUT:
        return "test"
    return "validation" if d >= VALIDATION else "train"


def card_input(snapshot):
    card = snapshot["input"]
    cutoff = stamp(snapshot["cutoff"])
    source = card["source"]
    saved = stamp(snapshot["saved_at"])
    if (snapshot.get("pre_race") is not True or source.get("mode") != "live-public-feed"
            or not stamp(source["generated_at"]) <= saved < cutoff
            or cutoff != stamp(f"{card['date']}T{card['start']}:00+09:00")):
        raise ValueError("unverified pre-race snapshot")
    race_id = f"{card['date']}:{card['venue']}:{card['race_no']}"
    if race_id != snapshot["race_id"]:
        raise ValueError("race identity mismatch")
    riders = sorted(card["riders"], key=lambda row: row["no"])
    cars = [r["no"] for r in riders]
    if len(cars) not in (7, 9) or len(set(cars)) != len(cars) or any(c not in range(1, 10) for c in cars):
        raise ValueError("invalid roster")
    roster = [[r["no"], id_of(r["meta"]["rider_id"])] for r in riders]
    if roster != sorted([[no, id_of(rid)] for no, rid, _ in snapshot["identity"]]):
        raise ValueError("roster identity mismatch")
    lineup = card["lineup"]
    if not all(lineup) or sorted(c for line in lineup for c in line) != cars:
        raise ValueError("lineup missing or ambiguous")
    positions = {c: (group, pos) for group, line in enumerate(lineup) for pos, c in enumerate(line)}
    people, relation = [], []
    for rider in riders:
        car = rider["no"]
        group, pos = positions[car]
        style, score, rank = rider["style"], number(rider["score"]), rider["meta"]["rank"]
        if style not in ("逃", "両", "追") or score is None or not 50 <= score <= 145:
            raise ValueError("invalid racecard fields")
        form = rider.get("recent_form") or {}
        try:
            valid_form = (form.get("verified_identity") is True
                          and checked_time(form["source_updated_at"], form["collected_at"], snapshot["saved_at"])
                          and id_of(form["rider_id"]) == id_of(rider["meta"]["rider_id"]))
        except (ValueError, KeyError, TypeError):
            valid_form = False
        if not valid_form:
            form = {}
        stats = form.get("stats") or {}
        total = number(stats.get("total"))
        recent = []
        # Meeting dates are start dates. Use only the published, archived profile.
        for meeting in form.get("recent_meetings", []):
            if meeting["date"] < card["date"]:
                recent.extend(reversed(meeting["finishes"]))
        recent = recent[:10]
        top3 = [int(v) if str(v).isdecimal() else None for v in recent[:3]]
        top3 += [None] * (3 - len(top3))
        streaks = []
        for limit in (1, 2, 3):
            streak = 0
            for finish in recent:
                if not str(finish).isdecimal() or int(finish) > limit:
                    break
                streak += 1
            streaks.append(streak if len(recent) == 10 else None)
        rates = [number(stats.get(k)) for k in ("wins", "seconds", "thirds")]
        rates = [v / total if v is not None and total and total > 0 else None for v in rates]
        # The legacy card strips age, and its zero S placeholder has no trustworthy timestamp here.
        people.append([score, None, int(style == "逃"), int(style == "両"), pos, None,
                       number(stats.get("h")), number(stats.get("b")), total, *rates,
                       number(stats.get("score")), *top3, *streaks])
        relation.append([[int(group == g and car != other), int(group == g and i == pos - 1),
                          int(group == g and i == pos + 1)] for other in cars for g, i in [positions[other]]])
    ranks = [str(r["meta"]["rank"]) for r in riders]
    klass = "S" if all(r.startswith("S") for r in ranks) else (
        "challenge" if all(r == "A3" for r in ranks) else
        "A" if all(r in {"A1", "A2", "A3"} for r in ranks) else None)
    if klass is None:
        raise ValueError("unknown class")
    return {"race_id": race_id, "date": card["date"], "venue": card["venue"], "race_no": card["race_no"],
            "class": klass, "cars": cars, "roster": roster, "lineup": lineup,
            "start": snapshot["cutoff"], "saved_at": snapshot["saved_at"], "feature_published_at": source["generated_at"],
            "feature_source": source["url"], "split": split(card["date"]), "personal": people,
            "common": [date.fromisoformat(card["date"]).toordinal(), None, None, None,
                       GRADES.get(card["grade"]), int(klass == "S"), int(klass == "challenge")],
            "relation": relation}


def read_cards(root):
    cards, reasons = {}, Counter()
    discovered = set()
    for path in sorted((root / "data/lab_history").glob("*/p-*.json")):
        p = payload(path)
        discovered.add(p["race_id"])
        try:
            row = card_input(p)
        except (ValueError, KeyError, TypeError) as error:
            reasons[str(error)] += 1
            continue
        old = cards.get(row["race_id"])
        if old is None or stamp(row["saved_at"]) < stamp(old["saved_at"]):
            row["feature_path"] = str(path.relative_to(root))
            row["feature_sha256"] = sha256(encode(row)).hexdigest()
            cards[row["race_id"]] = row
    return list(cards.values()), len(discovered), reasons


def get_page(url):
    req = Request(url, headers={"User-Agent": "TK-KEIRIN-LAB/1.0 (public race research)"})
    with urlopen(req, timeout=20) as response:
        if not response.url.startswith(BASE + "/keirin"):
            raise ValueError("invalid redirect")
        body = response.read(6_000_001)
    if len(body) > 6_000_000:
        raise ValueError("page too large")
    return body.decode()


def state(html):
    match = re.search(r"window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\});\s*window\.__CONFIG__", html)
    if not match:
        raise ValueError("source format")
    return json.loads(match[1])["tanStackQuery"]["queries"]


def query(queries, key):
    matches = [q["state"]["data"] for q in queries if key in q["queryKey"]]
    if len(matches) != 1:
        raise ValueError("source query: " + key)
    return matches[0]


def source_url(card, venues, meetings):
    day = date.fromisoformat(card["date"])
    venue = venues[card["venue"]]
    for back in range(5):
        first = day - timedelta(days=back)
        if meetings.get(first.isoformat(), {}).get(card["venue"]) == "初日":
            cup = first.strftime("%Y%m%d") + venue["id"]
            return f"{BASE}/keirin/{venue['slug']}/racecard/{cup}/{back+1}/{card['race_no']}"
    raise ValueError("meeting first day missing")


def race_data(queries, card):
    data = query(queries, "FETCH_KEIRIN_RACE")
    day = datetime.strptime(data["schedule"]["date"], "%Y%m%d").date().isoformat()
    race = data["race"]
    venue = next(v for v in data["venues"] if v["id"] == data["schedule"]["id"][-2:])
    roster = sorted([[e["number"], id_of(e["playerId"])] for e in data["entries"]])
    if (day != card["date"] or venue["name"] != card["venue"] or race["number"] != card["race_no"]
            or race["startAt"] != stamp(card["start"]).timestamp() or roster != card["roster"]):
        raise ValueError("result does not match pre-race card")
    return data, race


def result_data(queries, card, url):
    data, race = race_data(queries, card)
    if not race.get("cancel") and not data["results"]:
        raise ValueError("result pending")
    quote = query(queries, "FETCH_KEIRIN_RACE_ODDS")
    market = {}
    refund = {e["number"] for e in data["entries"] if e["absent"]}
    payouts = {}
    for item in quote.get("exacta") or []:
        key = "-".join(map(str, item["key"]))
        if (item["raceId"] != race["id"] or item["unitPrice"] != 100 or key not in pairs(card["cars"])
                or key in market):
            raise ValueError("invalid exacta quote")
        if item["absent"]:
            continue
        if number(item["odds"]) is not None and item["odds"] >= 1:
            market[key] = item["odds"]
        payoff = item["payoffUnitPrice"]
        if type(payoff) is int and payoff > 0:
            payouts[key] = payoff
    final = quote.get("finalOdds") is True and set(market) == pairs(card["cars"])
    by_player = {id_: n for n, id_ in card["roster"]}
    ranks = {}
    back = []
    accident = False
    for row in data["results"]:
        car = by_player[id_of(row["playerId"])]
        if row["back"] is True:
            back.append(car)
        accident |= bool(row["hasAccident"] or row.get("accidentName"))
        if row["order"] in (1, 2, 3):
            ranks.setdefault(row["order"], []).append(car)
    labels = [back[0], ranks[1][0], ranks[2][0], ranks[3][0]] if len(back) == 1 and all(
        len(ranks.get(i, ())) == 1 for i in (1, 2, 3)) else None
    if labels and f"{labels[1]}-{labels[2]}" not in payouts:
        raise ValueError("finish and exacta payout disagree")
    return {"labels": labels, "payouts": payouts, "refund_cars": sorted(refund),
            "cancelled": bool(race.get("cancel")), "confirmed": race.get("status") == 3 or bool(race.get("cancel")),
            "accident": accident, "result_source": url,
            "decided_at": datetime.fromtimestamp(race["decidedAt"], UTC).isoformat() if race.get("decidedAt") else None,
            "sales_close": datetime.fromtimestamp(race["closeAt"], UTC).isoformat(),
            "final_quote": {"state": "final", "odds": market, "source_url": url,
                            "published_at": datetime.fromtimestamp(quote["oddsUpdatedAt"], UTC).isoformat()} if final else None}


def collect(root, out, venue_page, cache_only=False, only_cars=None):
    cards, count, reasons = read_cards(root)
    if only_cars:
        cards = [row for row in cards if len(row["cars"]) == only_cars]
    venues = {}
    if not cache_only:
        html = get_page(venue_page) if venue_page.startswith(BASE + "/keirin/") else Path(venue_page).read_text()
        venues = {v["name"]: v for v in query(state(html), "FETCH_KEIRIN_VENUE_LIST")["venues"]}
    meetings = payload(root / "data/roi/meeting-days.json")
    blocked = Event()

    def process(card):
        cache = out / "results" / (sha256(card["race_id"].encode()).hexdigest() + ".json")
        try:
            if cache.exists():
                result = payload(cache)
            elif cache_only:
                return card, None, "not in result cache"
            else:
                url = source_url(card, venues, meetings)
                if blocked.is_set():
                    return card, None, "provider rate limit"
                result = result_data(state(get_page(url)), card, url)
                write(cache, result)
            return card, result, None
        except HTTPError as exc:
            if exc.code in (403, 429):
                blocked.set()
            return card, None, f"HTTP {exc.code}"
        except (OSError, ValueError, KeyError, TypeError, StopIteration) as exc:
            return card, None, str(exc)

    rows = []
    failures = {}
    day_slots = Counter()
    def order(row):
        # Obtain coverage across the chronological splits before filling each day.
        slot = day_slots[row["date"]]
        day_slots[row["date"]] += 1
        return (len(row["cars"]) != 9, slot, row["date"])

    with ThreadPoolExecutor(max_workers=5) as pool:
        for card, result, error in pool.map(process, sorted(cards, key=order)):
            if error:
                failures[card["race_id"]] = error
            rows.append({**card, "result": result})
    report = {"snapshot_races": count, "eligible_cards": len(cards), "rejected_snapshots": reasons,
              "result_errors": dict(Counter(failures.values())), "failed_races": failures,
              "result_races": sum(r["result"] is not None for r in rows)}
    write(out / "dataset.json", rows)
    write(out / "audit.json", report)
    print({name: value for name, value in report.items() if name != "failed_races"}, flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--venue-page", default=BASE + "/keirin/omiya/racecard/2026110425/3/1")
    parser.add_argument("--cache-only", action="store_true")
    parser.add_argument("--only-cars", type=int, choices=(7, 9))
    args = parser.parse_args()
    collect(args.root, args.out, args.venue_page, args.cache_only, args.only_cars)
