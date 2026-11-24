"""Research-only imitation audit, separate from actual-outcome accuracy.

Compare the existing frozen V3 output and the teacher-only sequence head
embedded in the original model (if available). No new prediction files,
production changes, odds, or automatic promotion. The manual B choices,
teacher-known count/weights, and actual-B variants are diagnostic oracles only.
"""
import argparse
import collections
import json
import itertools
from pathlib import Path

import numpy as np
import joblib
from .allocation_audit import validated_snapshot, accounting, allocate
from .research_data import v3, verify_snapshot, input_only, ROOT, MODEL, digest

def ticket_map(ts):
    out=collections.Counter()
    for t in ts:
        out[tuple(t["cars"])]+=int(t["yen"])
    return out

def metrics(target,pred):
    t,p=ticket_map(target),ticket_map(pred)
    common=set(t)&set(p)
    total=sum(t.values())
    high={k for k,v in t.items() if v>=1000}
    low={k for k,v in t.items() if v<=300}
    first=lambda m:collections.Counter({c:sum(v for k,v in m.items() if k[0]==c) for c in {k[0] for k in m}})
    pair=lambda m:collections.Counter({c:sum(v for k,v in m.items() if k[:2]==c) for c in {k[:2] for k in m}})
    def tv(a,b):
        return sum(min(a.get(k,0),b.get(k,0)) for k in set(a)|set(b))/total
    return {
        "teacher_points":len(t),"predicted_points":len(p),
        "matched":len(common),"union":len(set(t)|set(p)),
        "teacher_stake_covered":sum(t[k] for k in common)/total,
        "stake_overlap":tv(t,p),
        "first_stake_overlap":tv(first(t),first(p)),
        "pair_stake_overlap":tv(pair(t),pair(p)),
        "main_total":len(high),"main_matched":len(high&set(p)),
        "micro_total":len(low),"micro_matched":len(low&set(p)),
        "top_first_agrees":first(t).most_common(1)[0][0]==first(p).most_common(1)[0][0],
        "count_error":abs(len(t)-len(p)),
    }

def choose(paths,scores,n):
    order=sorted(range(len(paths)),key=lambda i:(-float(scores[i]),paths[i]))
    chosen=order[:max(1,min(int(n),100,len(order)))]
    weights=[max(float(scores[i]),1e-12) for i in chosen]
    ts=[{"cars":list(paths[i]),"weight":w} for i,w in zip(chosen,weights)]
    return allocate(ts,10000,weights)

def pure_sequence(model,r,features,with_actions=True):
    """Force trifecta family, independent of actual-result heads and B.
    The sequence heads were trained on teacher allocation, not actual finish.
    Zero actions is a sensitivity probe, not a separately trained ablation.
    """
    v2=v3.v2; base=model["base"]
    rf,rv=features;cars=sorted(rv)
    rx=np.asarray([rf+rv[c] for c in cars],dtype=np.float32)
    acts=v2.action_scores(base["actions"],rx) if with_actions else np.zeros((len(cars),len(v2.ACTION_NAMES)))
    act={c:acts[i].tolist() for i,c in enumerate(cars)}
    kind="3連単"
    firsts=[(c,) for c in cars];pairs=list(itertools.permutations(cars,2));triples=list(itertools.permutations(cars,3))
    def norm(paths,head):
        vals=np.maximum(base["sequence"][head].predict(v2.seq_features(r,rf,rv,paths,kind,act)),1e-9)
        sums=collections.Counter()
        for path,x in zip(paths,vals):sums[path[:-1]]+=float(x)
        return {path:float(x)/sums[path[:-1]] for path,x in zip(paths,vals)}
    a,b,c=norm(firsts,0),norm(pairs,1),norm(triples,2)
    score=np.array([a[t[:1]]*b[t[:2]]*c[t] for t in triples])
    return triples,score

def summarize(rows):
    if not rows:return {"races":0}
    out={"races":len(rows)}
    for k in ("teacher_stake_covered","stake_overlap","first_stake_overlap","pair_stake_overlap","top_first_agrees","count_error"):
        out[k]=sum(x[k] for x in rows)/len(rows)
    for name,num,den in [("ticket_recall","matched","teacher_points"),("ticket_precision","matched","predicted_points"),("jaccard","matched","union"),("main_recall","main_matched","main_total"),("micro_recall","micro_matched","micro_total")]:
        n=sum(x[den] for x in rows);out[name]=sum(x[num] for x in rows)/n if n else None
    return out

