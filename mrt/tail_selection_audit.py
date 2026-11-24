"""Descriptive audit of Mr.T's low-stake tickets, without result-conditioned picking.

Historical teacher corpus was collected retrospectively; its entry cards and
publication timestamps are NOT certified pre-start observations. Treat the
statistics as structure-learning hypotheses, not forward ROI evidence.

Never writes to the serving model, snapshots, or production app.
"""
import argparse
import collections
import gzip
import hashlib
import json
import re
from pathlib import Path

PRICE = re.compile(r"^[\d,]+円$")
TRIPLE = re.compile(r"^[1-9][>-][1-9][>-][1-9]$")
CUTOFFS = (100, 200, 300)
BUCKETS = ("100-300", "400-900", "1000+")


def ticket_bucket(yen):
    return "100-300" if yen <= 300 else "400-900" if yen < 1000 else "1000+"


def line_relation(cars, lines):
    loc = {int(car): (i, pos) for i, line in enumerate(lines) for pos, car in enumerate(line)}
    a, b, c = cars
    if not all(q in loc for q in cars):
        return "unknown"
    if loc[a][0] != loc[b][0]:
        return "cross_line_first_two"
    if loc[a][1] > loc[b][1]:
        return "follower_before_leader"
    if loc[c][0] != loc[a][0]:
        return "same_line_first_two_other_line_third"
    return "same_line_all_three"


def outcome_payouts(labels):
    result = {}
    for row in labels.get("payments") or []:
        if len(row) < 3 or "３連単" not in row[0] and "3連単" not in row[0]:
            continue
        key = row[1].replace(">", "-").replace(" ", "")
        price = row[2].replace(" ", "")
        if not TRIPLE.fullmatch(key) or not PRICE.fullmatch(price):
            continue
        result[key] = int(price[:-1].replace(",", ""))
    return result


def record_summary(record, origin):
    labels = record["labels"]
    if labels.get("refund") or labels.get("cancelled"):
        return None, "refund_or_cancelled"
    groups = labels.get("tickets") or {}
    if "3連単" not in groups:
        return None, "no_3rentan"
    raw = groups["3連単"]
    if not raw:
        return None, "empty_3rentan"
    valid = set(int(q) for q in record["roster"])
    tickets = []
    for t in raw:
        cars = list(map(int, t["cars"]))
        yen = int(t["yen"])
        if len(cars) != 3 or len(set(cars)) != 3 or not set(cars) <= valid or yen < 100 or yen % 100:
            return None, "invalid_ticket"
        tickets.append((cars, yen))
    stake = sum(y for _, y in tickets)
    if not stake:
        return None, "zero_stake"
    pair_yen, first_yen = collections.Counter(), collections.Counter()
    for cars, yen in tickets:
        pair_yen[tuple(cars[:2])] += yen
        first_yen[cars[0]] += yen
    # Only uses teacher's own ticket distribution, not actual result.
    main_pair = sorted(pair_yen, key=lambda p: (-pair_yen[p], p))[0]
    main_first = sorted(first_yen, key=lambda c: (-first_yen[c], c))[0]
    pairs_sorted = sorted(pair_yen, key=lambda p: (-pair_yen[p], p))
    pair_rank = {p: i + 1 for i, p in enumerate(pairs_sorted)}
    payout = outcome_payouts(labels)
    rows = []
    for cars, yen in tickets:
        pair = tuple(cars[:2])
        kind = ("primary_pair_other_third" if pair == main_pair else
                "alternative_pair_same_first" if cars[0] == main_first else
                "alternative_first")
        key = "-".join(map(str, cars))
        paid = payout.get(key, 0) * yen // 100
        rows.append({
            "yen": yen, "bucket": ticket_bucket(yen), "pair_role": kind,
            "pair_rank": pair_rank[pair],
            "line_relation": line_relation(cars, record.get("lines", [])),
            "paid_yen": paid,
            "hit": paid > 0,
            "pay_per_100": payout.get(key, 0),
            "high_hit": bool(payout.get(key, 0) >= 10000),
        })
    return {"origin": origin, "date": record["date"], "race_id": record["race_id"],
            "field_size": len(valid), "race_class": ((record.get("entry") or {}).get("race_class") or "unknown"),
            "stake": stake, "budget_3rentan": stake,
            "n": len(tickets), "distinct_pairs": len(pair_yen),
            "top_pair_stake_share": pair_yen[main_pair] / stake,
            "top_first_stake_share": first_yen[main_first] / stake,
            "rows": rows}, None



def cohort_stats(tickets):
    n = len(tickets)
    stake = sum(t["yen"] for t in tickets)
    paid = sum(t["paid_yen"] for t in tickets)
    return {
        "tickets": n, "stake_yen": stake, "paid_yen": paid,
        "roi_percent": round(100 * paid / stake, 2) if stake else None,
        "hits": sum(t["hit"] for t in tickets),
        "high_payout_hits": sum(t["high_hit"] for t in tickets),
    }


