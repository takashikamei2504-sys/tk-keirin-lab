"""Collect prospective exacta research observations independently of forecasts."""
import argparse
from collections import Counter
from datetime import datetime, timedelta
from hashlib import sha256
import json
from pathlib import Path
import re
from urllib.error import HTTPError

from .ledger import ledger_path, store_once
from .public_feed import day_feed, feed_url, links
from .source import BASE, JST, UTC, encode, get_page, payload, result_data, stamp, state
from .supplement import published_card


LEAD = timedelta(minutes=10)
RESULT_URL = re.compile(re.escape(BASE) + r"/keirin/[a-z0-9-]+/racecard/\d{10}/\d+/\d+")


def utc_now():
    return datetime.now(UTC)


def digest(value):
    return sha256(encode(value)).hexdigest()


def check_window(card, at):
    if at > stamp(card["start"]) - LEAD:
        raise ValueError("too late for pre-race lineup capture")


def capture(ledger, day, feed, fetched_at, clock, report, failures):
    if feed["date"] != day or stamp(feed["generated_at"]) > fetched_at:
        raise ValueError("feed date or publication time is inconsistent")
    source = feed_url(day)
    candidates = {}
    for index, raw in enumerate(feed["races"]):
        key = f"feed entry {index}"
        try:
            key = f"{day}:{raw['venue']}:{int(raw['race_number'])}"
            if raw.get("is_girls") is True or len(raw.get("entries") or []) not in (7, 9):
                report["outside_scope"] += 1
                continue
            if ledger_path(ledger / "cards", key).exists():
                report["already_saved"] += 1
                continue
            candidates.setdefault(key, []).append(raw)
        except (KeyError, TypeError, ValueError) as error:
            failures[key] = str(error)
    for key, rows in candidates.items():
        try:
            if len(rows) != 1:
                raise ValueError("duplicate race in the feed")
            raw = rows[0]
            saved = clock()
            if saved < fetched_at:
                raise ValueError("write clock precedes feed receipt")
            card = published_card(raw, day, feed["generated_at"], saved.isoformat(), source)
            check_window(card, saved)
            # Preserve the source response as received. The normalized row can be rebuilt from it.
            store_once(ledger / "cards", key, {"card": card, "feature_sha256": digest(card),
                       "raw_card": raw, "source_sha256": digest(raw), "fetched_at": fetched_at.isoformat()})
            report["cards_saved"] += 1
        except FileExistsError:
            report["already_saved"] += 1
        except (KeyError, TypeError, ValueError) as error:
            failures[key] = str(error)


def audited_card(record):
    card, raw = record["card"], record["raw_card"]
    saved = stamp(card["saved_at"])
    if not stamp(card["feature_published_at"]) <= stamp(record["fetched_at"]) <= saved:
        raise ValueError("recorded timestamps are out of order")
    rebuilt = published_card(raw, card["date"], card["feature_published_at"],
                             card["saved_at"], feed_url(card["date"]))
    if (digest(card) != record["feature_sha256"] or digest(raw) != record["source_sha256"]
            or rebuilt != card):
        raise ValueError("lineup evidence does not match its recorded hashes")
    check_window(card, saved)
    return card


def reconcile(ledger, day, clock, overrides, report, failures):
    urls = None
    for path in sorted((ledger / "cards").glob("*.json")):
        settled = ledger / "results" / path.name
        if settled.exists():
            continue
        key = path.stem
        try:
            record = payload(path)
            card = audited_card(record)
            key = card["race_id"]
            if path != ledger_path(ledger / "cards", key):
                raise ValueError("race is stored under a different key")
            route = ledger_path(ledger / "routes", key)
            url = overrides.get(key)
            if not url and route.exists():
                url = payload(route)["result_source"]
            if not url and card["date"] == day:
                if urls is None:
                    urls = {}
                    urls = links(get_page(BASE + "/keirin/racecard"))
                url = urls.get((card["venue"], card["race_no"]))
                if url:
                    try:
                        store_once(ledger / "routes", key, {"result_source": url})
                    except FileExistsError:
                        url = payload(route)["result_source"]
            now = clock()
            if now < stamp(card["start"]) + LEAD:
                continue
            if not url:
                raise ValueError("race result URL unavailable")
            if not RESULT_URL.fullmatch(url):
                raise ValueError("expected a public WINTICKET racecard URL")
            result = result_data(state(get_page(url)), card, url)
            if not result["confirmed"]:
                report["results_pending"] += 1
                continue
            if (result["decided_at"] and not stamp(card["start"]) <= stamp(result["decided_at"]) <= clock()
                    or not result["cancelled"] and not result["decided_at"]):
                raise ValueError("invalid decision timestamp")
            labels = result["labels"]
            complete = bool(labels and result["payouts"] and not (
                result["cancelled"] or result["accident"] or result["refund_cars"]))
            store_once(ledger / "results", key, {"race_id": key, "observed_at": clock().isoformat(),
                       "feature_sha256": record["feature_sha256"], "result": result,
                       "complete_labels": complete})
            report["results_saved"] += 1
            report["complete_labels"] += int(complete)
        except FileExistsError:
            continue
        except HTTPError as error:
            failures[key] = f"HTTP {error.code}"
            if error.code in (403, 429):
                break
        except (OSError, KeyError, TypeError, ValueError, StopIteration) as error:
            if str(error) == "result pending":
                report["results_pending"] += 1
            else:
                failures[key] = str(error)


def observe(ledger, overrides=None, clock=utc_now):
    day = clock().astimezone(JST).date().isoformat()
    report = Counter(cards_saved=0, results_saved=0, complete_labels=0)
    failures = {}
    try:
        feed = day_feed(day)
        capture(ledger, day, feed, clock(), clock, report, failures)
    except (OSError, KeyError, TypeError, ValueError) as error:
        failures["day_feed"] = str(error)
    reconcile(ledger, day, clock, overrides or {}, report, failures)
    return {"day": day, **report, "failures": failures}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--result-urls", type=Path, help="optional JSON mapping of race ID to result URL")
    args = parser.parse_args()
    urls = payload(args.result_urls) if args.result_urls else {}
    if not isinstance(urls, dict) or any(not isinstance(url, str) or not RESULT_URL.fullmatch(url)
                                        for url in urls.values()):
        parser.error("--result-urls must map race IDs to public WINTICKET racecard URLs")
    print(json.dumps(observe(args.ledger, urls), ensure_ascii=False))
