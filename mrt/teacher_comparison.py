"""Read-only, pairwise teacher-vs-MRT V3 audit of frozen forecasts.

Only real saved pre-start MRT auto ticket snapshots and retrospectively observed
public Mr.T reference tickets are compared on the identical race and payout.
Teacher published_at is often unknown: do not describe this as independent
forward proof of the teacher forecast's publication timestamp.
"""
import argparse
import json
from collections import Counter
from pathlib import Path
from .allocation_audit import BUDGET, accounting, classification, validated_snapshot


def key(t):
    return "-".join(map(str, t["cars"]))


def amounts(tickets):
    return {key(t): int(t["yen"]) for t in tickets}


def compare(teacher, mrt, result):
    if teacher.get("expert_id") != 634 or teacher.get("result_crosspage_verified") is not True:
        raise ValueError("teacher reference missing crosspage verification")
    if teacher["race_id"] != mrt["race_id"] or teacher["race_id"] != result["race_id"]:
        raise ValueError("race mismatch")
    if teacher.get("date") != mrt["race_id"][:8]:
        raise ValueError("date mismatch")
    original = validated_snapshot(mrt, result, teacher["race_id"])
    if teacher["measured_result"]["roster"] != result["roster"]:
        raise ValueError("teacher result rider identity mismatch")
    label = teacher["labels"]
    if label.get("cancelled") or label.get("refund", 0):
        raise ValueError("refund, cancelled or irregular race excluded")
    if set(label.get("tickets", {})) != {"3連単"}:
        raise ValueError("unsupported teacher ticket types")
    tt = label["tickets"]["3連単"]
    stake = sum(int(t["yen"]) for t in tt)
    charged = label["charged_stake"]
    if stake != charged or stake != BUDGET or any(t["yen"] % 100 for t in tt):
        raise ValueError("teacher stake mismatch")
    if len({key(t) for t in tt}) != len(tt):
        raise ValueError("duplicated teacher ticket")
    if any(len(t["cars"]) != 3 or len(set(t["cars"])) != 3 or
           any(str(c) not in result["roster"] for c in t["cars"]) for t in tt):
        raise ValueError("invalid teacher ticket")
    teacher_pay = accounting(tt, result["payouts"])
    model_pay = accounting(original, result["payouts"])
    if teacher_pay != label["teacher_payout"]:
        raise ValueError("teacher payout versus result mismatch")
    winner = sorted(result["payouts"], key=lambda k: (-int(result["payouts"][k]), k))[0]
    winning = [w for w in result["payouts"]]
    teacher_map, model_map = amounts(tt), amounts(original)
    shared = set(teacher_map) & set(model_map)
    common_stake = sum(min(teacher_map[x], model_map[x]) for x in shared)
    first_two = [w.split("-")[:2] for w in winning]
    teacher_pair_hit = any(c[:2] in [key(t).split("-")[:2] for t in tt] for c in first_two)
    mrt_pair_hit = any(c[:2] in [key(t).split("-")[:2] for t in original] for c in first_two)
    leader = int(winner.split("-")[0])
    top_first_teacher = sorted(Counter({str(c): sum(t["yen"] for t in tt if t["cars"][0] == int(c))
                                        for c in result["roster"]}).items(), key=lambda x: (-x[1], x[0]))[0]
    top_first_mrt = sorted(Counter({str(c): sum(t["yen"] for t in original if t["cars"][0] == int(c))
                                    for c in result["roster"]}).items(), key=lambda x: (-x[1], x[0]))[0]
    b_scenarios = mrt.get("automatic", {}).get("scenarios") or []
    most_likely_b = max(b_scenarios, key=lambda x: x.get("scenario_weight", 0)) if b_scenarios else {}
    return {
        "race_id": teacher["race_id"], "date": teacher["date"], "venue": mrt.get("venue_name"),
        "race_no": teacher.get("race_no"), "field_size": len(result["roster"]),
        "race_class": mrt["input"]["entry"].get("race_class", "unknown"),
        "winning_combination": winner, "winning_payout_per_100": result["payouts"][winner],
        "teacher_stake": stake, "mrt_stake": BUDGET,
        "teacher_return": teacher_pay, "mrt_return": model_pay,
        "teacher_hit": teacher_pay > 0, "mrt_hit": model_pay > 0,
        "teacher_win_ticket_yen": {k: teacher_map[k] for k in winning if k in teacher_map},
        "mrt_win_ticket_yen": {k: model_map[k] for k in winning if k in model_map},
        "teacher_points": len(tt), "mrt_points": len(original),
        "identical_ticket_count": len(shared), "ticket_set_jaccard": round(len(shared) / len(set(teacher_map)|set(model_map)), 4),
        "shared_ticket_stake_min_yen": common_stake,
        "teacher_top_first_car": top_first_teacher[0],
        "teacher_top_first_stake": top_first_teacher[1],
        "mrt_top_first_car": top_first_mrt[0],
        "mrt_top_first_stake": top_first_mrt[1],
        "teacher_has_winning_pair": teacher_pair_hit, "mrt_has_winning_pair": mrt_pair_hit,
        "teacher_honmei": label.get("honmei"),
        "mrt_b_top": most_likely_b.get("proposed_B_holder"),
        "mrt_b_top_weight": most_likely_b.get("scenario_weight"),
        "actual_back": result.get("back"),
        "mrt_miss_class": classification(original, result["payouts"]),
        "teacher_actions_extracted": [
            {"actor": e.get("actor"), "action": e.get("action"), "negated": e.get("negated", False),
             "conditional": e.get("conditional", False)} for e in label.get("events", [])
        ],
        "teacher_published_at": teacher.get("published_at"),
        "teacher_forecast_id": teacher["forecast_id"],
        "source_url": teacher.get("source_url"),
        "model_sha256": mrt.get("model_sha256"),
    }


