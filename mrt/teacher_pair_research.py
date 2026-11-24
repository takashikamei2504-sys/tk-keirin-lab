"""Shadow-only learning of Mr.T's ordered first/second pair priorities.

Trains on historical retrospective teacher tickets through 2026-06-30;
evaluates on later retrospective teacher cases and separately on 2026-11-22+
verified pre-start MRT inputs with post-race teacher labels.

NO production writes or model exports, NO odds, NO automatic promotion.
Historical entry cards may have been retrieved after the race, so the old
chronological split is NOT a certified untouched forward test.
"""
import argparse
import collections
import gzip
import hashlib
import itertools
import json
import math
from pathlib import Path


def finite(v):
    try:
        n = float(v)
        return n if math.isfinite(n) else 0.0
    except (TypeError, ValueError):
        return 0.0


def first_two_pairs(tickets):
    weights = collections.Counter()
    for t in tickets:
        if len(t["cars"]) != 3:
            continue
        weights[tuple(map(int, t["cars"][:2]))] += int(t["yen"])
    return sorted(weights, key=lambda pair: (-weights[pair], pair))


def line_index(input_race):
    loc = {}
    for line in input_race.get("lines") or []:
        for pos, car in enumerate(line):
            loc[int(car)] = (int(line[0]), pos, len(line))
    return loc


def pair_features(input_race, a, b):
    """All features come from the existing entry card and lineup; no labels/results."""
    players = (input_race.get("entry") or {}).get("players") or {}
    roster = [int(c) for c in input_race["roster"]]
    loc = line_index(input_race)
    one = players.get(str(a)) or {}
    two = players.get(str(b)) or {}
    vals = [finite((players.get(str(c)) or {}).get("score")) for c in roster]
    avg = sum(vals) / len(vals) if vals else 0
    top = max(vals, default=0)
    a_score, b_score = finite(one.get("score")), finite(two.get("score"))
    la, pa, na = loc.get(a, (a, -1, 0))
    lb, pb, nb = loc.get(b, (b, -1, 0))
    same = int(la == lb and pa >= 0 and pb >= 0)
    return [
        len(roster), len(input_race.get("lines") or []),
        int(pa == 0), int(pa == 1), int(pa >= 2), int(pa < 0),
        int(pb == 0), int(pb == 1), int(pb >= 2), int(pb < 0),
        na, nb, same, int(same and pa > pb), int(la != lb),
        a_score-avg, b_score-avg, a_score-b_score, top-a_score, top-b_score,
        int(one.get("score") is None), int(two.get("score") is None),
        finite(one.get("B")), finite(two.get("B")),
        finite(one.get("B"))-finite(two.get("B")),
        finite(one.get("nige")), finite(two.get("nige")),
        finite(one.get("makuri")), finite(two.get("makuri")),
        finite(one.get("sashi")), finite(two.get("sashi")),
        finite(one.get("top2_rate")), finite(two.get("top2_rate")),
    ]


FEATURE_NAMES = [
    "field_size", "line_count", "first_leader", "first_second", "first_third_plus", "first_unknown",
    "second_leader", "second_second", "second_third_plus", "second_unknown",
    "first_line_length", "second_line_length", "same_line", "follower_before_leader",
    "cross_line", "first_score_vs_race", "second_score_vs_race", "score_first_minus_second",
    "score_max_minus_first", "score_max_minus_second", "first_score_missing", "second_score_missing",
    "first_B", "second_B", "first_B_minus_second_B",
    "first_nige", "second_nige", "first_makuri", "second_makuri",
    "first_sashi", "second_sashi", "first_top2_rate", "second_top2_rate",
]


def eligible(r):
    cars = list(map(int, r.get("roster") or []))
    klass = str((r.get("entry") or {}).get("race_class") or "")
    return len(cars) in (7, 9) and len(set(cars)) == len(cars) and "ガールズ" not in klass