def statistics(records):
    races = len(records)
    rows = [t for r in records for t in r["rows"]]
    stake = sum(t["yen"] for t in rows)
    total_paid = sum(t["paid_yen"] for t in rows)
    n = len(rows)
    groups = {}
    for bucket in BUCKETS:
        part = [t for t in rows if t["bucket"] == bucket]
        money = sum(t["yen"] for t in part)
        pay = sum(t["paid_yen"] for t in part)
        groups[bucket] = {
            "ticket_count": len(part), "ticket_share_percent": round(100 * len(part) / n, 2) if n else None,
            "stake_yen": money, "stake_share_percent": round(100 * money / stake, 2) if stake else None,
            "return_yen": pay, "roi_percent": round(100 * pay / money, 2) if money else None,
            "winning_ticket_count": sum(t["hit"] for t in part),
            "high_payout_win_count": sum(t["high_hit"] for t in part),
            "pair_role_counts": dict(sorted(collections.Counter(t["pair_role"] for t in part).items())),
            "line_relation_counts": dict(sorted(collections.Counter(t["line_relation"] for t in part).items())),
            "pair_rank_le_3": sum(t["pair_rank"] <= 3 for t in part),
        }
    high_races = [r for r in records if any(t["high_hit"] for t in r["rows"])]
    highest = sorted(records, key=lambda r: -sum(t["paid_yen"] for t in r["rows"]))
    sensitivities = {}
    for cut in (1, 3, 5):
        remaining = highest[cut:]
        money = sum(t["yen"] for r in remaining for t in r["rows"])
        pay = sum(t["paid_yen"] for r in remaining for t in r["rows"])
        sensitivities[str(cut)] = round(100 * pay / money, 2) if money else None
    roles = {}
    for role in ("primary_pair_other_third", "alternative_pair_same_first", "alternative_first"):
        tail = [t for t in rows if t["bucket"] == "100-300" and t["pair_role"] == role]
        roles[role] = {
            "small_tickets": len(tail), "small_stake_yen": sum(t["yen"] for t in tail),
            "winning_tickets": sum(t["hit"] for t in tail),
            "high_payout_hits": sum(t["high_hit"] for t in tail),
        }
    small = [t for t in rows if t["bucket"] == "100-300"]
    pair_role_roi = {role: cohort_stats([t for t in small if t["pair_role"] == role]) for role in
                     ("primary_pair_other_third", "alternative_pair_same_first", "alternative_first")}
    line_roi = {role: cohort_stats([t for t in small if t["line_relation"] == role]) for role in
                ("cross_line_first_two", "follower_before_leader", "same_line_first_two_other_line_third", "same_line_all_three", "unknown")}
    rank_roi = {role: cohort_stats([t for t in small if (t["pair_rank"] <= 3) == (role == "top3")]) for role in
                ("top3", "outside_top3")}
    mixed_roi = {role: cohort_stats([t for t in small if
                 t["line_relation"] == "cross_line_first_two" and
                 ((t["pair_rank"] <= 3) == (role == "top3"))]) for role in
                 ("top3", "outside_top3")}
    crossline_top3_by_field_size = {
        str(ncars): cohort_stats([t for r in records if r["field_size"] == ncars for t in r["rows"]
                                 if t["bucket"] == "100-300" and
                                 t["line_relation"] == "cross_line_first_two" and t["pair_rank"] <= 3])
        for ncars in (5, 6, 7, 8, 9)
    }
    crossline_top3_races = []
    for r in records:
        selected = [t for t in r["rows"] if t["bucket"] == "100-300" and
                    t["line_relation"] == "cross_line_first_two" and t["pair_rank"] <= 3]
        if selected:
            crossline_top3_races.append((r["race_id"], sum(t["yen"] for t in selected),
                                         sum(t["paid_yen"] for t in selected)))
    positive = sorted((x for x in crossline_top3_races if x[2] > 0),
                      key=lambda x: (-x[2], x[0]))
    sensitivity = {}
    for n_remove in (0, 1, 3, 5, 10):
        excluded_races = {x[0] for x in positive[:n_remove]}
        kept = [x for x in crossline_top3_races if x[0] not in excluded_races]
        cash = sum(x[1] for x in kept)
        payout = sum(x[2] for x in kept)
        sensitivity[str(n_remove)] = {
            "removed_winning_races": len(excluded_races), "remaining_stake_yen": cash,
            "remaining_payout_yen": payout,
            "roi_percent": round(100 * payout / cash, 2) if cash else None,
        }
    return {
        "races": races, "tickets_3rentan": n, "stake_yen": stake, "return_yen": total_paid,
        "roi_percent": round(100 * total_paid / stake, 2) if stake else None,
        "mean_points": round(n / races, 2) if races else None,
        "mean_distinct_ordered_pairs": round(sum(r["distinct_pairs"] for r in records) / races, 2) if races else None,
        "mean_top_pair_budget_percent": round(100 * sum(r["top_pair_stake_share"] for r in records)/races, 2) if races else None,
        "mean_top_first_budget_percent": round(100 * sum(r["top_first_stake_share"] for r in records)/races, 2) if races else None,
        "high_payout_hit_races": len(high_races),
        "high_payout_win_tickets": sum(t["high_hit"] for t in rows),
        "groups": groups, "small_ticket_roles": roles,
        "small_roi_by_pair_role": pair_role_roi,
        "small_roi_by_line_relation": line_roi,
        "small_roi_by_pair_rank": rank_roi,
        "small_crossline_roi_by_pair_rank": mixed_roi,
        "small_crossline_top3_by_field_size": crossline_top3_by_field_size,
        "small_crossline_top3_outlier_sensitivity": sensitivity,
        "overall_top_race_payout_removed_roi_percent": sensitivities,
    }


