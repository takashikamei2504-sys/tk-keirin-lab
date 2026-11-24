"""MIRROR stage 2: teacher support hierarchy and structural count ablation.
Exploratory chronological replay, NOT a fresh independent test. No serving.
The previously examined dates are deliberately not claimed as unseen.
"""
import collections as C
import gzip, hashlib, json
import numpy as np
from pathlib import Path
from .mirror_benchmark import ROOT, CUT, VALID_END, SEED, normalize, clf, reg, prob, norm
from .allocation_audit import allocate

def parts(r):
    p=r["paths"]; n=r["n"]; y=r["target"]; selected=y>0
    pairs, inverse=np.unique(p[:,:2],axis=0,return_inverse=True)
    inverse=inverse.reshape(-1)
    first_y=np.zeros(n,dtype=bool); first_y[p[selected,0]]=True
    pair_y=np.zeros(len(pairs),dtype=bool);pair_y[inverse[selected]]=True
    # Direct pair features use only first/second entry stats and their relation.
    _, first_index=np.unique(inverse,return_index=True)
    pair_x=np.c_[np.tile(r["race"],(len(pairs),1)),r["riders"][pairs[:,0]],r["riders"][pairs[:,1]],r["tri"][first_index,-3]]
    return pairs,inverse,first_y,pair_y,pair_x.astype(np.float32)

def complexity(r):
    v=r["riders"]
    # symmetric field-level features; no labels, payout, or current teacher information
    return np.r_[r["race"],v.min(0),v.max(0),v.std(0),np.sort(v[:,0])[-1]-np.sort(v[:,0])[-2]].astype(np.float32)

def fit(rows):
    rng=np.random.default_rng(SEED)
    firstX=[];firstY=[];pairX=[];pairY=[];thirdX=[];thirdY=[]
    directX=[];directY=[];capitalX=[];capitalY=[]
    for r in rows:
        ps,inv,fy,py,px=parts(r)
        y=r["target"];pos=np.flatnonzero(y>0);neg=np.flatnonzero(y==0)
        take=np.r_[pos,rng.choice(neg,min(4*len(pos),len(neg)),replace=False)]
        firstX.append(r["eye"]);firstY.append(fy)
        use=fy[ps[:,0]];pairX.append(px[use]);pairY.append(py[use])
        use=py[inv];thirdX.append(r["tri"][use]);thirdY.append(y[use]>0)
        directX.append(r["tri"][take]);directY.append(y[take]>0)
        capitalX.append(r["tri"][pos]);capitalY.append(np.log(y[pos]))
    cat=np.concatenate
    first=clf(cat(firstX),cat(firstY)); pair=clf(cat(pairX),cat(pairY)); third=clf(cat(thirdX),cat(thirdY))
    direct=clf(cat(directX),cat(directY));capital=reg(cat(capitalX),cat(capitalY))
    counts={}
    for n in (7,9):
        g=[r for r in rows if r["n"]==n]
        counts[n]={
            "basic":reg(np.array([r["race"] for r in g]),np.array([np.count_nonzero(r["target"]) for r in g])),
            "complex":reg(np.array([complexity(r) for r in g]),np.array([np.count_nonzero(r["target"]) for r in g])),
            "first":reg(np.array([complexity(r) for r in g]),np.array([parts(r)[2].sum() for r in g])),
            "pair":reg(np.array([complexity(r) for r in g]),np.array([parts(r)[3].sum() for r in g]))
        }
    return {"first":first,"pair":pair,"third":third,"direct":direct,"capital":capital,"counts":counts}

def limit(v,n):
    return max(1,min(n,int(round(float(v)))))

def constrained(r,score,fs,ps,n):
    order=np.argsort(-score,kind="stable")
    firsts=set();pairs=set();out=[]
    for i in order:
        a,b,c=map(int,r["paths"][i])
        if a not in firsts and len(firsts)>=fs:continue
        if (a,b) not in pairs and len(pairs)>=ps:continue
        firsts.add(a);pairs.add((a,b));out.append(int(i))
        if len(out)==n:break
    # Do not silently relax structure to hit count. Compare realized counts.
    return np.asarray(out,dtype=int)

