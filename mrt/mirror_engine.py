"""MRT MIRROR FUSION V1: standalone, paper-only teacher imitation.
Fixed hierarchy * tier selection, tier counts, bounded amount allocation.
Training cutoff deliberately matches the research benchmark; no production
model changes, no odds, no actual wagers, no automatic adoption.
"""
import argparse
import collections as C
import datetime as dt
import gzip,hashlib,itertools,json,math,os,re
from pathlib import Path
import joblib,numpy as np
from .mirror_benchmark import ROOT,CUT,FIELDS,finite,normalize,prob,norm
from .mirror_hierarchy_benchmark import complexity,limit
from .mirror_tier_quota_benchmark import fit,BANDS,select_quota,bounded_amounts
from .research_data import INPUT_KEYS,verify_snapshot,digest

SCHEMA="tk-mrt-mirror-fusion/v1"
TIER_NAMES=("micro","counter","main")
POLICY={"architecture":"quota_hier_bounded","training_through":CUT,
        "budget_yen":10000,"paper_only":True,"no_odds":True,
        "automatic_promotion":False,"pre_start_historical_source_verified":False,
        "review_min_races":200,"review_min_calendar_days":28}
SOURCE_FILES=("mirror_engine.py","mirror_benchmark.py","mirror_hierarchy_benchmark.py","mirror_tier_quota_benchmark.py")
def fingerprint():
    return hashlib.sha256(b"".join((ROOT/"mrt"/f).read_bytes() for f in SOURCE_FILES)+json.dumps(POLICY,sort_keys=True).encode()).hexdigest()

def features(r):
    """Strict input-only extractor; no teacher, outcome or odds accepted."""
    if set(r)!=INPUT_KEYS:raise ValueError("Unexpected or missing input keys")
    cars=sorted(map(int,r["roster"]))
    rid=r["race_id"]
    if not re.fullmatch(r"\d{12}",rid) or r["date"]!=rid[:8] or int(r["venue"])!=int(rid[8:10]) or int(r["race_no"])!=int(rid[-2:]):raise ValueError("race identity")
    entry=r["entry"]; players=entry["players"]
    if len(cars) not in (7,9) or len(set(cars))!=len(cars) or "ガールズ" in str(entry.get("race_class")):raise ValueError("eligible men 7/9 only")
    if set(players)!=set(map(str,cars)):raise ValueError("player roster mismatch")
    if not all(finite(players[str(c)].get("score"))>0 for c in cars):raise ValueError("missing scores")
    ids=[str(players[str(c)].get("rider_id") or "") for c in cars]
    if not all(ids) or len(set(ids))!=len(ids):raise ValueError("rider identity mismatch")
    lines=[list(map(int,l)) for l in r["lines"] if l]
    flat=[c for l in lines for c in l]
    if len(flat)!=len(set(flat)) or not set(flat)<=set(cars):raise ValueError("line membership")
    if set(map(int,r["unknown_cars"]))!=set(cars)-set(flat):raise ValueError("unknown line membership")
    loc={c:(i,p,len(l)) for i,l in enumerate(lines) for p,c in enumerate(l)}
    n=len(cars); raw=np.array([[finite(players[str(c)].get(k)) for k in FIELDS] for c in cars],dtype=np.float32)
    relative=(raw-raw.mean(0))/np.maximum(raw.std(0),1)
    idx={c:i for i,c in enumerate(cars)}
    race=np.array([n,len(lines),sum(len(l)==1 for l in lines),max(map(len,lines),default=0),
                   float(raw[:,0].std()),float(raw[:,3].max()),int(r["venue"]),int(r["race_no"])],dtype=np.float32)
    riders=[]
    for c in cars:
        i,p,l=loc.get(c,(-1,-1,0)); leader=lines[i][0] if i>=0 else c
        others=[raw[idx[l2[0]],3] for j,l2 in enumerate(lines) if j!=i]
        riders.append(np.r_[raw[idx[c]],relative[idx[c]],p,l,p==0,p==1,l==1,p<0,
                      raw[idx[leader],0]-raw[idx[c],0],raw[idx[leader],3],
                      raw[idx[leader],3]-max(others,default=0)])
    riders=np.asarray(riders,dtype=np.float32)
    # Canonical score-rank correspondence: never transfer raw car numbers between races.
    canon=sorted(cars,key=lambda c:(-raw[idx[c],0],loc.get(c,(-1,-1,0))[1],c))
    order=[idx[c] for c in canon]
    structure=np.array([int(loc.get(a,(-1,))[0]>=0 and loc.get(a,(-1,))[0]==loc.get(b,(-2,))[0])
                        for a,b in itertools.combinations(canon,2)])
    memory=np.r_[race[:6],riders[order,12:].ravel(),structure]
    paths=np.array(list(itertools.permutations(range(n),3)),dtype=np.int16)
    keys=[tuple(cars[i] for i in p) for p in paths]
    rel=[]
    for a,b in ((0,1),(0,2),(1,2)):
        rel.append([int(loc.get(k[a],(-1,))[0]>=0 and loc.get(k[a],(-1,))[0]==loc.get(k[b],(-2,))[0]) for k in keys])
    tri=np.c_[np.tile(race,(len(paths),1)),riders[paths[:,0]],riders[paths[:,1]],riders[paths[:,2]],np.asarray(rel).T].astype(np.float32)
    return dict(id=rid,date=r["date"],n=n,cars=cars,canon=canon,race=race,riders=riders,
                eye=np.c_[np.tile(race,(n,1)),riders],memory=memory,paths=paths,keys=keys,tri=tri)

