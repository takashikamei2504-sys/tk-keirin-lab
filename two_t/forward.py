"""Capture timestamped odds, freeze a prediction, and reconcile separately."""
import argparse
from datetime import datetime, timedelta
from hashlib import sha256
from pathlib import Path
from time import perf_counter

import torch

from .evaluate import choices, eligible_quote, settle
from .ledger import store_once
from .model import make, predict
from .source import UTC, encode, get_page, pairs, payload, query, race_data, result_data, stamp, state, write
from .train import predict_record, tensorize


def capture_quote(queries, card, url, captured_at, mode):
    data, race = race_data(queries, card)
    if race["cancel"] or race["status"] != 1 or data["results"] or any(e["absent"] for e in data["entries"]):
        raise ValueError("race is not open with the expected roster")
    feed = query(queries, "FETCH_KEIRIN_RACE_ODDS")
    if feed["finalOdds"] is not False or feed["oddsDelayed"] is not False:
        raise ValueError("final or delayed odds")
    odds = {}
    for item in feed["exacta"]:
        key = "-".join(map(str, item["key"]))
        if item["raceId"] != race["id"] or item["absent"] or item["unitPrice"] != 100 or key in odds:
            raise ValueError("invalid exacta quote")
        odds[key] = item["odds"]
    sales_close = datetime.fromtimestamp(race["closeAt"], UTC).isoformat()
    quote = {"state": "live", "odds": odds, "source_url": url, "sales_close": sales_close,
             "captured_at": captured_at.isoformat(),
             "published_at": datetime.fromtimestamp(feed["oddsUpdatedAt"], UTC).isoformat()}
    if not eligible_quote(quote, card["cars"], sales_close, mode):
        raise ValueError("incomplete market or outside the requested pre-close minute")
    return quote


def predict_card(card, path):
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    if checkpoint["version"] != 1 or len(card["cars"]) != checkpoint["n"]:
        raise ValueError("checkpoint incompatible with card")
    model = make(checkpoint["kind"], checkpoint["n"], checkpoint["common"], checkpoint["personal"])
    model.load_state_dict(checkpoint["state"])
    c, x, r, _ = tensorize([card], checkpoint["scaling"], labels=False)
    begin = perf_counter()
    prob, back = predict(model, c, x, r, checkpoint["repeats"], checkpoint["seed"])
    digest = sha256(path.read_bytes()).hexdigest()
    return predict_record(card, (prob, back, perf_counter() - begin), checkpoint["temperature"], digest)


def freeze(directory, card, forecast, quote, now, mode):
    if not stamp(card["feature_published_at"]) <= stamp(card["saved_at"]) <= now < stamp(card["start"]):
        raise ValueError("pre-race timestamps invalid")
    if forecast["race_id"] != card["race_id"] or forecast["feature_sha256"] != card["feature_sha256"]:
        raise ValueError("input identity mismatch")
    if set(forecast["probabilities"]) != pairs(card["cars"]):
        raise ValueError("forecast combinations invalid")
    if quote and (not stamp(quote["captured_at"]) <= now < stamp(quote["sales_close"])
                  or not eligible_quote(quote, card["cars"], quote["sales_close"], mode)):
        raise ValueError("quote is not usable at freeze time")
    record = {**forecast, "frozen_at": now.isoformat(), "quote_mode": mode, "quote": quote,
              "selected": choices(forecast["probabilities"], quote, 1.5) if quote else None}
    return store_once(directory, card["race_id"] + ":" + mode, record)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["capture", "probability", "settle"])
    parser.add_argument("--card", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--url", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--mode", choices=["t10", "t5"], default="t10")
    args = parser.parse_args()
    import re
    if not re.fullmatch(r"https://www\.winticket\.jp/keirin/[a-z0-9-]+/racecard/\d{10}/\d+/\d+", args.url):
        parser.error("expected a public WINTICKET racecard URL")
    card = payload(args.card)
    key = card["race_id"] + ":" + args.mode
    if args.action == "settle":
        path = args.out / "forecasts" / (sha256(key.encode()).hexdigest() + ".json")
        p = payload(path)
        observed = result_data(state(get_page(args.url)), card, args.url)
        if not observed["confirmed"]:
            raise ValueError("result pending")
        ticket_record = settle(p["selected"] or {}, observed) if p["quote"] else None
        print(store_once(args.out / "settlements", key, {"race_id": card["race_id"], "settlement": ticket_record,
                                                          "result": observed, "quote_mode": args.mode}))
        return
    if args.checkpoint is None:
        parser.error("--checkpoint required for predictions")
    torch.set_num_threads(2)
    if datetime.now(UTC) >= stamp(card["start"]):
        raise ValueError("race already started")
    p = predict_card(card, args.checkpoint)
    p["frozen_card"], p["race_source"] = card, args.url
    quote = None
    if args.action == "capture":
        html = get_page(args.url)
        quote = capture_quote(state(html), card, args.url, datetime.now(UTC), args.mode)
    print(freeze(args.out / "forecasts", card, p, quote, datetime.now(UTC), args.mode))


if __name__ == "__main__":
    main()
