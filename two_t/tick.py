"""One forward collection/reconciliation cycle for an existing scheduler."""
import argparse
from datetime import datetime, timedelta
from hashlib import sha256
import json
from pathlib import Path

import torch

from .evaluate import settle
from .forward import capture_quote, freeze, predict_card, store_once
from .public_feed import day_feed, links
from .publish import forward_data
from .source import BASE, JST, UTC, card_input, encode, get_page, payload, result_data, stamp, state, write


def archived_cards(root, day):
    cards = {}
    directory = root / "data/lab_history" / day
    for file in sorted(directory.glob("p-*.json")):
        try:
            row = card_input(payload(file))
        except (ValueError, KeyError, TypeError):
            continue
        row["feature_path"] = str(file.relative_to(root))
        row["feature_sha256"] = sha256(encode(row)).hexdigest()
        if row["race_id"] not in cards or stamp(row["saved_at"]) < stamp(cards[row["race_id"]]["saved_at"]):
            cards[row["race_id"]] = row
    return cards


def tick(root, checkpoints, ledger, page_output):
    now = datetime.now(UTC)
    day = now.astimezone(JST).date().isoformat()
    failures = {}
    for path in sorted((ledger / "forecasts").glob("*.json")):
        forecast = payload(path)
        result_path = ledger / "settlements" / path.name
        started = stamp(forecast["start"])
        if result_path.exists() or not started + timedelta(minutes=10) <= now <= started + timedelta(days=2):
            continue
        try:
            card = forecast["frozen_card"]
            url = forecast["race_source"]
            result = result_data(state(get_page(url)), card, url)
            if result["confirmed"]:
                account = settle(forecast["selected"] or {}, result) if forecast["quote"] else None
                store_once(ledger / "settlements", f"{card['race_id']}:{forecast['quote_mode']}",
                           {"result": result, "settlement": account})
        except (OSError, KeyError, ValueError) as error:
            failures["settle:" + forecast["race_id"]] = str(error)
    try:
        feed = day_feed(day)
        now = datetime.now(UTC)
        feed_time = stamp(feed["generated_at"])
        candidates = {}
        for race in feed["races"]:
            if race.get("is_girls") or not race.get("close_time"):
                continue
            race_id = f"{day}:{race['venue']}:{int(race['race_number'])}"
            close = stamp(f"{day}T{race['close_time']}:00+09:00")
            seconds_left = (close - now).total_seconds()
            if feed_time <= now and 580 <= seconds_left <= 750:
                candidates[race_id] = close
        if candidates:
            cards = archived_cards(root, day)
            urls = links(get_page(BASE + "/keirin/racecard"))
            for key, close in sorted(candidates.items(), key=lambda item: item[1]):
                card = cards.get(key)
                p = None
                try:
                    if not card:
                        raise ValueError("archived pre-race card unavailable")
                    url = urls.get((card["venue"], card["race_no"]))
                    if not url:
                        raise ValueError("unique public odds page unavailable")
                    p = predict_card(card, checkpoints / f"transformer-{len(card['cars'])}.pt")
                    p["frozen_card"], p["race_source"] = card, url
                    delta = close - timedelta(minutes=10) - datetime.now(UTC)
                    # Accept a capture only inside the preset minute.
                    if timedelta(seconds=0) <= delta <= timedelta(seconds=59):
                        html = get_page(url)
                        captured = datetime.now(UTC)
                        quote = capture_quote(state(html), card, url, captured, "t10")
                        freeze(ledger / "forecasts", card, p, quote, datetime.now(UTC), "t10")
                    else:
                        failures[key] = "outside T-10 capture window"
                except FileExistsError:
                    continue
                except (OSError, KeyError, ValueError) as error:
                    failures[key] = str(error)
                if p and key in failures and datetime.now(UTC) < stamp(card["start"]):
                    try:
                        freeze(ledger / "forecasts", card, p, None, datetime.now(UTC), "probability")
                    except FileExistsError:
                        pass
    except (OSError, KeyError, ValueError) as error:
        failures["day_feed"] = str(error)
    rows = forward_data(ledger)
    if page_output:
        replay = payload(page_output).get("replay", []) if page_output.exists() else []
        write(page_output, {"replay": replay, "forward": rows})
    print(json.dumps({"saved": len(rows), "failures": failures}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--checkpoints", type=Path, required=True)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--page-output", type=Path)
    args = parser.parse_args()
    torch.set_num_threads(2)
    tick(args.root, args.checkpoints, args.ledger, args.page_output)
