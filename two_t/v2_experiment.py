"""Research-only exacta comparison for fixed-period V1 and prospective race cards."""
import argparse
from collections import Counter, defaultdict
from datetime import date
from hashlib import sha256
import json
import math
from pathlib import Path
from statistics import mean
from zipfile import ZipFile

import numpy as np
from scipy.optimize import minimize
from scipy.special import logsumexp, softmax

from .evaluate import eligible_quote
from .ledger import ledger_path
from .observation_export import audit
from .source import JST, PERSONAL, payload, stamp, write

FEATURE = {name: i for i, name in enumerate(PERSONAL)}
VARIANTS = {"shared_inputs": (False, None), "add_recent": (True, None),
            "same_line_only": (False, "same"), "line_without_recent": (False, "position"),
            "add_recent_and_line": (True, "position"),
            "same_line_size": (False, "size"),
            "winner_lead_strength": (False, "same", True),
            "winner_lead_and_line_size": (False, "size", True)}
REGULARIZATION = 0.02


def finish_number(value):
    return type(value) is int and 1 <= value <= 9


def recent_mean(row, line):
    if line is None:
        return None
    # The latest completed meeting must account for exactly three starts.
    # Their mean is invariant to the provider's within-meeting display order.
    try:
        first, last = (date.fromisoformat(line[key]) for key in ("first_date", "last_date"))
        finishes = line["finishes"]
    except (KeyError, TypeError, ValueError):
        return None
    if not first <= last < date.fromisoformat(row["date"]):
        return None
    if not isinstance(finishes, list) or len(finishes) != 3 or not all(map(finish_number, finishes)):
        return None
    return sum(finishes) / 3


def live_recent(ledger, row):
    path = ledger_path(ledger / "cards", row["race_id"])
    raw = payload(path)["raw_card"]
    entries = {int(entry["car_number"]): entry for entry in raw["entries"]}
    return {car: recent_mean(row, entries[car].get("prev_meeting")) for car in row["cars"]}


def raw_features(row, recent=None):
    cars = row["cars"]
    groups = {car: (group, pos, len(line)) for group, line in enumerate(row["lineup"])
              for pos, car in enumerate(line)}
    profiles = dict(zip(cars, row["personal"], strict=True))
    scores = [profiles[car][FEATURE["score"]] for car in cars]
    average_score = sum(scores) / len(scores)
    features = []
    for car in cars:
        p = profiles[car]
        _, pos, size = groups[car]
        last = [p[FEATURE[f"last{k}"]] for k in (1, 2, 3)]
        form = (recent[car] if recent is not None else
                sum(last) / 3 if all(map(finish_number, last)) else None)
        features.append([p[FEATURE["score"]] - average_score, p[FEATURE["escape"]],
                         p[FEATURE["versatile"]], pos, size,
                         0 if form is None else (4 - form), int(form is None)])
    return np.asarray(features, dtype=float), groups


def conditions(features, groups, cars, first, lineup):
    candidates = [car for car in cars if car != first]
    rows = features[[cars.index(car) for car in candidates]]
    if lineup:
        group, pos, _ = groups[first]
        links = [[groups[car][0] == group, groups[car][0] == group and groups[car][1] < pos,
                  groups[car][0] == group and groups[car][1] == pos + 1] for car in candidates]
        links = np.asarray(links)
        if lineup == "size":
            # Candidate normalization already accounts for how many teammates are available.
            same = links[:, :1]
            rows = np.column_stack((rows, same, same * (groups[first][2] - 2)))
        else:
            rows = np.column_stack((rows, links[:, :1 if lineup == "same" else 3]))
    return candidates, rows


def learn(rows, labels):
    x, y = np.stack(rows), np.asarray(labels)
    n = len(y)
    scale = x.reshape(-1, x.shape[-1]).std(0)
    scale[scale < 1e-8] = 1
    x = x / scale

    def objective(w):
        logits = x @ w
        prob = softmax(logits, axis=1)
        loss = (logsumexp(logits, axis=1) - logits[np.arange(n), y]).mean()
        prob[np.arange(n), y] -= 1
        grad = np.einsum("ra,raf->f", prob, x) / n
        return (loss + REGULARIZATION * (w @ w) / 2, grad + REGULARIZATION * w)

    fitted = minimize(objective, np.zeros(x.shape[-1]), jac=True, method="L-BFGS-B")
    if not fitted.success:
        raise RuntimeError(fitted.message)
    return fitted.x / scale


