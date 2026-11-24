"""MRT MICRO forward-only shadow: independent third choices and allocation.

Modes: freeze (pre-close only, immutable), evaluate (post-final only),
       dry-run (checks candidate training without writing anything).
No online odds, no actual purchases, no production model changes, no promotion.

The fixed teacher source stops 2026-06-30. The source entry features in that
historical corpus are retrospectively collected: source training is NOT itself
a forward test. The frozen *new* shadow comparison is prospective only.
"""
import argparse
import collections
import datetime as dt
import gzip
import hashlib
import itertools
import json
import math
import os
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from .allocation_audit import allocate, accounting
from .teacher_pair_research import eligible, finite, line_index, pair_features

JST=dt.timezone(dt.timedelta(hours=9))
TRAIN_THROUGH="20260630"
START_DATE="2026-11-24"
POLICY={
    "schema":"tk-mrt-micro-forward-policy/v1",
    "training_through":TRAIN_THROUGH,
    "start_date":START_DATE,
    "scope":"men 7/9 car, 3rentan only",
    "original_stake_yen":10000,
    "third_only_additions":8,
    "new_pair_additions":8,
    "max_additions_per_new_pair":2,
    "max_additions_per_existing_pair":4,
    "hybrid_third_additions":7,
    "hybrid_pair_additions":8,
    "max_hybrid_additions_per_existing_pair":3,
    "add_per_ticket_yen":100,
    "capital_ceiling_yen":5000,
    "no_buy_max_pair_signal_lt":0.15,
    "max_teacher_pairs_per_training_race":6,
    "model":"HistGradientBoostingClassifier(max_iter=65,max_leaf_nodes=15,min_samples_leaf=120,learning_rate=0.07,l2_regularization=1.5,random_state=634)",
    "forward_review_min_races":200,
    "forward_review_min_calendar_days":28,
    "production_adoption":"requires explicit human decision",
    "automatic_promotion":False,
    "real_time_odds":False,
}
ALL_METHODS=("A_original","B_third","C_pair","D_hybrid","E_capped_skip")

def iso(s):
    x=dt.datetime.fromisoformat(s)
    if x.utcoffset() is None:
        raise ValueError("naive timestamp")
    return x

def utcnow():
    return dt.datetime.now(dt.timezone.utc)