def race_training_rows(r):
    if not eligible(r):
        return None
    tt = (r.get("labels") or {}).get("tickets") or {}
    tickets = tt.get("3連単") or []
    if not tickets or (r.get("labels") or {}).get("refund") or (r.get("labels") or {}).get("cancelled"):
        return None
    labels = set(first_two_pairs(tickets)[:3])
    cars = list(map(int, r["roster"]))
    ps = list(itertools.permutations(cars, 2))
    features = [pair_features(r, *pair) for pair in ps]
    y = [int(pair in labels) for pair in ps]
    return ps, features, y, labels


def metrics(records, model):
    import numpy as np
    vals = []
    for r in records:
        item = race_training_rows(r)
        if item is None:
            continue
        pairs, X, _, truth = item
        rank = np.asarray(model.predict_proba(np.asarray(X,dtype=np.float32)))[:, 1]
        order = sorted(range(len(pairs)), key=lambda i:(-rank[i], pairs[i]))
        chosen = set(pairs[i] for i in order[:3])
        vals.append({"race_id":r["race_id"], "date":r["date"], "n":len(pairs),
                     "top3_recall": len(chosen & truth)/max(len(truth),1),
                     "matched_pairs":len(chosen & truth),
                     "teacher_pairs":len(truth)})
    n=len(vals)
    return {"races":n, "mean_top3_recall":round(sum(v["top3_recall"] for v in vals)/n,4) if n else None,
            "mean_top3_pair_hits":round(sum(v["matched_pairs"] for v in vals)/n,4) if n else None,
            "full_top3_match":sum(v["matched_pairs"]==3 for v in vals),
            "random_pair_recall_reference":round(sum(min(v["teacher_pairs"],3)/v["n"] for v in vals)/n,4) if n else None}


