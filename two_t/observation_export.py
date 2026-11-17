"""Audit a prospective 2T ledger and export reproducible evaluation inputs."""
import argparse
from collections import Counter
from datetime import date
from pathlib import Path
import re

from .kdreams_odds import ODDS_QUERY, RESULT_QUERY, verify_quote
from .kdreams_results import key_for
from .ledger import ledger_path
from .netkeirin_results import RESULT_URL
from .observe import LEAD, audited_card, utc_now
from .source import JST, id_of, payload, stamp, write


SHA = re.compile(r"[0-9a-f]{64}")
LABELS = {
    "eligible": "検証用に抽出",
    "before_result_window": "発走・結果確認時刻待ち",
    "result_unavailable": "結果未取得",
    "unverified_result": "2サイトの照合未完了",
    "irregular_result": "欠場・失格・同着など",
    "result_after_cutoff": "指定時点の後に確認",
    "invalid_card": "出走表の検証失敗",
    "invalid_result": "結果データの検証失敗",
    "card_after_cutoff": "指定時点の後に保存",
}
FILES = ("audit.json", "rows.json", "summary.md")


def result_for(ledger, record, card, as_of):
    key = card["race_id"]
    started = stamp(card["start"])
    result_path = ledger_path(ledger / "results", key)
    review_path = ledger_path(ledger / "review-results", key)
    if as_of < started + LEAD:
        return "before_result_window", None
    if not result_path.exists():
        if review_path.exists() and stamp(payload(review_path)["observed_at"]) <= as_of:
            return "unverified_result", None
        return "result_unavailable", None
    settlement = payload(result_path)
    observed = stamp(settlement["observed_at"])
    if observed > as_of:
        return "result_after_cutoff", None
    if (settlement["race_id"] != key or settlement["feature_sha256"] != record["feature_sha256"]
            or observed < started + LEAD):
        raise ValueError("result is not bound to the verified pre-race card")
    result = settlement["result"]
    if result.get("rider_ids_verified") is not True:
        return "unverified_result", None
    if (settlement.get("complete_labels") is not True or result.get("confirmed") is not True
            or result.get("cancelled") is not False or result.get("accident") is not False
            or result.get("refund_cars") != []):
        return "irregular_result", None
    raw_id = str(record["raw_card"]["race_id"])
    if not re.fullmatch(r"\d{12}", raw_id) or not raw_id.startswith(card["date"].replace("-", "")):
        raise ValueError("invalid original race ID")
    source = result["result_source"]
    if key_for(source) != raw_id or int(raw_id[-2:]) != card["race_no"]:
        raise ValueError("result source race ID mismatch")
    evidence = result["evidence"]
    if (set(evidence) != {source, RESULT_URL + raw_id}
            or any(not SHA.fullmatch(value) for value in evidence.values())):
        raise ValueError("expected hashes for both result pages")
    if not review_path.exists():
        raise ValueError("missing first result observation")
    review = payload(review_path)
    labels = result["labels"]
    if type(labels) is not list or len(labels) != 4 or any(type(car) is not int or car not in card["cars"] for car in labels):
        raise ValueError("invalid B or finish labels")
    if (review["race_id"] != key or review["source_race_id"] != raw_id
            or review["feature_sha256"] != record["feature_sha256"]
            or review["result_source"] != source or review["result_sha256"] != evidence[source]
            or not started + LEAD <= stamp(review["observed_at"]) <= observed
            or review.get("statuses") != {} or labels != [review["back"], *review["finish"]]):
        raise ValueError("first result observation does not match the confirmation")
    expected_roster = [(car, id_of(rider)) for car, rider in card["roster"]]
    if [(car, id_of(rider)) for car, rider in result["roster_confirmation"]] != expected_roster:
        raise ValueError("confirmed roster does not match the pre-race roster")
    pair = f"{labels[1]}-{labels[2]}"
    payout = result["payouts"]
    if (len(set(labels[1:])) != 3 or set(payout) != {pair} or type(payout[pair]) is not int
            or payout[pair] <= 0 or review["payouts"] != payout):
        raise ValueError("invalid or changed exacta payout")
    decided = result.get("decided_at")
    if decided is not None and not started <= stamp(decided) <= observed:
        raise ValueError("result decision timestamp out of order")
    return "eligible", {**card, "split": "prospective", "feature_sha256": record["feature_sha256"],
                        "result_observed_at": settlement["observed_at"], "result": result}


