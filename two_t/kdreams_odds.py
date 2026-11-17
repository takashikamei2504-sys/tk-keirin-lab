"""Capture Kdreams T−10 exacta evidence without requiring a model checkpoint."""
import argparse
from collections import Counter
from datetime import datetime, time, timedelta
from hashlib import sha256
import json
from pathlib import Path
from time import sleep
import re

from .evaluate import eligible_quote
from .kdreams_results import clean, key_for, links_for, name, one, read_page
from .ledger import ledger_path, store_once
from .observe import audited_card, utc_now
from .source import JST, pairs, payload, stamp


ODDS_QUERY = "?kakeshikiType=2shatan&pageType=odds"
RESULT_QUERY = "?pageType=showResult"
MINUTE = timedelta(seconds=59)


def matrix(html, card, raw):
    content = one(r'<div\b[^>]*id="JS_ODDSCONTENTS_2shatan"[^>]*>(.*?)<!-- 2車単 End -->',
                  html, "missing exacta table")
    table = one(r'<table class="odds_table">(.*?)</table>', content, "missing exacta matrix")
    roster = [(int(car), name(rider)) for car, rider in
              re.findall(r'<td class="rider n([1-9])">(.*?)<br\b[^>]*>.*?</td>', table, flags=re.S)]
    expected = {int(entry["car_number"]): name(entry["rider_full_name"]) for entry in raw["entries"]}
    if len(roster) != len(expected) or dict(roster) != expected or set(expected) != set(card["cars"]):
        raise ValueError("exacta roster mismatch")
    if len(set(expected.values())) != len(expected):
        raise ValueError("ambiguous racer names")
    # Popularity rows publish the ordered pair explicitly.
    ranked = one(r'<p class="header">\s*人気順\s*</p>.*?<table\b[^>]*>(.*?)</table>',
                 content, "missing exacta popularity list")
    odds = {}
    for key, value in re.findall(r'<span class="num">\s*([1-9]-[1-9])\s*</span>\s*'
                                 r'<span class="odds">\s*([\d,]+(?:\.\d+)?)\s*</span>', ranked):
        if key in odds:
            raise ValueError("duplicate exacta pair")
        odds[key] = float(value.replace(",", ""))
    if set(odds) != pairs(card["cars"]):
        raise ValueError("incomplete exacta pairs")
    return odds


def snapshot(html, result_url, record, captured):
    card, raw = record["card"], record["raw_card"]
    started = stamp(card["start"]).astimezone(JST)
    key = key_for(result_url)
    if (key != str(raw["race_id"]) or key[:8] != started.strftime("%Y%m%d")
            or int(key[-2:]) != card["race_no"]):
        raise ValueError("odds race ID mismatch")
    head = re.split(r"</head\s*>", html, maxsplit=1, flags=re.I)[0]
    title = clean(one(r"<title>(.*?)</title>", head, "missing odds race title"))
    if (not title.startswith(card["venue"] + "競輪 ") or started.strftime("%Y年%m月%d日") not in title
            or not re.search(r"(?<!\d)" + str(card["race_no"]) + r"R(?!\w)", title)):
        raise ValueError("odds date, venue or race number mismatch")
    start_text, close_text = one(r'<dt class="start">\s*発走予定\s*</dt>\s*<dd>(\d{2}:\d{2})</dd>\s*'
                                 r'<dt class="bet">\s*投票締切\s*</dt>\s*<dd>(\d{2}:\d{2})</dd>',
                                 html, "missing provider start or sales close")
    if start_text != started.strftime("%H:%M") or close_text != raw["close_time"]:
        raise ValueError("odds race schedule mismatch")
    close = stamp(f"{card['date']}T{close_text}:00+09:00")
    status = one(r'<div\b[^>]*id="JS_ODDSSTATUS_2shatan"[^>]*>(.*?)</div>',
                 html, "missing exacta update section")
    published_text = one(r'<p class="time">\s*(\d{4}/\d{2}/\d{2} \d{2}:\d{2})現在\s*</p>',
                         status, "missing exacta publication timestamp")
    published = datetime.strptime(published_text, "%Y/%m/%d %H:%M").replace(tzinfo=JST)
    morning = bool(re.search(r'<span class="icon_status morning">', html))
    full_pool_from = datetime.combine(started.date(), time(8, 0) if morning else time(9, 30), tzinfo=JST)
    if not published <= captured or not close < started:
        raise ValueError("invalid odds timing")
    return {"state": "final" if re.search(r'class="icon_confirmed"', html) else "live",
            "odds": matrix(html, card, raw), "source_url": result_url.removesuffix(RESULT_QUERY) + ODDS_QUERY,
            "sales_close": close.isoformat(), "captured_at": captured.isoformat(),
            "published_at": published.isoformat(), "pool": "all" if published >= full_pool_from else "provider",
            "page_sha256": sha256(html.encode("utf-8")).hexdigest()}


