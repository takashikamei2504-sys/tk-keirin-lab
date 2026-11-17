"""Build a static replay view and append live records from a separate ledger."""
import argparse
from collections import defaultdict
from pathlib import Path
import re

from .evaluate import choices, eligible_quote, settle
from .ledger import ledger_path
from .observation_export import quote_for, result_for
from .observe import audited_card, utc_now
from .source import encode, payload, write


def public_result(result):
    return {key: result[key] for key in ("payouts", "cancelled", "accident")} if result else None


def replay_data(dataset, predictions):
    source = {r["race_id"]: r for r in dataset}
    output = []
    for forecast in predictions:
        result = source[forecast["race_id"]]["result"]
        if not result or not result["confirmed"]:
            continue
        quote = result["final_quote"]
        if not eligible_quote(quote, forecast["cars"], result["sales_close"], "final"):
            quote = None
        selected = choices(forecast["probabilities"], quote, 1.5) if quote else {}
        settlement = settle(selected, result) if quote else None
        if settlement:
            settlement.pop("paid")
        output.append({**forecast, "quote": quote, "result": public_result(result), "settlement": settlement})
    return output


def forward_data(directory):
    output = []
    for path in (directory / "forecasts").glob("*.json"):
        row = payload(path)
        row.pop("frozen_card", None)
        result_path = directory / "settlements" / path.name
        settlement = payload(result_path) if result_path.is_file() else {}
        row.update({"result": public_result(settlement.get("result")),
                    "settlement": settlement.get("settlement"), "key": path.stem})
        output.append(row)
    counts = defaultdict(lambda: [0, 0])
    for row in sorted(output, key=lambda r: (r["start"], r["race_id"])):
        if row["settlement"]:
            cohort = (len(row["cars"]), row["quote_mode"])
            stake, paid = counts[cohort]
            stake += row["settlement"]["stake"]
            paid += row["settlement"]["returned"]
            counts[cohort] = [stake, paid]
            row["cumulative_roi"] = paid / stake if stake else None
    return output


def archive_data(directory, as_of=None):
    """Expose a compact card index without publishing raw feed records."""
    as_of = as_of or utc_now()
    output = []
    for path in sorted((directory / "cards").glob("*.json")):
        try:
            record = payload(path)
            card = audited_card(record)
            if path != ledger_path(directory / "cards", card["race_id"]):
                continue
        except (OSError, KeyError, TypeError, ValueError, AttributeError):
            continue
        row = {key: card[key] for key in ("race_id", "date", "venue", "race_no", "class", "cars",
                                          "start", "saved_at", "source_url") if key in card}
        close = record["raw_card"].get("close_time")
        if isinstance(close, str) and re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", close):
            row["sales_close"] = f"{card['date']}T{close}:00+09:00"
        row["riders"] = [
            [entry["car_number"], entry["rider_full_name"]]
            for entry in record["raw_card"]["entries"] if entry.get("rider_full_name")
        ]
        row["feature_sha256"] = record["feature_sha256"]
        try:
            row["result_status"], verified = result_for(directory, record, card, as_of)
            if verified:
                row["result"] = public_result(verified["result"])
                row["result_observed_at"] = verified["result_observed_at"]
        except (OSError, KeyError, TypeError, ValueError, AttributeError):
            row["result_status"] = "invalid_result"
        try:
            quote = quote_for(directory, record, card, as_of)
            if quote:
                row["quote_captured_at"] = quote["captured_at"]
        except (OSError, KeyError, TypeError, ValueError, AttributeError):
            row["quote_invalid"] = True
        output.append(row)
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, action="append", default=[])
    parser.add_argument("--predictions", type=Path, action="append", default=[])
    parser.add_argument("--ledger", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--standalone", type=Path)
    parser.add_argument("--examples-per-field", type=int)
    args = parser.parse_args()
    examples = []
    for dataset, predictions in zip(args.dataset, args.predictions, strict=True):
        rows = sorted(replay_data(payload(dataset), payload(predictions)),
                      key=lambda r: (r["date"], r["venue"], r["race_no"]))
        if args.examples_per_field:
            by_day = {}
            for row in rows:
                by_day.setdefault(row["date"], row)
            chosen = list(by_day.values())[:args.examples_per_field]
            extras = [row for row in rows if row not in chosen][:args.examples_per_field - len(chosen)]
            rows = chosen + extras
        examples.extend(rows)
    records = {"replay": examples, "forward": forward_data(args.ledger) if args.ledger else [],
               "archive": archive_data(args.ledger) if args.ledger else []}
    manual_path = args.ledger / "manual-status.json" if args.ledger else None
    if manual_path and manual_path.is_file():
        records["manual"] = sorted(payload(manual_path).values(),
                                   key=lambda r: (r["finished_at"], r["run_id"]), reverse=True)
    if not args.dataset and args.out.exists():
        records["replay"] = payload(args.out)["replay"]
    write(args.out, records)
    if args.standalone:
        template = (Path(__file__).parent / "index.html").read_text().replace(
            'href="../index.html"', 'href="https://takashikamei2504-sys.github.io/tk-keirin-lab/"')
        encoded = encode(records).decode().replace("<", "\\u003c")
        args.standalone.write_text(template.replace('type="application/json">null<',
                                                    f'type="application/json">{encoded}<'))


if __name__ == "__main__":
    main()
