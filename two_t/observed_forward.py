"""Save and settle prospective 2T forecasts from the observation ledger."""
import argparse
from collections import Counter
from hashlib import sha256
import json
import math
from pathlib import Path
import re

from .evaluate import choices, settle
from .ledger import ledger_path, store_once
from .observation_export import audited_quote, result_for
from .observe import audited_card, utc_now
from .source import pairs, payload, stamp


MODE = "t10"
THRESHOLD = 1.5
# Fingerprints of the checkpoints used by the frozen V1 replay records.
V1_PINS = {
    7: "e537b2175af1780a007cb59feab4f1854cf651d5b574b34d9b4152f429cff332",
    9: "be43992f3bb4ac420553fb6e7570c6d58bfc31d1505c7cdcf7d7f6c25e999451",
}


def get_checkpoint(path, pin):
    if path is None or not pin or not path.is_file():
        return None
    if not re.fullmatch(r"[0-9a-f]{64}", pin) or sha256(path.read_bytes()).hexdigest() != pin:
        raise ValueError("Transformer checkpoint SHA-256 mismatch")
    return path


def read_card(ledger, key):
    record = payload(ledger_path(ledger / "cards", key))
    card = audited_card(record)
    if card["race_id"] != key:
        raise ValueError("card is stored under a different race")
    return record, {**card, "feature_sha256": record["feature_sha256"]}


def validate_forecast(forecast, card):
    probability = forecast["probabilities"]
    if (forecast["race_id"] != card["race_id"] or forecast["feature_sha256"] != card["feature_sha256"]
            or forecast["cars"] != card["cars"] or forecast["start"] != card["start"]
            or forecast["input_as_of"] != card["saved_at"]
            or not re.fullmatch(r"[0-9a-f]{64}", forecast["model_sha256"])):
        raise ValueError("forecast is not bound to the saved card and model")
    if (set(probability) != pairs(card["cars"])
            or any(type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1
                   for value in probability.values())
            or not math.isclose(sum(probability.values()), 1, abs_tol=1e-6)):
        raise ValueError("forecast probabilities are incomplete or not normalized")


def predict_and_freeze(ledger, card, checkpoint, sha, quote, clock):
    import torch
    from .forward import freeze, predict_card

    torch.set_num_threads(2)
    forecast = predict_card(card, checkpoint, expected_kind="transformer")
    validate_forecast(forecast, card)
    if forecast["model_sha256"] != sha:
        raise ValueError("checkpoint changed during inference")
    return freeze(ledger / "forecasts", card, forecast, quote, clock(), MODE)


def freeze_quotes(ledger, checkpoints, pins, clock=utc_now, runner=predict_and_freeze):
    known = {}
    counts, failures = Counter(), {}
    for path in sorted((ledger / "quotes").glob("*.json")):
        key = path.stem
        try:
            saved = payload(path)
            key = saved["race_id"]
            identity = key + ":" + MODE
            if path != ledger_path(ledger / "quotes", identity):
                raise ValueError("quote is stored under a different race")
            if ledger_path(ledger / "forecasts", identity).exists():
                counts["already_frozen"] += 1
                continue
            now = clock()
            if now >= stamp(saved["quote"]["sales_close"]):
                counts["closed_before_freeze"] += 1
                continue
            record, card = read_card(ledger, key)
            quote = audited_quote(record, card, saved, now)
            n = len(card["cars"])
            if n not in known:
                path = checkpoints / f"transformer-{n}.pt" if checkpoints is not None else None
                known[n] = get_checkpoint(path, pins.get(n))
            if known[n] is None:
                counts["checkpoint_unavailable"] += 1
                continue
            runner(ledger, card, known[n], pins[n], quote, clock)
            counts["frozen"] += 1
        except FileExistsError:
            counts["already_frozen"] += 1
        except (OSError, KeyError, TypeError, ValueError, RuntimeError, AttributeError) as error:
            failures[key] = str(error)
    return {"counts": dict(counts), "failures": failures}


def reconcile(ledger, clock=utc_now, pins=V1_PINS):
    counts, failures = Counter(), {}
    for path in sorted((ledger / "forecasts").glob("*.json")):
        key = path.stem
        try:
            forecast = payload(path)
            key = forecast["race_id"]
            identity = key + ":" + MODE
            if forecast.get("quote_mode") != MODE:
                continue
            if path != ledger_path(ledger / "forecasts", identity):
                raise ValueError("forecast is stored under a different race")
            if ledger_path(ledger / "settlements", identity).exists():
                counts["already_settled"] += 1
                continue
            record, card = read_card(ledger, key)
            now = clock()
            status, row = result_for(ledger, record, card, now)
            if row is None:
                counts[status] += 1
                continue
            quote = audited_quote(record, row, payload(ledger_path(ledger / "quotes", identity)), now)
            validate_forecast(forecast, card)
            if forecast["model_sha256"] != pins.get(len(card["cars"])):
                raise ValueError("forecast checkpoint is not the fixed V1 model")
            if (quote != forecast["quote"] or not stamp(quote["captured_at"]) <= stamp(forecast["frozen_at"])
                    < stamp(quote["sales_close"]) < stamp(card["start"])):
                raise ValueError("forecast was not frozen before sales close with the saved quote")
            selected = choices(forecast["probabilities"], quote, THRESHOLD)
            if forecast["selected"] != selected:
                raise ValueError("forecast selections do not match the frozen prices and probabilities")
            result = row["result"]
            store_once(ledger / "settlements", identity, {"race_id": key, "quote_mode": MODE, "result": result,
                       "settled_at": now.isoformat(), "settlement": settle(selected, result)})
            counts["settled"] += 1
        except FileExistsError:
            counts["already_settled"] += 1
        except (OSError, KeyError, TypeError, ValueError, AttributeError) as error:
            failures[key] = str(error)
    return {"counts": dict(counts), "failures": failures}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("freeze", "settle"))
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--checkpoints", type=Path)
    args = parser.parse_args()
    result = (freeze_quotes(args.ledger, args.checkpoints, V1_PINS)
              if args.phase == "freeze" else reconcile(args.ledger))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