def verify_quote(quote, card):
    if quote["state"] != "live":
        raise ValueError("final odds")
    if quote["pool"] != "all":
        raise ValueError("provider-only pool")
    if not eligible_quote(quote, card["cars"], quote["sales_close"], "t10"):
        raise ValueError("outside T-10 capture window or stale odds")


def capture(ledger, clock=utc_now):
    report, outcomes = Counter(), {}
    now = clock()
    day = now.astimezone(JST).date().isoformat()
    urls = None
    for path in sorted((ledger / "cards").glob("*.json")):
        key = path.stem
        try:
            record = payload(path)
            if record["card"]["date"] != day:
                continue
            card, raw = audited_card(record), record["raw_card"]
            key = card["race_id"]
            if path != ledger_path(ledger / "cards", key):
                raise ValueError("card filename does not match the race")
            identity = key + ":t10"
            close = stamp(f"{day}T{raw['close_time']}:00+09:00")
            target = close - timedelta(minutes=10)
            if ledger_path(ledger / "quotes", identity).exists():
                report["already_saved"] += 1
                continue
            current = clock()
            if current < target - MINUTE:
                report["window_not_open"] += 1
                continue
            if current > target:
                report["window_missed"] += 1
                continue
            if urls is None:
                urls = {}
                urls = links_for(day)
            result_url = urls.get(str(raw["race_id"]))
            if not result_url:
                raise ValueError("odds source URL unavailable")
            if clock() > target:
                raise ValueError("window closed during source discovery")
            html = read_page(result_url.removesuffix(RESULT_QUERY) + ODDS_QUERY)
            quote = snapshot(html, result_url, record, clock())
            verify_quote(quote, card)
            store_once(ledger / "quotes", identity, {"race_id": key, "mode": "t10",
                       "feature_sha256": record["feature_sha256"], "quote": quote})
            report["quotes_saved"] += 1
        except FileExistsError:
            report["already_saved"] += 1
        except (OSError, KeyError, TypeError, ValueError) as error:
            outcomes[key] = str(error)
    return {"day": day, "counts": dict(report), "failures": outcomes}


def wait_for_window(ledger, maximum, clock=utc_now, sleeper=sleep):
    if maximum <= 0:
        return
    now = clock()
    day = now.astimezone(JST).date().isoformat()
    starts = []
    for path in (ledger / "cards").glob("*.json"):
        try:
            record = payload(path)
            card = record["card"]
            if card["date"] != day or ledger_path(ledger / "quotes", card["race_id"] + ":t10").exists():
                continue
            close = stamp(f"{day}T{record['raw_card']['close_time']}:00+09:00")
            target = close - timedelta(minutes=10)
            if target >= now:
                starts.append(target - MINUTE)
        except (OSError, KeyError, TypeError, ValueError):
            continue
    if starts:
        delay = (min(starts) - clock()).total_seconds() + 0.25
        if 0 < delay <= maximum:
            sleeper(delay)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--wait-seconds", type=int, default=0)
    args = parser.parse_args()
    if not 0 <= args.wait_seconds <= 240:
        parser.error("--wait-seconds must be between 0 and 240")
    wait_for_window(args.ledger, args.wait_seconds)
    print(json.dumps(capture(args.ledger), ensure_ascii=False))