def run(root):
    import numpy as np
    from sklearn.ensemble import HistGradientBoostingClassifier
    root=Path(root)
    manifest=json.loads((root/"mrt/research_seed_manifest.json").read_text())
    blob=(root/"mrt/research_seed.json.gz").read_bytes()
    if hashlib.sha256(blob).hexdigest()!=manifest["sha256"]:
        raise ValueError("teacher seed checksum mismatch")
    records=json.loads(gzip.decompress(blob))
    earlier=[r for r in records if r["date"]<="20260630"]
    later=[r for r in records if "20260701"<=r["date"]<="20261121"]
    trainX,trainY=[],[]
    nraces=0
    for r in earlier:
        item=race_training_rows(r)
        if item is None:
            continue
        _,X,y,_=item
        trainX.extend(X)
        trainY.extend(y)
        nraces+=1
    if nraces<100 or len(set(trainY))!=2:
        raise ValueError("not enough historical pair labels")
    model=HistGradientBoostingClassifier(max_iter=75, max_leaf_nodes=15,
                 learning_rate=0.07, l2_regularization=1.5, min_samples_leaf=150,
                 random_state=634).fit(np.asarray(trainX,dtype=np.float32),
                                      np.asarray(trainY,dtype=np.int8))
    historical_late=metrics(later,model)
    new_rows=[]
    excluded=[]
    for path in sorted((root/"data/mrt_teacher/records").glob("*.json")):
        try:
            ref=json.loads(path.read_text())
            if ref.get("result_crosspage_verified") is not True:
                raise ValueError("unverified teacher reference")
            rid=ref["race_id"]
            date=f"{rid[:4]}-{rid[4:6]}-{rid[6:8]}"
            snap=ref.get("pre_race_snapshot")
            if not snap or not snap.startswith(f"data/mrt/{date}/"):
                raise ValueError("missing matched frozen snapshot")
            p=json.loads((root/snap).read_text())
            if p.get("pre_race") is not True or p.get("race_id")!=rid:
                raise ValueError("snapshot identity or pre-race flag invalid")
            from .allocation_audit import validated_snapshot
            results=json.loads((root/"data/mrt"/date/"results.json").read_text())["results"]
            res=next((q for q in results if q["race_id"]==rid and q.get("status")=="final"),None)
            if not res:
                raise ValueError("unverified MRT result")
            validated_snapshot(p,res,rid)
            r=dict(p["input"])
            r["labels"]=ref["labels"]
            if not eligible(r):
                raise ValueError("unsupported class")
            item=race_training_rows(r)
            if item is None:
                raise ValueError("not a valid 3rentan ticket reference")
            ps,X,_,truth=item
            prob=np.asarray(model.predict_proba(np.asarray(X,dtype=np.float32)))[:,1]
            ordered=sorted(range(len(ps)),key=lambda i:(-prob[i],ps[i]))
            selected=[ps[i] for i in ordered[:3]]
            model_set=set(selected)
            original=first_two_pairs(p["automatic"]["tickets"])
            mrt_top3=set(original[:3])
            win_pairs={tuple(map(int,q.split("-")[:2])) for q in res["payouts"]}
            winning_teacher_purchased=set(first_two_pairs(r["labels"]["tickets"]["3連単"])) & win_pairs
            row={"race_id":rid,"date":r["date"],"venue":p.get("venue_name"),"race_no":p.get("race_no"),
                 "field_size":len(r["roster"]),"teacher_top3":[list(x) for x in sorted(truth)],
                 "learned_top3":[list(x) for x in selected],
                 "mrt_top3":[list(x) for x in sorted(mrt_top3)],
                 "learned_top3_overlap":len(model_set & truth),
                 "mrt_top3_overlap":len(mrt_top3 & truth),
                 "win_pair": [list(x) for x in sorted(win_pairs)],
                 "learned_has_winning_pair":bool(win_pairs & model_set),
                 "mrt_has_winning_pair":bool(win_pairs & set(original)),
                 "teacher_has_winning_pair":bool(winning_teacher_purchased),
                 "teacher_hit":any("-".join(map(str,t["cars"])) in res["payouts"] for t in ref["labels"]["tickets"]["3連単"])}
            new_rows.append(row)
        except (OSError,ValueError,KeyError,TypeError,StopIteration) as e:
            excluded.append({"id":path.stem,"reason":str(e)})
    eligible_rows=len(new_rows)
    return {
      "schema":"tk-mrt-teacher-ordered-pair-research/v1",
      "research_only":True,"not_forward_test":True,"historical_source_pre_start_unverified":True,
      "new_rows_use_frozen_pre_start_mrt_input":True,
      "teacher_tickets_collected_postrace":True,
      "training_cutoff":"2026-06-30","trained_races":nraces,
      "trained_pair_rows":len(trainY),"feature_names":FEATURE_NAMES,
      "no_market_odds":True,"no_automatic_adoption":True,
      "historical_late_replay":historical_late,
      "fresh_teacher_races":eligible_rows,
      "fresh_teacher_top3_pair_matches":sum(r["learned_top3_overlap"] for r in new_rows),
      "fresh_teacher_top3_pair_opportunities":sum(len(r["teacher_top3"]) for r in new_rows),
      "mrt_baseline_top3_pair_matches":sum(r["mrt_top3_overlap"] for r in new_rows),
      "fresh_teacher_win_pairs":sum(r["teacher_has_winning_pair"] for r in new_rows),
      "fresh_learned_top3_has_win_pair":sum(r["learned_has_winning_pair"] for r in new_rows),
      "fresh_mrt_any_pair_has_win_pair":sum(r["mrt_has_winning_pair"] for r in new_rows),
      "excluded":excluded,"rows":new_rows,
    }


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root",default=str(Path(__file__).resolve().parents[1]))
    ap.add_argument("--output")
    a=ap.parse_args()
    output=json.dumps(run(a.root),ensure_ascii=False,indent=2)+"\n"
    if a.output:
        out=Path(a.output).resolve()
        area=(Path(a.root)/"data/mrt_research").resolve()
        if not out.is_relative_to(area):
            ap.error("output must be in data/mrt_research")
        out.parent.mkdir(parents=True,exist_ok=True)
        out.write_text(output)
    else:print(output)

if __name__=="__main__":main()