def summarize(rows):
    count = len(rows)
    stake = sum(r["teacher_stake"] for r in rows)
    teach = sum(r["teacher_return"] for r in rows)
    model = sum(r["mrt_return"] for r in rows)
    return {
        "matched_races": count, "joint_stake_yen_each": stake,
        "teacher_return_yen": teach, "mrt_return_yen": model,
        "teacher_roi_percent": round(100 * teach / stake, 4) if stake else None,
        "mrt_roi_percent": round(100 * model / stake, 4) if stake else None,
        "teacher_hits": sum(r["teacher_hit"] for r in rows), "mrt_hits": sum(r["mrt_hit"] for r in rows),
        "mean_teacher_points": round(sum(r["teacher_points"] for r in rows) / count, 2) if count else None,
        "mean_mrt_points": round(sum(r["mrt_points"] for r in rows) / count, 2) if count else None,
        "mean_shared_stake_yen": round(sum(r["shared_ticket_stake_min_yen"] for r in rows)/count, 2) if count else None,
        "teacher_only_hits": sum(r["teacher_hit"] and not r["mrt_hit"] for r in rows),
        "mrt_only_hits": sum(r["mrt_hit"] and not r["teacher_hit"] for r in rows),
        "both_hits": sum(r["mrt_hit"] and r["teacher_hit"] for r in rows),
        "neither_hits": sum(not r["mrt_hit"] and not r["teacher_hit"] for r in rows),
    }


def run(root):
    root = Path(root)
    rows, excluded = [], []
    for path in sorted((root / "data/mrt_teacher/records").glob("*.json")):
        try:
            teacher = json.loads(path.read_text())
            rid = teacher["race_id"]
            date = f"{rid[:4]}-{rid[4:6]}-{rid[6:8]}"
            folder = root / "data/mrt" / date
            if not (folder / "results.json").exists():
                raise ValueError("missing saved result file")
            results = json.loads((folder / "results.json").read_text())["results"]
            result = next((r for r in results if r["race_id"] == rid and r["status"] == "final"), None)
            if result is None:
                raise ValueError("no verified final outcome")
            snapshot = teacher.get("pre_race_snapshot")
            if not snapshot or not snapshot.startswith(f"data/mrt/{date}/"):
                raise ValueError("teacher pre-race snapshot path unavailable")
            snap_path = (root / snapshot).resolve()
            if not snap_path.is_relative_to((root/"data/mrt").resolve()):
                raise ValueError("snapshot outside data/mrt")
            mrt = json.loads(snap_path.read_text())
            rows.append(compare(teacher, mrt, result))
        except (OSError, ValueError, TypeError, KeyError, StopIteration) as e:
            excluded.append({"forecast_id": path.stem, "reason": str(e)})
    rows.sort(key=lambda x: x["race_id"])
    high = [r for r in rows if r["winning_payout_per_100"] >= 10000]
    high.sort(key=lambda x: (-x["winning_payout_per_100"], x["race_id"]))
    teacher_high_hits = [r for r in high if r["teacher_hit"]]
    model_high_hits = [r for r in high if r["mrt_hit"]]
    return {
        "schema": "tk-mrt-teacher-vs-v3/v1",
        "mode": "same_race_retrospective_comparison",
        "teacher_reference_postrace_observed": True,
        "teacher_publication_time_not_independently_verified": True,
        "mrt_pre_start_snapshot_required": True,
        "teacher_profile_scope": "Available collected Mr.T public reference records only; no assertion of exhaustive past predictions",
        "automatic_promotion": False, "adoption": "human_decision_required",
        "total": summarize(rows),
        "by_date": {d: summarize([r for r in rows if r["date"] == d]) for d in sorted({r["date"] for r in rows})},
        "high_payout_count": len(high),
        "teacher_high_payout_hits": len(teacher_high_hits),
        "mrt_high_payout_hits": len(model_high_hits),
        "high_payout_rows": high,
        "teacher_wins_mrt_misses": [r for r in rows if r["teacher_hit"] and not r["mrt_hit"]],
        "mrt_wins_teacher_misses": [r for r in rows if r["mrt_hit"] and not r["teacher_hit"]],
        "excluded": excluded, "rows": rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--output", help="Research-only JSON output path")
    args = parser.parse_args()
    report = run(args.root)
    data = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        area = (Path(args.root) / "data/mrt_research").resolve()
        path = Path(args.output).resolve()
        if not path.is_relative_to(area):
            parser.error("--output must be inside data/mrt_research")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(data)
    else:
        print(data)


if __name__ == "__main__":
    main()