def evaluate(rows,m):
    result=[]
    for r in rows:
        ps,inv,fy,py,px=parts(r)
        y=r["target"]; pos=y>0;n=r["n"];p=r["paths"]
        first=prob(m["first"],r["eye"])
        pair=prob(m["pair"],px)
        third=prob(m["third"],r["tri"])
        h=norm(first[p[:,0]]*pair[inv]*third)
        d=norm(prob(m["direct"],r["tri"]))
        cap=np.exp(np.clip(m["capital"].predict(r["tri"]),np.log(100),np.log(10000)))
        counts=m["counts"][n];x=complexity(r)
        nb=limit(counts["basic"].predict([r["race"]])[0],100)
        nc=limit(counts["complex"].predict([x])[0],100)
        f=limit(counts["first"].predict([x])[0],n)
        q=limit(counts["pair"].predict([x])[0],n*(n-1))
        paths={
            "direct_basic":np.argsort(-d,kind="stable")[:nb],
            "hier_basic":np.argsort(-h,kind="stable")[:nb],
            "hier_complex":np.argsort(-h,kind="stable")[:nc],
            "hier_structure":constrained(r,h,f,q,nc),
        }
        variants={}
        for name,ids in paths.items():
            for suffix,w in (("equal",np.ones(len(ids))),("capital",cap[ids])):
                ts=[{"cars":list(r["keys"][i]),"yen":100} for i in ids]
                a=allocate(ts,10000,list(map(float,w)))
                pred=np.zeros(len(y),dtype=np.int32);pred[ids]=[t["yen"] for t in a]
                bought=pred>0
                v={"hit_tickets":int((bought&pos).sum()),"teacher_n":int(pos.sum()),"pred_n":int(bought.sum()),
                   "overlap":float(np.minimum(pred,y).sum()/10000),"main_n":int((y>=1000).sum()),"main_hit":int((bought&(y>=1000)).sum()),
                   "micro_n":int((pos&(y<=300)).sum()),"micro_hit":int((bought&pos&(y<=300)).sum()),
                   "count_error":abs(int(bought.sum())-int(pos.sum())),
                   "first_error":abs(len(set(p[bought,0]))-int(fy.sum())),
                   "pair_error":abs(len(set(inv[bought]))-int(py.sum()))}
                if r["actual"]:
                    pay=r["actual"]["pays"]
                    v["pay"]=int(sum(int(pred[i])*pay.get(k,0)//100 for i,k in enumerate(r["keys"])))
                    v["teacher_pay"]=r["actual"]["census"]["pay"]
                    v["market_pay100"]=max(pay.values())
                variants[name+"_"+suffix]=v
        result.append({"race_id":r["id"],"date":r["date"],"size":n,"variants":variants})
    return result

def summarize(rows):
    out={}
    if not rows:return out
    for name in rows[0]["variants"]:
        rs=[r["variants"][name] for r in rows]
        actual=[r for r in rs if "pay" in r]
        pct=lambda a,b:100*sum(r[a] for r in rs)/max(1,sum(r[b] for r in rs))
        roi=lambda a:sum(r["pay"] for r in a)/max(1,100*len(a))
        # Remove common actual high-payout races, not variant-specific winners.
        sorted_actual=sorted(actual,key=lambda r:-r["market_pay100"])
        out[name]={"races":len(rs),"result_races":len(actual),"recall_percent":pct("hit_tickets","teacher_n"),
            "precision_percent":pct("hit_tickets","pred_n"),"overlap_percent":100*float(np.mean([r["overlap"] for r in rs])),
            "main_recall_percent":pct("main_hit","main_n"),"micro_recall_percent":pct("micro_hit","micro_n"),
            "count_mae":float(np.mean([r["count_error"] for r in rs])),
            "first_count_mae":float(np.mean([r["first_error"] for r in rs])),"pair_count_mae":float(np.mean([r["pair_error"] for r in rs])),
            "roi_percent":roi(actual),"teacher_roi_percent":sum(r["teacher_pay"] for r in actual)/max(1,100*len(actual)),
            "hit_rate_percent":100*sum(r["pay"]>0 for r in actual)/max(1,len(actual)),
            "roi_exclude_highest_market_payout_races":{str(k):roi(sorted_actual[k:]) for k in (1,3,5)}}
    return out

def run():
    m=json.loads((ROOT/"mrt/research_seed_manifest.json").read_text())
    blob=(ROOT/"mrt/research_seed.json.gz").read_bytes()
    assert hashlib.sha256(blob).hexdigest()==m["sha256"]
    raw=json.loads(gzip.decompress(blob));assert len(raw)==m["records"]
    rows=[];seen=set()
    for r in sorted(raw,key=lambda x:(x["date"],x["race_id"])):
        if r["race_id"] in seen:continue
        q=normalize(r)
        if q is not None:rows.append(q);seen.add(q["id"])
    train=[r for r in rows if r["date"]<=CUT]
    valid=[r for r in rows if CUT<r["date"]<=VALID_END]
    test=[r for r in rows if VALID_END<r["date"]]
    models=fit(train)
    vr=evaluate(valid,models);tr=evaluate(test,models)
    # Fixed review criterion: highest VALID stake-overlap; TEST is diagnostic, not used to choose.
    v=summarize(vr);t=summarize(tr)
    best=max(v,key=lambda k:v[k]["overlap_percent"])
    return {"schema":"mrt-mirror-hierarchy/v1","train_races":len(train),"validation_races":len(valid),"test_races":len(test),
            "historical_asof_unverified":True,"previously_examined_dates":True,"automatic_promotion":False,
            "validation_selected_by_overlap":best,"validation":v,"test":t,
            "validation_by_size":{str(n):summarize([r for r in vr if r["size"]==n]) for n in (7,9)},
            "test_by_size":{str(n):summarize([r for r in tr if r["size"]==n]) for n in (7,9)},
            "validation_rows":vr,"test_rows":tr}

if __name__=="__main__":
    r=run()
    Path("mirror-hierarchy-report.json").write_text(json.dumps(r,ensure_ascii=False,indent=2,allow_nan=False))
    print("HIERARCHY="+json.dumps({k:v for k,v in r.items() if not k.endswith("_rows") and not k.endswith("_by_size")},ensure_ascii=False,separators=(",",":")))