def pair_features(r):
    p=r["paths"];pairs,inv=np.unique(p[:,:2],axis=0,return_inverse=True);inv=inv.reshape(-1)
    _,ix=np.unique(inv,return_index=True)
    x=np.c_[np.tile(r["race"],(len(pairs),1)),r["riders"][pairs[:,0]],r["riders"][pairs[:,1]],r["tri"][ix,-3]].astype(np.float32)
    return pairs,inv,x

def feasible_quotas(raw,n):
    """Same largest-remainder quotas as benchmark, with exhaustive legal fallback."""
    n=int(n)
    if not 1<=n<=100:raise ValueError("invalid count")
    x=np.maximum(np.asarray(raw,dtype=float),0)
    if len(x)!=3 or not np.all(np.isfinite(x)):raise ValueError("invalid tier count")
    if not x.sum():x=np.ones(3)
    target=x*n/x.sum()
    # Match benchmark quota rule whenever feasible; fallback protects unusual counts.
    from .mirror_tier_quota_benchmark import quotas
    try:return quotas(raw,n)
    except (AssertionError,ValueError):
        candidates=[]
        for hi in range(min(10,n)+1):
            for mid in range(n-hi+1):
                low=n-hi-mid
                if low+4*mid+10*hi<=100<=3*low+9*mid+100*hi:
                    q=np.array([low,mid,hi]);candidates.append((float(np.sum((q-target)**2)),tuple(q)))
        if not candidates:raise ValueError("no feasible quotas")
        return np.array(min(candidates)[1],dtype=int)

def train(output):
    manifest=json.loads((ROOT/"mrt/research_seed_manifest.json").read_text())
    blob=(ROOT/"mrt/research_seed.json.gz").read_bytes()
    if hashlib.sha256(blob).hexdigest()!=manifest["sha256"]:raise ValueError("seed checksum")
    raw=json.loads(gzip.decompress(blob));assert len(raw)==manifest["records"]
    rows=[];seen=set()
    for r in sorted(raw,key=lambda x:(x["date"],x["race_id"])):
        if r["date"]>CUT or r["race_id"] in seen:continue
        q=normalize(r)
        if q is not None:rows.append(q);seen.add(q["id"])
    if len(rows)<100:raise ValueError("training records insufficient")
    # All fit heads in this function use teacher targets only. Outcomes in
    # normalize() are not used by fit(). No validation/test data is fitted.
    m=fit(rows)
    model={"schema":SCHEMA,"policy":POLICY,"source_sha256":fingerprint(),
           "seed_sha256":manifest["sha256"],"training_through":CUT,
           "train_races":len(rows),"heads":m}
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    if output.exists():raise FileExistsError("refuse model overwrite")
    joblib.dump(model,output,compress=3)
    info={k:v for k,v in model.items() if k!="heads"}
    info["model_sha256"]=digest(output)
    output.with_suffix(".manifest.json").write_text(json.dumps(info,ensure_ascii=False,indent=2))
    return info

