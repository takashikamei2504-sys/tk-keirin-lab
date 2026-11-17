"""Frozen TEST metrics and 100-yen exacta ticket accounting."""
import argparse
from collections import defaultdict
from datetime import timedelta
import math
from pathlib import Path
from random import Random
from statistics import mean

from .source import pairs, payload, stamp, write

THRESHOLDS = (1., 1.5, 2., 2.5, 3.)
UNIT = 100


def eligible_quote(quote, cars, close, mode):
    if not quote or set(quote.get("odds", ())) != pairs(cars):
        return False
    if any(type(value) not in (int, float) or not math.isfinite(value) or value < 1
           for value in quote["odds"].values()):
        return False
    if mode == "final":
        return quote.get("state") == "final"
    if mode not in ("t10", "t5") or quote.get("state") != "live":
        return False
    try:
        target = stamp(close) - timedelta(minutes=int(mode[1:]))
        captured, published = stamp(quote["captured_at"]), stamp(quote["published_at"])
        return (bool(quote["source_url"]) and quote["sales_close"] == close
                and target - timedelta(seconds=59) <= captured <= target
                and published <= captured and captured - published <= timedelta(minutes=5))
    except (KeyError, TypeError, ValueError):
        return False


def choices(probability, quote, threshold):
    return {key: p * quote["odds"][key] for key, p in probability.items()
            if p * quote["odds"][key] >= threshold}


def settle(tickets, result):
    if not result or not result["confirmed"]:
        return None
    if not result["cancelled"] and not result["payouts"]:
        return None
    cash = hits = refunds = 0
    paid = []
    for key in tickets:
        if result["cancelled"] or any(int(car) in result["refund_cars"] for car in key.split("-")):
            cash += UNIT
            refunds += 1
        elif key in result["payouts"]:
            amount = result["payouts"][key]
            cash += amount
            paid.append(amount)
            hits += 1
    return {"stake": UNIT * len(tickets), "returned": cash, "hits": hits, "refunds": refunds,
            "paid": paid, "tickets": len(tickets)}


def summary(rows, total):
    stake, returned = (sum(row[key] for _, row in rows) for key in ("stake", "returned"))
    tickets = sum(row["tickets"] for _, row in rows)
    hits = sum(row["hits"] for _, row in rows)
    bought = sum(row["tickets"] > 0 for _, row in rows)
    days = len({day for day, _ in rows})
    payout = sorted((p for _, row in rows for p in row["paid"]), reverse=True)
    return {"total_races": total, "eligible_races": len(rows), "purchased_races": bought,
            "skipped_races": len(rows) - bought, "unavailable_races": total - len(rows), "tickets": tickets,
            "hits": hits, "hit_rate": hits / tickets if tickets else None,
            "refunds": sum(row["refunds"] for _, row in rows),
            "stake": stake, "returned": returned, "net": returned - stake,
            "roi": returned / stake if stake else None,
            "active_dates": days, "tickets_per_eligible_day": tickets / days if days else None,
            "roi_excluding_highest_payout_adjusted_stake": {
                str(k): (returned - sum(payout[:k])) / (stake - UNIT * k)
                if len(payout) >= k and stake > UNIT * k else None for k in (1, 3, 5)}}


def daily_interval(rows):
    daily = defaultdict(lambda: [0, 0])
    for day, row in rows:
        daily[day][0] += row["stake"]
        daily[day][1] += row["returned"]
    if len(daily) < 2:
        return None
    blocks = list(daily.values())
    rng = Random(11)
    draws = []
    for _ in range(2000):
        costs, returns = map(sum, zip(*rng.choices(blocks, k=len(blocks))))
        if costs:
            draws.append(returns / costs)
    draws.sort()
    return [draws[int((len(draws)-1) * p)] for p in (.025, .975)] if draws else None