def sha_bytes(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def current_protocol(root):
    policy=json.dumps(POLICY,ensure_ascii=False,sort_keys=True).encode()
    source=b"".join((root/"mrt"/name).read_bytes() for name in
                    ("micro_forward.py","teacher_pair_research.py"))
    manifest=(root/"mrt/research_seed_manifest.json").read_bytes()
    return hashlib.sha256(policy+source+manifest).hexdigest()[:18]

def triple_features(r,a,b,c):
    roster=list(map(int,r["roster"]))
    p=(r.get("entry") or {}).get("players") or {}
    loc=line_index(r)
    la,pa,na=loc.get(a,(a,-1,0))
    lb,pb,nb=loc.get(b,(b,-1,0))
    lc,pc,nc=loc.get(c,(c,-1,0))
    first=p.get(str(a)) or {};second=p.get(str(b)) or {};third=p.get(str(c)) or {}
    scores=[finite((p.get(str(i)) or {}).get("score")) for i in roster]
    avg=sum(scores)/len(scores) if scores else 0
    sa,sb,sc=(finite(q.get("score")) for q in (first,second,third))
    tail=[
        int(lc==la and pc>=0 and pa>=0),
        int(lc==lb and pc>=0 and pb>=0),
        int(lc!=la and lc!=lb and pc>=0),
        int(pc==0),int(pc==1),int(pc>=2),int(pc<0),nc,
        sc-avg,sc-sa,sc-sb,
        finite(third.get("B")),finite(third.get("nige")),
        finite(third.get("makuri")),finite(third.get("sashi")),
        finite(third.get("mark")),finite(third.get("top2_rate")),
        int(third.get("score") is None),int(la!=lb),
    ]
    x=pair_features(r,a,b)+tail
    if not all(math.isfinite(y) for y in x):
        raise ValueError("nonfinite third features")
    return x

def teacher_micro_triplets(r):
    labels=r["labels"]
    tickets=(labels.get("tickets") or {}).get("3連単") or []
    small=[t for t in tickets if 100<=int(t["yen"])<=300 and len(t["cars"])==3]
    return {tuple(map(int,t["cars"])) for t in small}

def training_rows(r):
    if not eligible(r):
        return [],[],[],[]
    labels=r.get("labels") or {}
    if labels.get("refund") or labels.get("cancelled"):
        return [],[],[],[]
    small=teacher_micro_triplets(r)
    if not small:
        return [],[],[],[]
    cars=list(map(int,r["roster"]))
    pair_counts=collections.Counter()
    for (a,b,c) in small:
        pair_counts[(a,b)]+=1
    chosen=sorted(pair_counts,key=lambda p:(-pair_counts[p],p))[:POLICY["max_teacher_pairs_per_training_race"]]
    pairs=list(itertools.permutations(cars,2))
    pair_features_all=[pair_features(r,a,b) for a,b in pairs]
    pair_labels=[int(any((a,b)==q[:2] for q in small)) for a,b in pairs]
    tx=[];ty=[]
    for a,b in chosen:
        for c in cars:
            if c in (a,b):continue
            tx.append(triple_features(r,a,b,c))
            ty.append(int((a,b,c) in small))
    return pair_features_all,pair_labels,tx,ty

def load_fixed_training(root):
    root=Path(root)
    m=json.loads((root/"mrt/research_seed_manifest.json").read_text())
    original=(root/"mrt/research_seed.json.gz").read_bytes()
    if hashlib.sha256(original).hexdigest()!=m["sha256"]:
        raise ValueError("training corpus checksum mismatch")
    rows=json.loads(gzip.decompress(original))
    if len(rows)!=m["records"] or max(r["date"] for r in rows)!=m["last_date"]:
        raise ValueError("training corpus metadata mismatch")
    return [r for r in rows if r["date"]<=TRAIN_THROUGH]

def train(root):
    from sklearn import __version__ as sklearn_version
    rows=load_fixed_training(root)
    px=[];py=[];tx=[];ty=[];race_count=0
    for r in rows:
        x,y,third_x,third_y=training_rows(r)
        if not third_y:continue
        px.extend(x);py.extend(y);tx.extend(third_x);ty.extend(third_y);race_count+=1
    if race_count<100 or set(py)!={0,1} or set(ty)!={0,1}:
        raise ValueError("insufficient positive and negative training labels")
    def fit(x,y):
        clf=HistGradientBoostingClassifier(max_iter=65,max_leaf_nodes=15,
            min_samples_leaf=120,learning_rate=0.07,l2_regularization=1.5,
            random_state=634)
        return clf.fit(np.asarray(x,dtype=np.float32),np.asarray(y,dtype=np.int8))
    pair=fit(px,py);third=fit(tx,ty)
    return {"pair":pair,"third":third,
            "meta":{"training_races":race_count,"pair_training_rows":len(py),
                    "third_training_rows":len(ty),"training_through":TRAIN_THROUGH,
                    "seed_sha256":sha_bytes(Path(root)/"mrt/research_seed.json.gz"),
                    "sklearn_version":sklearn_version,
                    "protocol_id":current_protocol(Path(root))}}

def _classify(entry,model,original):
    cars=sorted(map(int,entry["roster"]))
    allpairs=list(itertools.permutations(cars,2))
    pp=model["pair"].predict_proba(np.asarray([pair_features(entry,*p) for p in allpairs],dtype=np.float32))[:,1]
    ranked_pairs=sorted(zip(allpairs,map(float,pp)),key=lambda x:(-x[1],x[0]))
    bought={tuple(t["cars"]) for t in original}
    pairs_by_original=collections.Counter()
    for t in original:
        pairs_by_original[tuple(t["cars"][:2])]+=int(t["yen"])
    primary=sorted(pairs_by_original,key=lambda x:(-pairs_by_original[x],x))[:3]
    # Ordered first/second pairs already purchased get selective third supplements.
    third_paths=[(a,b,c) for (a,b) in primary for c in cars if c not in (a,b) and (a,b,c) not in bought]
    # Distinct ordered pairs not already purchased; not blind 3rd-place completion.
    newpairs=[(pair,weight) for pair,weight in ranked_pairs if pair not in pairs_by_original][:10]
    pair_paths=[(a,b,c) for ((a,b),_) in newpairs for c in cars if c not in (a,b)]
    paths=sorted(set(third_paths+pair_paths))
    if not paths:
        return [],[],{"max_pair_signal":float(ranked_pairs[0][1]) if ranked_pairs else 0.0,
                       "primary_pairs":[list(x) for x in primary]}
    trip=np.asarray([triple_features(entry,*t) for t in paths],dtype=np.float32)
    p3=model["third"].predict_proba(trip)[:,1]
    prob3=dict(zip(paths,map(float,p3)))
    pair_weights=dict(ranked_pairs)
    # The model scores are *imitation propensities*, not triplet win probabilities or EV.
    def rank(candidates):
        return sorted(candidates,key=lambda t:(-prob3[t]*max(pair_weights.get(t[:2],0.001),0.001),t))
    thirds=rank(third_paths)
    micro=rank(pair_paths)
    def ticket(t,kind):
        return {"cars":list(t),"yen":100,
                "teacher_pair_signal":round(float(pair_weights.get(t[:2],0)),8),
                "teacher_third_signal":round(float(prob3[t]),8),
                "origin":kind}
    return ([ticket(x,"third") for x in thirds],
            [ticket(x,"pair") for x in micro],
            {"max_pair_signal":float(ranked_pairs[0][1]) if ranked_pairs else 0,
             "primary_pairs":[list(x) for x in primary],
             "pair_top10":[{"cars":list(x),"score":round(float(v),7)} for x,v in ranked_pairs[:10]]})

def _fund(original,extra,budget):
    original=[dict(t) for t in original]
    extras=extra[:min(len(extra),budget//100-len(original))]
    reserve=100*len(extras)
    base=allocate(original,budget-reserve,[int(t["yen"]) for t in original])
    return base+extras

def make_variants(original,third_candidates,micro_candidates,signal):
    orig=[dict(t) for t in original]
    base={tuple(t["cars"]) for t in orig}
    if len(base)!=len(orig) or sum(t["yen"] for t in orig)!=10000:
        raise ValueError("invalid recorded original auto tickets")
    def pick(seq,n,seen,pair_limit):
        result=[]
        chosen_by_pair=collections.Counter()
        for t in seq:
            tup=tuple(t["cars"])
            pair=tup[:2]
            if tup not in seen and chosen_by_pair[pair]<pair_limit:
                result.append(dict(t))
                chosen_by_pair[pair]+=1
                seen.add(tup)
            if len(result)>=n:break
        return result
    third=pick(third_candidates,POLICY["third_only_additions"],set(base),POLICY["max_additions_per_existing_pair"])
    micro=pick(micro_candidates,POLICY["new_pair_additions"],set(base),POLICY["max_additions_per_new_pair"])
    seen=set(base)
    h_third=pick(third_candidates,POLICY["hybrid_third_additions"],seen,POLICY["max_hybrid_additions_per_existing_pair"])
    h_micro=pick(micro_candidates,POLICY["hybrid_pair_additions"],seen,POLICY["max_additions_per_new_pair"])
    hybrid=h_third+h_micro
    variants={
        "A_original":orig,
        "B_third":_fund(orig,third,10000),
        "C_pair":_fund(orig,micro,10000),
        "D_hybrid":_fund(orig,hybrid,10000)}
    no_buy=(signal<POLICY["no_buy_max_pair_signal_lt"] or not hybrid or
            len(orig)>POLICY["capital_ceiling_yen"]//100)
    variants["E_capped_skip"]=[] if no_buy else _fund(orig,hybrid,POLICY["capital_ceiling_yen"])
    for name,t in variants.items():
        st=sum(x["yen"] for x in t)
        required=(0 if no_buy else POLICY["capital_ceiling_yen"]) if name=="E_capped_skip" else POLICY["original_stake_yen"]
        if st!=required or any(x["yen"]<100 or x["yen"]%100 for x in t):
            raise AssertionError("invalid paper allocation "+name)
        if len({tuple(x["cars"]) for x in t})!=len(t):
            raise AssertionError("duplicated paper ticket "+name)
    return variants,{"no_buy":no_buy,"no_buy_reason":("insufficient_pair_signal" if signal<POLICY["no_buy_max_pair_signal_lt"] else "no_new_candidates" if not hybrid else "existing_ticket_count_exceeds_cap" if len(orig)>POLICY["capital_ceiling_yen"]//100 else None),"gate":POLICY["no_buy_max_pair_signal_lt"],
                     "third_candidates":len(third_candidates),
                     "new_pair_candidates":len(micro_candidates),
                     "selected_additions":len(hybrid)}

def validate_preclose(p,model,at):
    from .research_data import verify_snapshot
    entry=verify_snapshot(p)
    close=iso(p["sales_close_at"])
    if at.utcoffset() is None or at>=close:
        raise ValueError("cannot create after sales close")
    if at<iso(p["generated_at"]) or at<iso(p["entry_observed_at"]):
        raise ValueError("snapshot not yet observed")
    if p.get("date") is not None and p["date"] != p["race_id"][:8]:
        raise ValueError("top-level date mismatch")
    d=p["race_id"][:8]
    if d < START_DATE.replace("-",""):
        raise ValueError("pre-registration historical freeze forbidden")
    if d<=model["meta"]["training_through"]:
        raise ValueError("overlap with teacher training")
    if p.get("model_id")!="MRT_V3_7126":
        raise ValueError("baseline model identity mismatch")
    if not eligible(entry):
        raise ValueError("field not eligible")
    return entry,close

def freeze_one(p,model,at=None,clock=None):
    at=at or utcnow()
    entry,close=validate_preclose(p,model,at)
    original=p["automatic"]["tickets"]
    if not original or len({tuple(t["cars"]) for t in original})!=len(original):
        raise ValueError("missing or duplicated baseline tickets")
    th,mi,signals=_classify(entry,model,original)
    methods,decision=make_variants(original,th,mi,signals["max_pair_signal"])
    finished=clock() if clock else utcnow()
    if not at<=finished<close:
        raise ValueError("calculation did not complete before sales close")
    return {
        "schema":"tk-mrt-micro-forward/v1",
        "race_id":p["race_id"],"date":entry["date"],"generated_at":finished.isoformat(),
        "entry_observed_at":p["entry_observed_at"],
        "original_generated_at":p["generated_at"],
        "sales_close_at":p["sales_close_at"],"start_at":p["start_at"],
        "pre_race":True,"frozen":True,
        "protocol_id":model["meta"]["protocol_id"],"training":model["meta"],
        "model_id":p["model_id"],"model_sha256":p["model_sha256"],
        "engine_sha256":p.get("engine_sha256"),
        "identity_sha256":p.get("identity_sha256"),
        "source_sha256":hashlib.sha256(json.dumps(p,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),
        "field_size":len(entry["roster"]),"race_class":entry["entry"].get("race_class") or "不明",
        "roster":{str(c):str(x["rider_id"]) for c,x in entry["entry"]["players"].items()},
        "methods":methods,"decision":decision,"signals":signals,
        "safety":{"real_time_odds":False,"postrace_teacher_used":False,
                  "automatic_promotion":False,"bets_placed":False}
    }

def _dump_immutable(path,data):
    path=Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    raw=(json.dumps(data,sort_keys=True,ensure_ascii=False,allow_nan=False)+"\n").encode()
    try:
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o644)
    except FileExistsError:
        raise ValueError("immutable pre-start shadow already exists")
    with os.fdopen(fd,"wb") as f:
        f.write(raw)

def _snapshots(root,date):
    folder=root/"data/mrt"/date
    index=folder/"index.json"
    if not index.exists():
        return []
    rows=json.loads(index.read_text()).get("races",[])
    return [(folder,row) for row in rows if row.get("file")]

def freeze_day(root,model,date,at=None):
    root=Path(root)
    at=at or utcnow()
    if date<START_DATE:
        raise ValueError("cannot initiate earlier than study start")
    dest=root/"data/mrt_research/micro_forward"/"snapshots"
    status={"date":date,"at":at.isoformat(),"protocol_id":model["meta"]["protocol_id"],
            "frozen":0,"already":0,"closed":0,"rejected":[]}
    for folder,row in _snapshots(root,date):
        rid=row["race_id"]
        target=dest/(rid+".json")
        if target.exists():
            status["already"]+=1
            continue
        try:
            name=row["file"]
            if Path(name).name!=name or not name.startswith(rid+"-") or not name.endswith(".json"):
                raise ValueError("invalid snapshot filename")
            p=json.loads((folder/name).read_text())
            if p["race_id"]!=rid or p.get("identity_sha256")!=row.get("identity_sha256"):
                raise ValueError("manifest identity mismatch")
            if at>=iso(p["sales_close_at"]):
                status["closed"]+=1
                continue
            new=freeze_one(p,model,at)
            _dump_immutable(target,new)
            status["frozen"]+=1
        except Exception as e:
            status["rejected"].append({"race_id":rid,"reason":str(e)})
    return status

def _result_map(root):
    items={}
    for p in sorted((root/"data/mrt").glob("*/results.json")):
        x=json.loads(p.read_text())
        for r in x.get("results",[]):
            if r.get("status")=="final":
                items[r["race_id"]]=r
    return items

def _verified_forward_row(path,result):
    s=json.loads(path.read_text())
    if s.get("schema")!="tk-mrt-micro-forward/v1" or not s.get("pre_race") or not s.get("frozen"):
        raise ValueError("not a frozen forward prediction")
    close=iso(s["sales_close_at"])
    if iso(s["generated_at"])>=close or iso(s["original_generated_at"])>=close:
        raise ValueError("late prediction")
    if s["race_id"][:8]<START_DATE.replace("-",""):
        raise ValueError("historical backfilled shadow")
    if result["race_id"]!=s["race_id"] or result["roster"]!=s["roster"] or not result.get("payouts"):
        raise ValueError("final result identity or payouts mismatch")
    if result.get("status")!="final":
        raise ValueError("incomplete result")
    for n in ALL_METHODS:
        if n not in s["methods"]:
            raise ValueError("missing shadow method "+n)
    methods=s["methods"]
    row={"race_id":s["race_id"],"date":s["date"],
         "protocol_id":s["protocol_id"],"field_size":s["field_size"],"race_class":s["race_class"],
         "win_pay100_max":max(int(p) for p in result["payouts"].values()),
         "no_buy":s["decision"]["no_buy"]}
    winning_pairs={tuple(int(c) for c in key.split("-")[:2]) for key in result["payouts"]}
    original_set={tuple(t["cars"]) for t in methods["A_original"]}
    for method,t in methods.items():
        stake=sum(x["yen"] for x in t)
        paid=accounting(t,result["payouts"])
        pair_hit=any(tuple(x["cars"][:2]) in winning_pairs for x in t)
        bought=len(t)>0
        additions=sum(tuple(x["cars"]) not in original_set for x in t)
        row[method]={"stake":stake,"payout":paid,"net":paid-stake,
                     "hit":int(paid>0),"points":len(t),
                     "winning_pair_covered":int(pair_hit),
                     "third_miss":int(pair_hit and paid==0 and bought),
                     "new_ticket_points":additions}
    return row

def _summary(rows):
    out={}
    for name in ALL_METHODS:
        stake=sum(x[name]["stake"] for x in rows)
        payout=sum(x[name]["payout"] for x in rows)
        purchased=sum(x[name]["stake"]>0 for x in rows)
        out[name]={"eligible_races":len(rows),"purchased_races":purchased,
                   "skipped_races":len(rows)-purchased,
                   "stake_yen":stake,"payout_yen":payout,
                   "net_yen":payout-stake,"hit_races":sum(x[name]["hit"] for x in rows),
                   "winning_pair_covered_races":sum(x[name]["winning_pair_covered"] for x in rows),
                   "third_miss_races":sum(x[name]["third_miss"] for x in rows),
                   "new_ticket_points":sum(x[name]["new_ticket_points"] for x in rows),
                   "roi_percent":round(100*payout/stake,3) if stake else None}
    return out

def evaluate(root):
    root=Path(root)
    folder=root/"data/mrt_research/micro_forward"
    all_paths=sorted((folder/"snapshots").glob("*.json"))
    results=_result_map(root)
    rows=[];excluded=[]
    for path in all_paths:
        rid=path.stem
        result=results.get(rid)
        if result is None:
            excluded.append({"race_id":rid,"status":"result_not_final"})
            continue
        try:
            rows.append(_verified_forward_row(path,result))
        except (OSError,ValueError,KeyError,TypeError) as e:
            excluded.append({"race_id":rid,"status":"excluded","reason":str(e)})
    by_protocol=collections.defaultdict(list)
    for x in rows:by_protocol[x["protocol_id"]].append(x)
    comparisons={}
    for protocol,rs in sorted(by_protocol.items()):
        rs.sort(key=lambda x:x["race_id"])
        span=(dt.datetime.strptime(rs[-1]["date"],"%Y%m%d")-
              dt.datetime.strptime(rs[0]["date"],"%Y%m%d")).days+1
        breakdown={}
        for field in ("field_size","race_class","date"):
            breakdown[field]={str(v):_summary([r for r in rs if str(r[field])==str(v)])
                              for v in sorted({str(r[field]) for r in rs})}
        # Exclude the same *race* across every budget method, ranked on max actual payout.
        ordered=sorted(rs,key=lambda x:(-x["win_pay100_max"],x["race_id"]))
        outliers={str(i):_summary(ordered[i:]) for i in (1,3,5)}
        comparisons[protocol]={
            "evaluated_races":len(rs),"elapsed_calendar_days":span,
            "eligible_for_human_review":len(rs)>=POLICY["forward_review_min_races"] and
                span>=POLICY["forward_review_min_calendar_days"],
            "human_approval_still_required":True,"summary":_summary(rs),
            "breakdown":breakdown,
            "high_payout_exclusions":outliers,
            "high_payout_misses": [{
                "race_id":r["race_id"],"date":r["date"],"payout100":r["win_pay100_max"],
                "A_hit":bool(r["A_original"]["hit"]),"B_hit":bool(r["B_third"]["hit"]),
                "C_hit":bool(r["C_pair"]["hit"]),"D_hit":bool(r["D_hybrid"]["hit"]),
                "A_pair_covered":bool(r["A_original"]["winning_pair_covered"]),
                "D_pair_covered":bool(r["D_hybrid"]["winning_pair_covered"]),
                "A_third_miss":bool(r["A_original"]["third_miss"]),
                "D_third_miss":bool(r["D_hybrid"]["third_miss"]),
            } for r in rs if r["win_pay100_max"]>=10000],
        }
    return {"schema":"tk-mrt-micro-forward-score/v1",
            "created_at":utcnow().isoformat(),
            "no_backfill":True,"historical_replay":False,
            "first_valid_date":START_DATE,
            "protocols":comparisons,"excluded":excluded,
            "generated_frozen_count":len(all_paths),
            "evaluated_races":len(rows),
            "adoption":"human_decision_required","automatic_promotion":False,
            "no_real_time_odds":True}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root",default=str(Path(__file__).resolve().parents[1]))
    p.add_argument("--mode",choices=("freeze","evaluate","dry-run"),required=True)
    p.add_argument("--date",default=None,help="JST YYYY-MM-DD, only current date")
    p.add_argument("--output",default=None)
    args=p.parse_args()
    root=Path(args.root).resolve()
    today=utcnow().astimezone(JST).date().isoformat()
    if args.mode=="freeze":
        if args.date is not None and args.date!=today:
            p.error("freeze requires current JST race date")
        model=train(root)
        output=freeze_day(root,model,today)
    elif args.mode=="dry-run":
        model=train(root)
        output={"schema":"tk-mrt-micro-forward-preflight/v1","training":model["meta"],
                "frozen_predictions_written":0,"automatic_promotion":False}
    else:
        output=evaluate(root)
    encoded=json.dumps(output,ensure_ascii=False,indent=2,allow_nan=False)+"\n"
    if args.output:
        dest=Path(args.output).resolve()
        allow=(root/"data/mrt_research/micro_forward").resolve()
        if not dest.is_relative_to(allow):
            p.error("output must be within data/mrt_research/micro_forward")
        dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_text(encoded)
    else:
        print(encoded)

if __name__=="__main__":
    main()