def infer(model,entry):
    if model.get("schema")!=SCHEMA or model.get("policy")!=POLICY or model.get("source_sha256")!=fingerprint():raise ValueError("model/schema/source mismatch")
    if entry["date"]<=model["training_through"]:raise ValueError("training overlap")
    r=features(entry);m=model["heads"];p=r["paths"];n=r["n"]
    _,inv,px=pair_features(r)
    first=prob(m["first"],r["eye"]);pair=prob(m["pair"],px);third=prob(m["third"],r["tri"])
    h=norm(first[p[:,0]]*pair[inv]*third)
    tier=[norm(prob(k,r["tri"])) for k in m["tiers"]]
    scores=[norm(a*h) for a in tier]
    count=limit(m["counts"][n]["basic"].predict([r["race"]])[0],min(100,len(p)))
    x=complexity(r)
    raw_counts=[float(k.predict([x])[0]) for k in m["tier_counts"][n]]
    q=feasible_quotas(raw_counts,count)
    tags=select_quota(scores,q);indices=list(tags)
    cap=np.exp(np.clip(m["capital"].predict(r["tri"]),np.log(100),np.log(10000)))
    amounts=bounded_amounts(cap[indices],list(tags.values()))
    tickets=[]
    for i,y in zip(indices,amounts):
        b=tags[i];tickets.append({"cars":list(r["keys"][i]),"yen":int(y),
            "tier":TIER_NAMES[b],"hierarchy_score":float(h[i]),"tier_score":float(tier[b][i]),
            "joint_selection_score":float(scores[b][i])})
    assert len(tickets)==count and len({tuple(t["cars"]) for t in tickets})==count
    assert sum(t["yen"] for t in tickets)==10000
    for t in tickets:
        b=TIER_NAMES.index(t["tier"]);assert BANDS[b][0]<=t["yen"]<=BANDS[b][1] and t["yen"]%100==0
    tickets.sort(key=lambda t:(-t["yen"],-t["joint_selection_score"],t["cars"]))
    first_yen=C.Counter();pair_yen=C.Counter()
    for t in tickets:first_yen[t["cars"][0]]+=t["yen"];pair_yen[tuple(t["cars"][:2])]+=t["yen"]
    return {"schema":SCHEMA,"race_id":r["id"],"date":r["date"],"field_size":n,
            "model_training_through":model["training_through"],"model_source_sha256":model["source_sha256"],
            "raw_predicted_tier_counts":dict(zip(TIER_NAMES,raw_counts)),
            "tier_counts":dict(zip(TIER_NAMES,map(int,q))),"points":count,"budget_yen":10000,
            "first_allocations":[{"car":c,"yen":v} for c,v in first_yen.most_common()],
            "pair_allocations":[{"cars":list(k),"yen":v} for k,v in pair_yen.most_common()],
            "tickets":tickets,"paper_only":True,"calibrated_probability":False,"automatic_promotion":False}

def from_snapshot(model,snapshot):
    entry=verify_snapshot(snapshot)
    return infer(model,entry)

def freeze(model,snapshot,model_path,target,clock=None):
    """Only genuinely pre-close research freezes, never historical backfill."""
    now=clock or (lambda:dt.datetime.now(dt.timezone.utc))
    close=dt.datetime.fromisoformat(snapshot["sales_close_at"])
    if now()>=close:raise ValueError("sales closed; historical replay only")
    result=from_snapshot(model,snapshot);generated=now()
    if generated>=close:raise ValueError("completed after close")
    if generated<dt.datetime.fromisoformat(snapshot["generated_at"]):raise ValueError("source from future")
    result.update(pre_race=True,frozen=True,generated_at=generated.isoformat(),
                  source_generated_at=snapshot["generated_at"],sales_close_at=snapshot["sales_close_at"],
                  start_at=snapshot["start_at"],identity_sha256=snapshot["identity_sha256"],
                  roster={c:v["rider_id"] for c,v in snapshot["input"]["entry"]["players"].items()},
                  model_sha256=digest(model_path))
    target=Path(target)
    expected=ROOT/"data/mrt_research/mirror_fusion"/result["model_sha256"]/ (result["race_id"]+".json")
    if target.resolve()!=expected.resolve():raise ValueError("only isolated model-specific research path permitted")
    target.parent.mkdir(parents=True,exist_ok=True)
    with target.open("x",encoding="utf-8") as f:json.dump(result,f,ensure_ascii=False,indent=2,allow_nan=False)
    return result

if __name__=="__main__":
    ap=argparse.ArgumentParser(description=__doc__)
    sub=ap.add_subparsers(dest="cmd",required=True)
    t=sub.add_parser("train");t.add_argument("--model",required=True)
    for command in ("predict","freeze"):
        p=sub.add_parser(command);p.add_argument("--model",required=True);p.add_argument("--snapshot",required=True)
        if command=="freeze":p.add_argument("--output",required=True)
    a=ap.parse_args()
    if a.cmd=="train":out=train(a.model)
    else:
        m=joblib.load(a.model);s=json.loads(Path(a.snapshot).read_text())
        if a.cmd=="freeze":out=freeze(m,s,a.model,a.output)
        else:
            out=from_snapshot(m,s)
            out.update(pre_race=False,frozen=False,historical_replay=True,model_sha256=digest(a.model))
    print(json.dumps(out,ensure_ascii=False,indent=2,allow_nan=False))