def load_corpus(root):
    manifest = json.loads((root / "mrt/research_seed_manifest.json").read_text())
    binary = (root / "mrt/research_seed.json.gz").read_bytes()
    if hashlib.sha256(binary).hexdigest() != manifest["sha256"]:
        raise ValueError("original corpus SHA256 mismatch")
    seed = json.loads(gzip.decompress(binary))
    if len(seed) != manifest["records"]:
        raise ValueError("record count mismatch")
    return seed, manifest


def run(root):
    root = Path(root)
    seed, manifest = load_corpus(root)
    records = []
    exclusions = collections.Counter()
    for r in seed:
        try:
            item, why = record_summary(r, "historical_retrospective_seed")
            if item:
                records.append(item)
            else:
                exclusions[why] += 1
        except (KeyError, ValueError, TypeError) as e:
            exclusions["invalid_record"] += 1
    new = []
    for path in sorted((root / "data/mrt_teacher/records").glob("*.json")):
        try:
            r = json.loads(path.read_text())
            if r.get("result_crosspage_verified") is not True:
                exclusions["unverified_teacher_reference"] += 1
                continue
            item, why = record_summary(r, "new_teacher_postrace_public")
            if item:
                new.append(item)
            else:
                exclusions["new_" + why] += 1
        except (KeyError, ValueError, TypeError):
            exclusions["new_invalid_record"] += 1
    earlier = [r for r in records if r["date"] <= "20260630"]
    later = [r for r in records if "20260701" <= r["date"] <= "20261121"]
    report = {
        "schema": "tk-mrt-tail-structure-audit/v1",
        "mode": "descriptive_teacher_ticket_structure",
        "historical_data_is_retroactively_collected": True,
        "do_not_use_teacher_actual_tickets_in_current_inference": True,
        "no_real_time_odds": True,
        "no_automatic_adoption": True,
        "teacher_seed_meta": {"records": manifest["records"], "first_date": manifest["first_date"],
                              "last_date": manifest["last_date"], "sha256": manifest["sha256"]},
        "split_provenance": "2026-06-30 chronological description only; both segments already within V3 training range; NOT an untouched test",
        "historical_all": statistics(records),
        "historical_early": statistics(earlier),
        "historical_late": statistics(later),
        "historical_mrt_eligible_7_9": statistics([r for r in records if r["field_size"] in (7, 9) and "ガールズ" not in r["race_class"]]),
        "historical_mrt_eligible_7_9_early": statistics([r for r in earlier if r["field_size"] in (7, 9) and "ガールズ" not in r["race_class"]]),
        "historical_mrt_eligible_7_9_late": statistics([r for r in later if r["field_size"] in (7, 9) and "ガールズ" not in r["race_class"]]),
        "new_teacher": statistics(new),
        "excluded_count_by_reason": dict(exclusions),
        "sample_teacher_small_high_hits": [{
            "race_id": r["race_id"], "date": r["date"],
            "small_high_win_tickets": [{
                "yen": x["yen"], "pair_role": x["pair_role"],
                "line_relation": x["line_relation"], "pay_per_100": x["pay_per_100"],
            } for x in r["rows"] if x["high_hit"] and x["bucket"] == "100-300"]
        } for r in new if any(x["high_hit"] and x["bucket"] == "100-300" for x in r["rows"])],
    }
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    p.add_argument("--output")
    a = p.parse_args()
    report = run(a.root)
    formatted = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if a.output:
        out = Path(a.output).resolve()
        area = (Path(a.root) / "data/mrt_research").resolve()
        if not out.is_relative_to(area):
            p.error("output must be under data/mrt_research")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(formatted)
    else:
        print(formatted)


if __name__ == "__main__":
    main()
