"""Build a static replay view and append live records from a separate ledger."""
import argparse
from collections import defaultdict
from pathlib import Path

from .evaluate import choices, eligible_quote, settle
from .source import encode, payload, write


def public_result(result):
    return {key: result[key] for key in ("payouts", "cancelled")} if result else None


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
            stake, paid = counts[row["quote_mode"]]
            stake += row["settlement"]["stake"]
            paid += row["settlement"]["returned"]
            counts[row["quote_mode"]] = [stake, paid]
            row["cumulative_roi"] = paid / stake if stake else None
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
            rows = rows[:args.examples_per_field]
        examples.extend(rows)
    records = {"replay": examples, "forward": forward_data(args.ledger) if args.ledger else []}
    if not args.dataset and args.out.exists():
        records["replay"] = payload(args.out)["replay"]
    write(args.out, records)
    if args.standalone:
        template = (Path(__file__).parent / "index.html").read_text()
        encoded = encode(records).decode().replace("<", "\\u003c")
        args.standalone.write_text(template.replace('type="application/json">null<',
                                                    f'type="application/json">{encoded}<'))


if __name__ == "__main__":
    main()
