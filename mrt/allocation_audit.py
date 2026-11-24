"""Read-only, frozen-snapshot MRT allocation audit. Does NOT change production bets.

A = original auto tickets; B = top-three 1st/2nd pairs plus up to five
third-place completions (300 yen each); C = top eight allocation_score
tickets with a fixed total stake. B/C are exploratory, NOT odds-based EV.
"""
import argparse
import datetime as dt
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

BUDGET = 10000
UNIT = 100


def allocate(tickets, budget, weights):
    """Allocate 100-yen units, with 100 yen minimum per ticket."""
    if not tickets:
        return []
    if budget % UNIT or budget < UNIT * len(tickets):
        raise ValueError("invalid allocation budget")
    if not all(math.isfinite(w) and w > 0 for w in weights):
        raise ValueError("invalid allocation weights")
    units = budget // UNIT - len(tickets)
    total = sum(weights)
    quotas = [units * w / total for w in weights]
    amounts = [1 + int(q) for q in quotas]
    remaining = budget // UNIT - sum(amounts)
    priority = sorted(range(len(quotas)), key=lambda i: (-(quotas[i] - int(quotas[i])), i))
    for idx in priority[:remaining]:
        amounts[idx] += 1
    return [dict(ticket, yen=UNIT * amount) for ticket, amount in zip(tickets, amounts)]


def combinations(tickets):
    pairs, thirds = defaultdict(float), defaultdict(float)
    for t in tickets:
        i, j, k = t["cars"]
        w = max(float(t["allocation_score"]), 0.000001)
        pairs[(i, j)] += w
        thirds[k] += w
    existing = {tuple(t["cars"]) for t in tickets}
    options = []
    for (i, j), pw in sorted(pairs.items(), key=lambda item: -item[1])[:3]:
        for k, kw in thirds.items():
            cars = (i, j, k)
            if k in (i, j) or cars in existing:
                continue
            options.append({"cars": list(cars), "allocation_score": pw * kw})
    options.sort(key=lambda t: (-t["allocation_score"], "-".join(map(str, t["cars"]))))
    return options[:5]


def variants(original):
    b_extras = combinations(original)
    base_budget = BUDGET - 300 * len(b_extras)
    b = allocate(original, base_budget, [t["yen"] for t in original])
    b += [dict(t, yen=300) for t in b_extras]
    leading = sorted(original, key=lambda t: -float(t["allocation_score"]))[:8]
    c = allocate(leading, BUDGET, [max(float(t["allocation_score"]), 0.000001) for t in leading])
    return {"A": original, "B": b, "C": c}, b_extras