def run(root):
    root=Path(root)
    modelpath=root/"mrt/models/v3.joblib"
    model=joblib.load(modelpath)
    has_seq=all(k in model.get("base",{}) for k in ("sequence","actions"))
    result_cache={}
    rows=[];excluded=[]
    for path in sorted((root/"data/mrt_teacher/records").glob("*.json")):
        try:
            ref=json.loads(path.read_text())
            rid=ref["race_id"];day=rid[:4]+"-"+rid[4:6]+"-"+rid[6:8]
            if ref.get("expert_id")!=634 or not ref.get("result_crosspage_verified"):raise ValueError("unverified teacher")
            if rid[:8]<=model["history_through"]:raise ValueError("training overlap")
            if set(ref["labels"]["tickets"])!={"3連単"} or ref["labels"].get("cancelled") or ref["labels"].get("refund"):raise ValueError("unsupported teacher bet")
            target=ref["labels"]["tickets"]["3連単"]
            if sum(t["yen"] for t in target)!=10000:raise ValueError("teacher stake")
            snap=(root/ref["pre_race_snapshot"]).resolve()
            if not snap.is_relative_to((root/"data/mrt").resolve()):raise ValueError("snapshot path")
            p=json.loads(snap.read_text())
            if p["model_sha256"]!=digest(modelpath):raise ValueError("model identity")
            if day not in result_cache:
                result_cache[day]={x["race_id"]:x for x in json.loads((root/"data/mrt"/day/"results.json").read_text())["results"] if x["status"]=="final"}
            result=result_cache[day].get(rid)
            if not result:raise ValueError("unverified result")
            original=validated_snapshot(p,result,rid)
            if result["roster"]!=ref["measured_result"]["roster"]:raise ValueError("teacher roster")
            if accounting(target,result["payouts"])!=ref["labels"]["teacher_payout"]:raise ValueError("teacher payout mismatch")
            entry=verify_snapshot(p)
            r=input_only(entry)
            r["history_keys"]={str(c):v["rider_id"] for c,v in r["entry"]["players"].items()}
            r["lines"]=sorted(r["lines"],key=lambda x:tuple(x))
            features=v3.enrich(r,v3.v2.features_for(r,model["history"]))
            variants={"V3_frozen":original}
            # Oracle diagnoses only; not candidate algorithms.
            manual=[q["tickets"] for modes in p["manual"].values() for q in modes.values()]
            variants["oracle_best_saved_B"]=max([original]+manual,key=lambda ts:metrics(target,ts)["stake_overlap"])
            # Reweighting the identical V3 support to teacher amounts is another oracle:
            # it measures support ceiling, not a usable allocation.
            support=set(ticket_map(original)); target_map=ticket_map(target)
            support_coverage=sum(target_map.get(k,0) for k in support)/10000
            if has_seq:
                triples,scores=pure_sequence(model,r,features)
                _,zero=pure_sequence(model,r,features,False)
                n=len(original)
                variants["teacher_sequence_same_count"]=choose(triples,scores,n)
                variants["teacher_sequence_zero_action_probe"]=choose(triples,zero,n)
                # Teacher count is never known at prediction time; only a diagnostic.
                variants["oracle_teacher_count_sequence"]=choose(triples,scores,len(target))
                v3_paths,v3_scores,*_=v3.probabilities(model,r,features)
                vm=dict(zip(v3_paths,v3_scores))
                vs=np.array([vm[t] for t in triples])
                for w in (0.5,):
                    variants["blend_teacher_sequence_v3_50"]=choose(triples,w*scores+(1-w)*vs,n)
            rows.append({"race_id":rid,"date":day,"field_size":len(r["roster"]),
                "support_ceiling":support_coverage,
                "metrics":{k:metrics(target,v) for k,v in variants.items()}})
        except (KeyError,ValueError,TypeError,OSError,AttributeError) as e:
            excluded.append({"file":path.name,"reason":str(e)})
    names=sorted({k for row in rows for k in row["metrics"]})
    return {"schema":"tk-mrt-imitation-ablation/v1",
        "purpose":"teacher imitation, not an outcome prediction or profitable-bet claim",
        "model_sha256":digest(modelpath),"embedded_teacher_sequence_available":has_seq,
        "teacher_reference_collected_postrace":True,"exploratory_not_prospective":True,
        "oracle_methods_not_deployable":True,"automatic_promotion":False,
        "metrics":{k:summarize([r["metrics"][k] for r in rows if k in r["metrics"]]) for k in names},
        "by_field_size":{str(n):{k:summarize([r["metrics"][k] for r in rows if r["field_size"]==n and k in r["metrics"]]) for k in names} for n in (7,9)},
        "rows":rows,"excluded":excluded}

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root",default=str(ROOT))
    args=parser.parse_args()
    print(json.dumps(run(Path(args.root)),ensure_ascii=False,indent=2))