def audited_quote(record, row, saved, as_of):
    quote = saved["quote"]
    url = quote["source_url"]
    if not url.endswith(ODDS_QUERY):
        raise ValueError("unrecognized T-10 provider URL")
    result_url = url.removesuffix(ODDS_QUERY) + RESULT_QUERY
    result = row.get("result")
    close = f"{row['date']}T{record['raw_card']['close_time']}:00+09:00"
    captured = stamp(quote["captured_at"])
    if (saved["race_id"] != row["race_id"] or saved["mode"] != "t10"
            or saved["feature_sha256"] != record["feature_sha256"]
            or key_for(result_url) != str(record["raw_card"]["race_id"])
            or (result and result["result_source"] != result_url)
            or stamp(quote["sales_close"]) != stamp(close) or not SHA.fullmatch(quote["page_sha256"])
            or not stamp(row["saved_at"]) <= captured < stamp(row["start"]) or captured > as_of):
        raise ValueError("T-10 evidence does not match the pre-race card")
    verify_quote(quote, row)
    return quote


def quote_for(ledger, record, row, as_of):
    path = ledger_path(ledger / "quotes", row["race_id"] + ":t10")
    return audited_quote(record, row, payload(path), as_of) if path.exists() else None


def audit(ledger, as_of, day=None):
    rows, entries = [], []
    for path in sorted((ledger / "cards").glob("*.json")):
        entry = {"race_id": path.stem}
        try:
            record = payload(path)
            key = record["card"]["race_id"]
            if day and record["card"]["date"] != day:
                continue
            card = audited_card(record)
            if path != ledger_path(ledger / "cards", key):
                raise ValueError("card filename does not match the race")
        except (OSError, KeyError, TypeError, ValueError, AttributeError) as error:
            entry.update(status="invalid_card", detail=str(error))
            entries.append(entry)
            continue
        entry.update(race_id=key, date=card["date"], cars=len(card["cars"]))
        try:
            if stamp(card["saved_at"]) > as_of:
                entry["status"] = "card_after_cutoff"
            else:
                status, row = result_for(ledger, record, card, as_of)
                entry["status"] = status
                if row is not None:
                    try:
                        quote = quote_for(ledger, record, row, as_of)
                        entry["t10_status"] = "eligible" if quote else "missing"
                        if quote is not None:
                            row["t10"] = quote
                    except (OSError, KeyError, TypeError, ValueError, AttributeError) as error:
                        entry.update(t10_status="invalid", t10_detail=str(error))
                    rows.append(row)
        except (OSError, KeyError, TypeError, ValueError, AttributeError) as error:
            entry.update(status="invalid_result", detail=str(error))
        entries.append(entry)
    return sorted(rows, key=lambda row: (stamp(row["start"]), row["race_id"])), {
        "date": day, "as_of": as_of.isoformat(), "observation_count": len(entries),
        "counts": dict(Counter(entry["status"] for entry in entries)),
        "t10_counts": dict(Counter(entry["t10_status"] for entry in entries if "t10_status" in entry)),
        "fields": {str(cars): dict(Counter(entry["status"] for entry in entries if entry.get("cars") == cars))
                   for cars in (7, 9)},
        "entries": sorted(entries, key=lambda entry: entry["race_id"])}


def summary(report):
    lines = ["## 発走前保存と結果照合の監査", "",
             "| 状態 | 全件 | 7車 | 9車 |", "| --- | ---: | ---: | ---: |"]
    for key, label in LABELS.items():
        count = report["counts"].get(key, 0)
        if count or key == "eligible":
            a, b = (report["fields"][n].get(key, 0) for n in ("7", "9"))
            lines.append(f"| {label} | {count} | {a} | {b} |")
    t10 = report["t10_counts"]
    lines.extend(["", f"抽出行のT−10オッズは、適格 {t10.get('eligible', 0)}件、"
                  f"未保存 {t10.get('missing', 0)}件、検証失敗 {t10.get('invalid', 0)}件。"])
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--as-of", type=stamp)
    parser.add_argument("--day", type=date.fromisoformat, help="limit to a JST race date")
    args = parser.parse_args()
    if not (args.ledger / "cards").is_dir() and not (args.ledger / "README.md").is_file():
        parser.error("observation ledger is missing")
    if args.output.resolve().is_relative_to(args.ledger.resolve()):
        parser.error("the export directory must be outside the observation ledger")
    args.output.mkdir(parents=True, exist_ok=True)
    rows, report = audit(args.ledger, args.as_of or utc_now().astimezone(JST),
                         args.day.isoformat() if args.day else None)
    write(args.output / FILES[0], report)
    write(args.output / FILES[1], rows)
    (args.output / FILES[2]).write_text(summary(report), encoding="utf-8")


if __name__ == "__main__":
    main()
