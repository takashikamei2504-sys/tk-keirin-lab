"""Freeze two research-only exacta forecasts before sales close and score later."""
import argparse
from datetime import date
from hashlib import sha256
import json
from pathlib import Path

from .observe import audited_card, utc_now
from .observation_export import audit
from .source import JST, encode, payload, stamp, write
from .v2_experiment import VARIANTS, evidence, fit, labels, market_comparison, metrics, predict

MODELS = ("shared_inputs", "same_line_only")


def freeze(bundle, ledger, day, clock=utc_now):
    dataset, = evidence(bundle, ("inputs/dataset-7.json",))
    archive_end = max(row["date"] for row in dataset)
    if day <= archive_end or day != clock().astimezone(JST).date().isoformat():
        raise ValueError("freeze requires today's date after the development archive")
    train = list(labels(row for row in dataset if row["split"] == "train"))
    if any(not stamp(row["saved_at"]) < stamp(row["start"]) < stamp(f"{day}T00:00:00+09:00")
           or stamp(row["result"]["decided_at"]) >= stamp(f"{day}T00:00:00+09:00")
           for row, _ in train):
        raise ValueError("training input or label is outside its allowed time")
    weights = {name: fit(train, *VARIANTS[name]) for name in MODELS}
    model_weights = {name: [arr.tolist() for arr in w] for name, w in weights.items()}
    output = {"date": day, "train_races": len(train), "data_archive_end": archive_end,
              "weights": model_weights, "weights_sha256": sha256(encode(model_weights)).hexdigest(),
              "records": []}
    for path in sorted((ledger / "cards").glob("*.json")):
        record = payload(path)
        card = audited_card(record)
        if card["date"] != day or len(card["cars"]) != 7:
            continue
        close = stamp(f"{day}T{record['raw_card']['close_time']}:00+09:00")
        saved_at = stamp(card["saved_at"])
        if not saved_at <= clock() < close < stamp(card["start"]):
            continue
        probs = {name: predict(card, weights[name], *VARIANTS[name]) for name in MODELS}
        issued = clock()
        if issued >= close:
            continue
        output["records"].append({"race_id": card["race_id"], "sales_close": close.isoformat(),
                                  "issued_at": issued.astimezone(JST).isoformat(),
                                  "feature_sha256": record["feature_sha256"], "probabilities": probs})
    output["records"].sort(key=lambda r: (r["sales_close"], r["race_id"]))
    return output


def score(frozen, ledger, as_of):
    observed, _ = audit(ledger, as_of, day=frozen["date"])
    records = {row["race_id"]: row for row in frozen["records"]}
    matches = []
    for row, pair in labels(observed):
        saved = records.get(row["race_id"])
        if saved is None:
            continue
        if (row["feature_sha256"] != saved["feature_sha256"]
                or not stamp(row["saved_at"]) <= stamp(saved["issued_at"]) < stamp(saved["sales_close"])
                or stamp(saved["sales_close"]) >= stamp(row["start"])):
            raise ValueError(f"invalid saved forecast: {row['race_id']}")
        if row.get("t10") and stamp(row["t10"]["sales_close"]) != stamp(saved["sales_close"]):
            raise ValueError(f"sales close mismatch: {row['race_id']}")
        matches.append((row, pair))
    estimates = {name: [records[row["race_id"]]["probabilities"][name] for row, _ in matches]
                 for name in MODELS}
    return {"frozen": len(records), "with_result": len(matches),
            "metrics": {name: metrics(matches, probs) for name, probs in estimates.items()},
            "t10_comparison": market_comparison(matches, estimates, "t10")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("freeze", "score"))
    parser.add_argument("input", type=Path, help="V1 evidence zip (freeze) or saved prediction JSON (score)")
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--date", type=date.fromisoformat)
    parser.add_argument("--as-of", type=stamp)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.mode == "freeze":
        frozen = freeze(args.input, args.ledger, (args.date or utc_now().astimezone(JST).date()).isoformat())
        if not frozen["records"]:
            raise SystemExit("No verified cards remain before sales close")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive creation prevents replacement of an already issued forecast batch.
        with args.out.open("xb") as out:
            out.write(encode(frozen) + b"\n")
        print(json.dumps({"frozen": len(frozen["records"])}))
    else:
        write(args.out, score(payload(args.input), args.ledger, args.as_of or utc_now()))


if __name__ == "__main__":
    main()
