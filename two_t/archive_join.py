"""Match timestamped public lineups to audited exacta and backstretch results."""

import argparse
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
import re

from .archive_coverage import git, snapshot
from .source import JST, VALIDATION, get_page, id_of, payload, result_data, stamp, state, write
from .supplement import add, published_card


RESULT_URL = re.compile(r"https://www\.winticket\.jp/keirin/[a-z0-9-]+/racecard/\d{10}/\d+/\d+")
COMMIT = re.compile(r"[a-f0-9]{40}")
PUBLIC_FEED = "https://github.com/kurinaka12-afk/keirin-app-data/blob"


def pilot_key(row):
    day = date.fromisoformat(row["id"][:4] + "-" + row["id"][4:6] + "-" + row["id"][6:8])
    return f"{day}:{row['venue']}:{row['race']}"


def checked_card(raw, day, published, saved, url, proof):
    card = published_card(raw, day, published, saved, url)
    if (card["race_id"] != pilot_key(proof)
            or stamp(card["start"]) != stamp(f"{day}T{proof['start']}:00+09:00")):
        raise ValueError("race identity or scheduled start disagrees with audit")
    expected = sorted([[car, id_of(rider)] for car, rider in proof["rider_ids_by_car"]])
    if card["roster"] != expected or len({rider for _, rider in expected}) != len(expected):
        raise ValueError("car or rider ID disagrees with audit")
    if stamp(saved) > stamp(card["start"]) - timedelta(minutes=10):
        raise ValueError("lineup revision is later than the pre-start cutoff")
    return card


def checked_result(card, proof, url):
    if not RESULT_URL.fullmatch(url):
        raise ValueError("expected a public WINTICKET racecard URL")
    observed = result_data(state(get_page(url)), card, url)
    if not observed["confirmed"] or observed["cancelled"] or observed["accident"] or observed["refund_cars"]:
        raise ValueError("result is pending or has a cancellation, accident or refund")
    if observed["labels"] != [proof["back"], *proof["finish"]] or observed["payouts"].get(
            proof["exacta"][0]) != proof["exacta"][1]:
        raise ValueError("B, finish or exacta payout disagrees with audit")
    if (not observed["decided_at"]
            or stamp(observed["decided_at"]) < stamp(card["start"])
            or stamp(observed["decided_at"]).astimezone(JST).date() >= VALIDATION):
        raise ValueError("settlement outside the training period")
    return observed


def join(evidence, baseline, checkout=None, refs=(), result_urls=None):
    pilot = {}
    for proof in evidence["result_verified_pilot"]:
        key = pilot_key(proof)
        if key in pilot:
            raise ValueError(f"duplicate pilot race: {key}")
        pilot[key] = proof
    seen = {row["race_id"] for row in baseline}
    if len(seen) != len(baseline):
        raise ValueError("duplicate race in baseline")
    cards, failures = {}, {}
    for rev, day in refs:
        date.fromisoformat(day)
        if not COMMIT.fullmatch(rev):
            raise ValueError("expected a full pinned commit SHA")
        saved = git(checkout, "show", "-s", "--format=%cI", rev).decode().strip()
        feed = snapshot(checkout, rev, f"{day}.json")
        if feed["date"] != day:
            raise ValueError("public racecard date mismatch")
        url = f"{PUBLIC_FEED}/{rev}/{day}.json"
        for raw in feed["races"]:
            key = f"{day}:{raw['venue']}:{raw['race_number']}"
            if key not in pilot or key in seen:
                continue
            try:
                card = checked_card(raw, day, feed["generated_at"], saved, url, pilot[key])
                add(cards, card, f"{rev}:{day}.json", "timestamped_public_lineup")
            except (TypeError, KeyError, ValueError) as error:
                failures[key] = str(error)

    additions, decisions = [], {}
    provider_refused = False
    for key, proof in sorted(pilot.items()):
        if key in seen:
            decisions[key] = "already in baseline"
            continue
        card = cards.get(key)
        if not card:
            decisions[key] = failures.get(key, "no timestamped lineup revision")
            continue
        if card["split"] != "train":
            decisions[key] = "outside training period"
            continue
        url = (result_urls or {}).get(proof["id"])
        if not url:
            decisions[key] = "missing result URL"
            continue
        if provider_refused:
            decisions[key] = "provider refused this batch"
            continue
        try:
            observed = checked_result(card, proof, url)
            additions.append({**card, "result": observed})
            decisions[key] = "eligible"
        except (OSError, TypeError, KeyError, ValueError, StopIteration) as error:
            decisions[key] = str(error)
            provider_refused = getattr(error, "code", None) in (403, 429)
    return additions, {
        "pilot": len(pilot), "verified_pre_race_lineup": len(cards),
        "eligible_additions": len(additions),
        "reasons": dict(Counter(decisions.values())), "decisions": decisions,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path, default=Path("docs/2T_RACE_JOIN_20261117.json"))
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--public-checkout", type=Path)
    parser.add_argument("--ref-day", nargs=2, action="append", default=[])
    parser.add_argument("--result-urls", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--dataset-output", type=Path)
    args = parser.parse_args()
    if args.ref_day and not args.public_checkout:
        parser.error("--public-checkout is required with --ref-day")
    if args.dataset_output and not args.baseline:
        parser.error("--baseline is required with --dataset-output")
    paths = [p.resolve() for p in (args.evidence, args.baseline, args.result_urls,
                                   args.report, args.dataset_output) if p is not None]
    if len(paths) != len(set(paths)):
        parser.error("input and output paths must be distinct")
    baseline = payload(args.baseline) if args.baseline else []
    additions, report = join(payload(args.evidence), baseline, args.public_checkout,
                             args.ref_day, payload(args.result_urls) if args.result_urls else None)
    write(args.report, report)
    if args.dataset_output:
        write(args.dataset_output, baseline + additions)
    print(f"pilot={report['pilot']} verified_lineups={report['verified_pre_race_lineup']} "
          f"eligible_additions={report['eligible_additions']}")


if __name__ == "__main__":
    main()