def accounting(tickets, payouts):
    stakes = {"-".join(map(str, t["cars"])): t["yen"] for t in tickets}
    return sum(stakes.get(combo, 0) * int(pay) // UNIT for combo, pay in payouts.items())


def classification(original, payouts):
    bought = {tuple(t["cars"]) for t in original}
    paid = [tuple(map(int, combo.split("-"))) for combo in payouts]
    if any(cars in bought for cars in paid):
        return "hit"
    if any(any(t[:2] == p[:2] for t in bought) for p in paid):
        return "third_miss"
    if any(any(t[:2] == (p[1], p[0]) for t in bought) for p in paid):
        return "reverse_top2"
    if any(any(p[0] in t and p[1] in t for t in bought) for p in paid):
        return "two_present"
    return "not_top2"


def validated_snapshot(payload, result, expected_id):
    if payload.get("pre_race") is not True or payload.get("race_id") != expected_id:
        raise ValueError("no frozen pre-race forecast")
    entry = payload["input"]
    if entry["race_id"] != expected_id or entry["date"] != expected_id[:8]:
        raise ValueError("forecast identity mismatch")
    observed, generated, close, start = (dt.datetime.fromisoformat(payload[k]) for k in
                                         ("entry_observed_at", "generated_at", "sales_close_at", "start_at"))
    if any(x.utcoffset() is None for x in (observed, generated, close, start)):
        raise ValueError("missing timezone")
    if not observed <= generated < close < start:
        raise ValueError("prediction is not prior to close")
    roster = {str(c): str(p["rider_id"]) for c, p in entry["entry"]["players"].items()}
    if len(roster) not in (7, 9) or roster != {str(c): str(v) for c, v in result["roster"].items()}:
        raise ValueError("roster mismatch")
    if result.get("status") != "final" or not result.get("payouts"):
        raise ValueError("unverified result")
    tickets = payload["automatic"]["tickets"]
    if not tickets or sum(int(t["yen"]) for t in tickets) != BUDGET:
        raise ValueError("invalid original stake")
    if len({tuple(t["cars"]) for t in tickets}) != len(tickets):
        raise ValueError("duplicate original ticket")
    if any(t["yen"] < UNIT or t["yen"] % UNIT or len(set(t["cars"])) != 3
           or any(str(c) not in roster for c in t["cars"])
           or not math.isfinite(float(t["allocation_score"])) for t in tickets):
        raise ValueError("invalid ticket")
    return tickets


def summary(rows):
    stake = BUDGET * len(rows)
    returns = {k: sum(r[k] for r in rows) for k in ("A", "B", "C")}
    hits = {k: sum(r[k] > 0 for r in rows) for k in ("A", "B", "C")}
    return {
        "races": len(rows), "stake_yen": stake,
        "returns_yen": returns, "hit_counts": hits,
        "roi_percent": {k: round(100 * v / stake, 4) if stake else None for k, v in returns.items()},
        "categories": dict(sorted(Counter(r["category"] for r in rows).items())),
        "B_recovered": sum(r["B_recovered"] for r in rows),
    }


def run(root, days=None):
    root = Path(root)
    audit_rows, excluded = [], []
    dirs = sorted((root / "data/mrt").glob("????-??-??"))
    for daydir in dirs:
        if days and daydir.name not in days:
            continue
        if not (daydir / "index.json").exists() or not (daydir / "results.json").exists():
            continue
        index = json.loads((daydir / "index.json").read_text())
        results = json.loads((daydir / "results.json").read_text())
        outcome = {r["race_id"]: r for r in results["results"]}
        for race in index["races"]:
            rid = race["race_id"]
            res = outcome.get(rid)
            if not race.get("file"):
                excluded.append({"race_id": rid, "reason": "no saved pre-start forecast"})
                continue
            if not res or res.get("status") != "final":
                excluded.append({"race_id": rid, "reason": (res or {}).get("reason", "result pending")})
                continue
            try:
                payload = json.loads((daydir / race["file"]).read_text())
                original = validated_snapshot(payload, res, rid)
                variants_map, extras = variants(original)
                pnl = {k: accounting(v, res["payouts"]) for k, v in variants_map.items()}
                for k, v in variants_map.items():
                    if sum(t["yen"] for t in v) != BUDGET:
                        raise ValueError("variant stake mismatch: " + k)
                payoff = max(res["payouts"].values())
                audit_rows.append({
                    "race_id": rid, "date": daydir.name, "venue": payload.get("venue_name"),
                    "race_no": payload.get("race_no"), "field_size": len(res["roster"]),
                    "race_class": payload["input"]["entry"].get("race_class", "unknown"),
                    "actual_payouts": res["payouts"], "winning_payment_max": payoff,
                    "category": classification(original, res["payouts"]),
                    "A": pnl["A"], "B": pnl["B"], "C": pnl["C"],
                    "original_points": len(original),
                    "B_added": ["-".join(map(str, t["cars"])) for t in extras],
                    "B_recovered": pnl["A"] == 0 and pnl["B"] > 0,
                    "frozen_model_sha256": payload.get("model_sha256"),
                })
            except (KeyError, ValueError, TypeError, OSError) as exc:
                excluded.append({"race_id": rid, "reason": str(exc)})
    audit_rows.sort(key=lambda r: r["race_id"])
    daily = {day: summary([r for r in audit_rows if r["date"] == day])
             for day in sorted({r["date"] for r in audit_rows})}
    high = [r for r in audit_rows if r["winning_payment_max"] >= 10000]
    high.sort(key=lambda r: -r["winning_payment_max"])
    drop = {}
    by_payout = sorted(audit_rows, key=lambda r: (-r["winning_payment_max"], r["race_id"]))
    for n in (1, 3, 5):
        bad = {r["race_id"] for r in by_payout[:n]}
        drop[str(n)] = summary([r for r in audit_rows if r["race_id"] not in bad])
    return {
        "schema": "tk-mrt-allocation-audit/v1",
        "mode": "exploratory_historical_review_only",
        "not_a_forward_test": True,
        "real_time_odds_used": False,
        "selection_is_not_calibrated_EV": True,
        "automatic_promotion": False,
        "adoption": "human_decision_required",
        "methods": {
            "A": "Unchanged recorded auto tickets",
            "B": "Top 3 ordered first/second pairs x observed third-position marginals; up to five new tickets at 300 yen, remaining stake proportional to original",
            "C": "Top eight original allocation_score tickets, renormalized to 10000 yen",
        },
        "total": summary(audit_rows), "daily": daily,
        "high_payout_over_10000": [{
            k: r[k] for k in ("race_id", "date", "venue", "race_no",
                             "actual_payouts", "category", "A", "B", "C",
                             "B_added", "B_recovered")
        } for r in high],
        "remove_top_realized_payout": drop,
        "excluded": excluded, "rows": audit_rows,
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    p.add_argument("--days", nargs="*", help="YYYY-MM-DD dates, default all available")
    p.add_argument("--output", help="Optional JSON report path, no output file by default")
    args = p.parse_args()
    report = run(args.root, set(args.days) if args.days else None)
    output = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        dest = Path(args.output)
        area = (Path(args.root) / "data/mrt_research").resolve()
        resolved = dest.resolve()
        if not resolved.is_relative_to(area):
            p.error("--output must be inside data/mrt_research")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(output)
    else:
        print(output)


if __name__ == "__main__":
    main()