def accuracy(rows):
    top = defaultdict(list)
    bins = defaultdict(list)
    for probability, winners, back, back_label in rows:
        order = sorted(probability, key=probability.get, reverse=True)
        for k in (1, 3, 5):
            top[f"top{k}"].append(any(key in winners for key in order[:k]))
        first = defaultdict(float)
        for key, p in probability.items():
            first[key.split("-")[0]] += p
        top["first"].append(any(max(first, key=first.get) == k.split("-")[0] for k in winners))
        if len(winners) == 1:
            top["log_loss"].append(-math.log(max(1e-12, probability[next(iter(winners))])))
            top["brier"].append(sum((p - (key in winners)) ** 2 for key, p in probability.items()))
            for key, p in probability.items():
                decade = min(9, int(10 * p))
                bins[decade].append((p, key in winners))
        if back and back_label is not None:
            top["back"].append(max(back, key=back.get) == str(back_label))
    return {"races": len(rows), **{k: mean(v) for k, v in top.items()},
            "proper_scoring_races": len(top["log_loss"]),
            "calibration": [{"interval": [i / 10, (i + 1) / 10], "tickets": len(v),
                             "probability_mean": mean(x for x, _ in v), "observed_rate": mean(y for _, y in v)}
                            for i, v in sorted(bins.items())]}


def report(dataset, predictions):
    test = {x["race_id"]: x for x in dataset if x["split"] == "test"
            and len(x["cars"]) == len(predictions[0]["cars"])}
    if len({p["race_id"] for p in predictions}) != len(predictions) or set(test) != {p["race_id"] for p in predictions}:
        raise ValueError("predictions must cover each eligible TEST snapshot once")
    ranking, market_matched, model_matched = [], [], []
    booked = {mode: {str(t): defaultdict(list) for t in THRESHOLDS} for mode in ("final", "t10", "t5")}
    totals = defaultdict(int)
    for p in predictions:
        row = test[p["race_id"]]
        if p["feature_sha256"] != row["feature_sha256"]:
            raise ValueError("prediction input mismatch")
        probability = p["probabilities"]
        if (set(probability) != pairs(row["cars"]) or abs(sum(probability.values()) - 1) > 1e-6
                or any(not math.isfinite(v) or not 0 <= v <= 1 for v in probability.values())):
            raise ValueError("invalid probability distribution")
        groups = ("all", "class:" + row["class"], "month:" + row["date"][:7])
        for group in groups:
            totals[group] += 1
        result = row["result"]
        if not result or not result["confirmed"]:
            continue
        winners = set(result["payouts"])
        if winners:
            item = (probability, winners, p["back"], result["labels"][0] if result["labels"] else None)
            ranking.append(item)
        for mode, thresholds in booked.items():
            quote = result.get("final_quote") if mode == "final" else row.get(mode)
            if mode == "final" and result["accident"]:
                continue
            if not eligible_quote(quote, row["cars"], result["sales_close"], mode):
                continue
            if mode == "final" and winners:
                inv = {key: 1 / odd for key, odd in quote["odds"].items()}
                norm = sum(inv.values())
                market_matched.append(({k: v / norm for k, v in inv.items()}, winners, None, None))
                model_matched.append(item)
            for threshold, by_group in thresholds.items():
                entry = settle(choices(probability, quote, float(threshold)), result)
                if entry is not None:
                    for group in groups:
                        by_group[group].append((row["date"], entry))
    returns = {mode: {t: {group: summary(entries[group], total)
                         for group, total in totals.items()} for t, entries in thresholds.items()}
               for mode, thresholds in booked.items()}
    return {"accuracy": accuracy(ranking), "market_final_matched": accuracy(market_matched),
            "model_final_matched": accuracy(model_matched), "returns": returns,
            "final_roi_daily_bootstrap_exploratory": daily_interval(booked["final"]["1.5"]["all"]),
            "t10_roi_daily_bootstrap": daily_interval(booked["t10"]["1.5"]["all"]),
            "seconds_mean": mean(p["seconds"] for p in predictions),
            "seconds_max": max(p["seconds"] for p in predictions),
            "seconds_count": len(predictions)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    parser.add_argument("predictions", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    write(args.output, report(payload(args.dataset), payload(args.predictions)))