def first_features(features, row, add_lead_strength):
    if not add_lead_strength:
        return features
    cars = row["cars"]
    relative_score = dict(zip(cars, features[:, 0], strict=True))
    lead_score = {car: (relative_score[line[0]] if pos else 0.0)
                  for line in row["lineup"] for pos, car in enumerate(line)}
    return np.column_stack((features, [lead_score[car] for car in cars]))


def fit(rows, recent, lineup, winner_context=False):
    a, b, ay, by = [], [], [], []
    for row, (first, second) in rows:
        cars = row["cars"]
        features, groups = raw_features(row)
        if not recent:
            features = features[:, :5]
        a.append(first_features(features, row, winner_context))
        ay.append(cars.index(first))
        candidates, conditional = conditions(features, groups, cars, first, lineup)
        b.append(conditional)
        by.append(candidates.index(second))
    return learn(a, ay), learn(b, by)


def predict(row, weights, recent, lineup, winner_context=False, *, live=None):
    cars = row["cars"]
    features, groups = raw_features(row, live)
    if not recent:
        features = features[:, :5]
    p1 = softmax(first_features(features, row, winner_context) @ weights[0])
    predictions = {}
    for first, value in zip(cars, p1, strict=True):
        ordered, matrix = conditions(features, groups, cars, first, lineup)
        p2 = softmax(matrix @ weights[1])
        predictions.update({f"{first}-{second}": float(value * p)
                            for second, p in zip(ordered, p2, strict=True)})
    if not math.isclose(sum(predictions.values()), 1, abs_tol=1e-10):
        raise ValueError("exacta probabilities do not sum to one")
    return predictions


def labels(rows):
    for row in rows:
        result = row["result"]
        if len(row["cars"]) != 7 or not result or not result["confirmed"] or result["accident"]:
            continue
        if len(result["payouts"]) != 1:
            continue
        pair, = result["payouts"]
        yield row, tuple(map(int, pair.split("-")))


def metrics(actual, predictions):
    scores = Counter()
    count = 0
    for (row, (first, second)), probs in zip(actual, predictions, strict=True):
        pairs = {f"{i}-{j}" for i in row["cars"] for j in row["cars"] if i != j}
        if set(probs) != pairs or not math.isclose(sum(probs.values()), 1, abs_tol=1e-6):
            raise ValueError("incomplete or unnormalized probability matrix")
        key = f"{first}-{second}"
        marginals = {i: sum(probs[f"{i}-{j}"] for j in row["cars"] if i != j) for i in row["cars"]}
        p1 = marginals[first]
        scores["first_log_loss"] -= math.log(p1)
        scores["conditional_second_log_loss"] -= math.log(probs[key] / p1)
        scores["exacta_log_loss"] -= math.log(probs[key])
        for k in (1, 3):
            cutoff = sorted(probs.values(), reverse=True)[k-1]
            tied = [p for p in probs.values() if p == cutoff]
            higher = sum(p > cutoff for p in probs.values())
            scores[f"exacta_top{k}"] += 1 if probs[key] > cutoff else (k-higher)/len(tied) if probs[key] == cutoff else 0
        count += 1
    if not count:
        return {"races": 0}
    return {"races": count, **{name: value / count for name, value in scores.items()}}


def evidence(path, names):
    with ZipFile(path) as arc:
        manifest = dict(reversed(line.split(maxsplit=1))
                        for line in arc.read("SHA256SUMS.txt").decode().splitlines())
        data = []
        for name in names:
            blob = arc.read(name)
            if sha256(blob).hexdigest() != manifest[name]:
                raise ValueError(f"sha256 mismatch for {name}")
            data.append(json.loads(blob))
        return data


