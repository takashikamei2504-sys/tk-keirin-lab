"""Collect prospective exacta research observations independently of forecasts."""
import argparse
from collections import Counter
from datetime import datetime, timedelta
from hashlib import sha256
import json
from pathlib import Path
import re
from time import monotonic
from urllib.error import HTTPError

from . import kdreams_results
from .ledger import ledger_path, store_once
from .public_feed import day_feed, feed_url, links
from .source import BASE, JST, UTC, encode, get_page, payload, result_data, stamp, state
from .supplement import published_card


LEAD = timedelta(minutes=10)
RESULT_RETRY_WINDOW = timedelta(days=3)
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
    report["feed_rows"] = len(feed["races"])
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


def reconcile(ledger, day, clock, overrides, report, failures, budget_seconds, review_results):
    deadline = None if budget_seconds is None else monotonic() + budget_seconds
    urls = None
    date_links = {}
    for path in sorted((ledger / "cards").glob("*.json")):
        settled = ledger / "results" / path.name
        if settled.exists():
            continue
        if deadline is not None and monotonic() >= deadline:
            report["reconcile_budget_exhausted"] = 1
            break
        key = path.stem
        try:
            record = payload(path)
            card = audited_card(record)
            key = card["race_id"]
            if path != ledger_path(ledger / "cards", key):
                raise ValueError("race is stored under a different key")
            route = ledger_path(ledger / "routes", key)
            url = overrides.get(key)
            started = stamp(card["start"])
            if not url and clock() > started + RESULT_RETRY_WINDOW:
                report["result_retries_expired"] += 1
                continue
            if review_results and not url:
                if (ledger / "review-results" / path.name).exists() or clock() < started + LEAD:
                    continue
                raw = record["raw_card"]
                date_key = card["date"]
                if date_key not in date_links:
                    date_links[date_key] = {}
                    date_links[date_key] = kdreams_results.links_for(date_key)
                url = date_links[date_key].get(str(raw.get("race_id")))
                if not url:
                    raise ValueError("Kdreams result URL unavailable")
                result = kdreams_results.parse_result(kdreams_results.read_page(url), url, card, raw)
                store_once(ledger / "review-results", key, {
                    **result, "observed_at": clock().isoformat(), "feature_sha256": record["feature_sha256"]})
                report["review_results_saved"] += 1
                continue
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
            if now < started + LEAD:
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


def observe(ledger, overrides=None, clock=utc_now, budget_seconds=None, review_results=False):
    day = clock().astimezone(JST).date().isoformat()
    report = Counter(cards_saved=0, results_saved=0, complete_labels=0, review_results_saved=0)
    failures = {}
    try:
        feed = day_feed(day)
        capture(ledger, day, feed, clock(), clock, report, failures)
    except (OSError, KeyError, TypeError, ValueError) as error:
        failures["day_feed"] = str(error)
    reconcile(ledger, day, clock, overrides or {}, report, failures, budget_seconds, review_results)
    return {"day": day, **report, "failures": failures}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--result-urls", type=Path, help="optional JSON mapping of race ID to result URL")
    parser.add_argument("--reconcile-budget-seconds", type=int, help="stop between result checks after this duration")
    parser.add_argument("--review-results", action="store_true", help="save Kdreams name matches for identity review")
    args = parser.parse_args()
    if args.reconcile_budget_seconds is not None and args.reconcile_budget_seconds <= 0:
        parser.error("--reconcile-budget-seconds must be positive")
    urls = payload(args.result_urls) if args.result_urls else {}
    if not isinstance(urls, dict) or any(not isinstance(url, str) or not RESULT_URL.fullmatch(url)
                                        for url in urls.values()):
        parser.error("--result-urls must map race IDs to public WINTICKET racecard URLs")
    print(json.dumps(observe(args.ledger, urls, budget_seconds=args.reconcile_budget_seconds,
                             review_results=args.review_results), ensure_ascii=False))