def market_probabilities(quote):
    inverse = {pair: 1 / odds for pair, odds in quote["odds"].items()}
    total = sum(inverse.values())
    return {pair: value / total for pair, value in inverse.items()}


def market_comparison(rows, all_predictions, mode):
    indices, paired_market = [], []
    for i, (row, _) in enumerate(rows):
        result = row["result"]
        quote = result.get("final_quote") if mode == "final" else row.get(mode)
        # Prospective quotes were already validated with the provider cutoff by audit().
        if quote and (mode != "final" or eligible_quote(quote, row["cars"], result["sales_close"], mode)):
            indices.append(i)
            paired_market.append(market_probabilities(quote))
    paired = [rows[i] for i in indices]
    return {**{key: metrics(paired, [predictions[i] for i in indices])
               for key, predictions in all_predictions.items()}, "market": metrics(paired, paired_market)}


def loss_difference(rows, baseline, candidate):
    paired = []
    day_blocks = defaultdict(list)
    for (row, (first, second)), b, c in zip(rows, baseline, candidate, strict=True):
        pair = f"{first}-{second}"
        delta = math.log(b[pair] / c[pair])
        paired.append(delta)
        day_blocks[row["date"]].append(delta)
    if not paired:
        return {}
    result = {"races": len(paired), "delta_log_loss": mean(paired),
              "races_improved": sum(delta < 0 for delta in paired)}
    if len(day_blocks) >= 2:
        # Four historical days are too few for a reliable significance claim.
        blocks = [[sum(values), len(values)] for values in day_blocks.values()]
        sampled = np.asarray(blocks)[np.random.default_rng(11).integers(
            len(blocks), size=(4000, len(blocks)))].sum(axis=1)
        result["day_blocks"] = len(day_blocks)
        result["day_bootstrap_95pct_exploratory"] = np.quantile(sampled[:, 0] / sampled[:, 1], [.025, .975]).tolist()
    return result


def line_diagnostics(rows, predictions):
    ordered_groups = defaultdict(list)
    for i, (row, (first, second)) in enumerate(rows):
        same, = [line for line in row["lineup"] if first in line]
        ordered_groups["all"].append(i)
        ordered_groups["date:" + row["date"]].append(i)
        ordered_groups["class:" + row["class"]].append(i)
        ordered_groups["actual:same" if second in same else "actual:other"].append(i)
    comparisons = {"line_added": ("shared_inputs", "line_without_recent"),
                   "same_line": ("shared_inputs", "same_line_only"),
                   "relative_position": ("same_line_only", "line_without_recent"),
                   "recent_with_line": ("line_without_recent", "add_recent_and_line"),
                   "line_size_interaction": ("same_line_only", "same_line_size"),
                   "winner_lead_strength": ("same_line_only", "winner_lead_strength")}
    return {
        group: {key: loss_difference([rows[i] for i in indices],
                                     [predictions[control][i] for i in indices],
                                     [predictions[treatment][i] for i in indices])
                for key, (control, treatment) in comparisons.items()}
        for group, indices in sorted(ordered_groups.items())
    }


def expanding_history(rows, warmup_days=2, stop_day=None):
    """Backtest the early archive using only information available on prior days."""
    by_day = defaultdict(list)
    for row, result in rows:
        by_day[row["date"]].append((row, result))
    dates = sorted(by_day)
    predictions = {name: [] for name in VARIANTS}
    scored, folds = [], []
    for day in dates[warmup_days:stop_day]:
        midnight = stamp(f"{day}T00:00:00+09:00")
        training = [(row, result) for row, result in rows
                    if row["date"] < day
                    and row["result"].get("decided_at")
                    and stamp(row["result"]["decided_at"]) < midnight
                    and stamp(row["saved_at"]) < midnight]
        test = by_day[day]
        for name, flags in VARIANTS.items():
            weights = fit(training, *flags)
            predictions[name].extend(predict(row, weights, *flags) for row, _ in test)
        scored.extend(test)
        folds.append({"date": day, "train_races": len(training), "evaluation_races": len(test)})
    uniform = [{f"{a}-{b}": 1 / 42 for a in row["cars"] for b in row["cars"] if a != b}
               for row, _ in scored]
    return {"folds": folds, "metrics": {**{name: metrics(scored, values) for name, values in predictions.items()},
                                        "uniform": metrics(scored, uniform)},
            "final_odds_comparison": market_comparison(scored, predictions, "final"),
            "line_diagnostics": line_diagnostics(scored, predictions)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--as-of", required=True, type=stamp)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    dataset, v1 = evidence(args.evidence, ("inputs/dataset-7.json", "evaluation/transformer-7-predictions.json"))
    by_race = {row["race_id"]: row for row in v1}
    train = list(labels(row for row in dataset if row["split"] == "train"))
    variants = {name: fit(train, *flags) for name, flags in VARIANTS.items()}
    prospective, audit_report = audit(args.ledger, args.as_of)
    historic_end = max(row["date"] for row in dataset)
    sets = {"validation": list(labels(row for row in dataset if row["split"] == "validation")),
            "reused_test": list(labels(row for row in dataset if row["split"] == "test")),
            "prospective": list(labels(row for row in prospective if row["date"] > historic_end))}
    result = {"train_races": len(train), "as_of": args.as_of.astimezone(JST).isoformat(), "sets": {},
              "observation_audit": {key: audit_report[key] for key in
                                    ("observation_count", "counts", "t10_counts")}}
    for name, rows in sets.items():
        recent = [live_recent(args.ledger, row) if name == "prospective" else None for row, _ in rows]
        scores = {"uniform": metrics(rows, [{f"{a}-{b}": 1 / 42 for a in row["cars"] for b in row["cars"]
                                             if a != b} for row, _ in rows])}
        all_predictions = {}
        for variant, flags in VARIANTS.items():
            predictions = [predict(row, variants[variant], *flags, live=form)
                           for (row, _), form in zip(rows, recent, strict=True)]
            all_predictions[variant] = predictions
            scores[variant] = metrics(rows, predictions)
        entry = {"dates": sorted({row["date"] for row, _ in rows}), "metrics": scores,
                 "line_diagnostics": line_diagnostics(rows, all_predictions)}
        if name == "reused_test":
            for row, _ in rows:
                if row["feature_sha256"] != by_race[row["race_id"]]["feature_sha256"]:
                    raise ValueError("frozen V1 input mismatch")
            all_predictions["v1"] = [by_race[row["race_id"]]["probabilities"] for row, _ in rows]
            scores["v1"] = metrics(rows, all_predictions["v1"])
            entry["final_odds_comparison"] = market_comparison(rows, all_predictions, "final")
        if name == "prospective":
            entry["recent_available"] = sum(p is not None for form in recent for p in form.values())
            entry["rider_entries"] = sum(len(form) for form in recent)
            entry["t10_comparison"] = market_comparison(rows, all_predictions, "t10")
            feed = payload(args.ledger / "public" / "race-records.json")
            forecasts = {p["race_id"]: p for p in feed["forward"] if p.get("quote_mode") == "t10"}
            paired = [(row, outcome) for row, outcome in rows if row["race_id"] in forecasts
                      and row["feature_sha256"] == forecasts[row["race_id"]]["feature_sha256"]
                      and stamp(forecasts[row["race_id"]]["frozen_at"]) <= args.as_of]
            entry["v1_paired"] = {"metrics": {
                variant: metrics(paired, [predict(row, variants[variant], *flags, live=live_recent(args.ledger, row))
                                          for row, _ in paired])
                for variant, flags in VARIANTS.items()}}
            entry["v1_paired"]["metrics"]["v1"] = metrics(
                paired, [forecasts[row["race_id"]]["probabilities"] for row, _ in paired])
        result["sets"][name] = entry
    result["early_expanding_backtest"] = expanding_history(train)
    result["one_day_warmup_sensitivity"] = expanding_history(train, warmup_days=1, stop_day=2)
    write(args.out, result)


if __name__ == "__main__":
    main()
