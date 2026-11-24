"""MIRROR research stage 3: explicit tier quotas vs mixed score ranking.
Repeated historical dates, exploratory only. No production artifacts or live bets.
"""
import gzip,hashlib,json
from pathlib import Path
import numpy as np
from .mirror_benchmark import ROOT,CUT,VALID_END,SEED,normalize,clf,reg,prob,norm
from .mirror_hierarchy_benchmark import fit as fit_hierarchy,parts,complexity,limit,summarize
from .allocation_audit import allocate

BANDS=((100,300),(400,900),(1000,10000))

def band_labels(y):
    return [(y>=lo)&(y<=hi) for lo,hi in BANDS]

def quotas(raw,n):
    """Normalize predicted counts to common point count; ensure legal 100-unit budget."""
    n=limit(n,100)
    x=np.maximum(np.asarray(raw,dtype=float),0)
    if not x.sum():x=np.ones(3)
    x=x*n/x.sum()
    q=np.floor(x).astype(int)
    for i in sorted(range(3),key=lambda i:(-(x[i]-q[i]),i))[:n-int(q.sum())]:q[i]+=1
    lo=np.array([1,4,10]);hi=np.array([3,9,100])
    while q@lo>100:
        if q[2]:q[2]-=1;q[0]+=1
        elif q[1]:q[1]-=1;q[0]+=1
        else:raise ValueError("infeasible minimum")
    if q@hi<100:
        i=1 if q[1] else 0
        if not q[i]:raise ValueError("infeasible maximum")
        # Promote only when the predicted bands cannot fund the fixed budget.
        if q@lo-lo[i]+lo[2]<=100:q[i]-=1;q[2]+=1
        else:
            # Infeasible for some very large n: move mid tickets to low first.
            while q@lo-lo[i]+lo[2]>100 and q[1]:
                q[1]-=1;q[0]+=1;i=1 if q[1] else 0
            if q@lo-lo[i]+lo[2]>100:raise ValueError("band infeasible")
            q[i]-=1;q[2]+=1
    assert q.sum()==n and q@lo<=100<=q@hi
    return q

def select_quota(scores,q):
    tags={}
    for tier in (2,1,0):
        order=np.argsort(-scores[tier],kind="stable")
        available=[int(i) for i in order if int(i) not in tags]
        if q[tier]>len(available):raise ValueError("insufficient candidates")
        for i in available[:q[tier]]:tags[i]=tier
    return tags

def bounded_amounts(weights,tags):
    """Project positive weights into fixed bands, exactly 10k in 100 yen units."""
    w=np.asarray(weights,dtype=float); w=np.maximum(w,1e-9)
    lo=np.array([BANDS[t][0]//100 for t in tags])
    hi=np.array([BANDS[t][1]//100 for t in tags])
    if not lo.sum()<=100<=hi.sum():raise ValueError("infeasible budget")
    a,b=0.,float(100/w.min())
    for _ in range(70):
        c=(a+b)/2
        if np.clip(c*w,lo,hi).sum()<100:a=c
        else:b=c
    real=np.clip(b*w,lo,hi)
    out=np.floor(real+1e-10).astype(int)
    remain=100-int(out.sum())
    for i in sorted(range(len(w)),key=lambda i:(-(real[i]-out[i]),i)):
        if remain and out[i]<hi[i]:out[i]+=1;remain-=1
    assert remain==0 and out.sum()==100 and np.all(out>=lo) and np.all(out<=hi)
    return out*100

def fit(rows):
    m=fit_hierarchy(rows)
    rng=np.random.default_rng(SEED)
    X=[];Y=[]
    for r in rows:
        y=r["target"];p=np.flatnonzero(y>0);z=np.flatnonzero(y==0)
        take=np.r_[p,rng.choice(z,min(len(z),4*len(p)),replace=False)]
        X.append(r["tri"][take]);Y.append(y[take])
    X=np.concatenate(X);Y=np.concatenate(Y)
    m["tiers"]=[clf(X,b) for b in band_labels(Y)]
    m["tier_counts"]={}
    for n in (7,9):
        g=[r for r in rows if r["n"]==n]
        a=np.asarray([complexity(r) for r in g])
        m["tier_counts"][n]=[reg(a,np.array([band_labels(r["target"])[k].sum() for r in g])) for k in range(3)]
    return m

def check(r,pred):
    y=r["target"];pos=y>0;bought=pred>0
    ps,inv,fy,py,px=parts(r);p=r["paths"]
    v={"hit_tickets":int((bought&pos).sum()),"teacher_n":int(pos.sum()),"pred_n":int(bought.sum()),
       "overlap":float(np.minimum(pred,y).sum()/10000),"main_n":int((y>=1000).sum()),"main_hit":int((bought&(y>=1000)).sum()),
       "micro_n":int((pos&(y<=300)).sum()),"micro_hit":int((bought&pos&(y<=300)).sum()),
       "count_error":abs(int(bought.sum())-int(pos.sum())),
       "first_error":abs(len(set(p[bought,0]))-int(fy.sum())),
       "pair_error":abs(len(set(inv[bought]))-int(py.sum()))}
    yb,pb=band_labels(y),band_labels(pred)
    v["tier_exact_matches"]=[int((a&b).sum()) for a,b in zip(yb,pb)]
    v["teacher_tier_counts"]=[int(a.sum()) for a in yb]
    v["pred_tier_counts"]=[int(a.sum()) for a in pb]
    if r["actual"]:
        pay=r["actual"]["pays"]
        v["pay"]=int(sum(int(pred[i])*pay.get(k,0)//100 for i,k in enumerate(r["keys"])))
        v["teacher_pay"]=r["actual"]["census"]["pay"]
        v["market_pay100"]=max(pay.values())
    assert pred.sum()==10000
    return v

def evaluate(rows,m):
    out=[]
    for r in rows:
        p=r["paths"];y=r["target"];n=r["n"]
        _,inv,_,_,px=parts(r)
        h=norm(prob(m["first"],r["eye"])[p[:,0]]*prob(m["pair"],px)[inv]*prob(m["third"],r["tri"]))
        d=norm(prob(m["direct"],r["tri"]))
        tier=[norm(prob(k,r["tri"])) for k in m["tiers"]]
        mixed=norm(.5*d+.25*tier[0]+.25*tier[2])
        cap=np.exp(np.clip(m["capital"].predict(r["tri"]),np.log(100),np.log(10000)))
        x=complexity(r)
        # Common total count for every variant, equal to previous benchmark basic count.
        count=limit(m["counts"][n]["basic"].predict([r["race"]])[0],min(100,len(y)))
        q=quotas([k.predict([x])[0] for k in m["tier_counts"][n]],count)
        variants={}
        def emit(name,ids,amounts=None):
            ids=list(map(int,ids))
            if amounts is None:
                a=allocate([{"cars":list(r["keys"][i])} for i in ids],10000,list(map(float,cap[ids])))
                amounts=[t["yen"] for t in a]
            pred=np.zeros(len(y),dtype=np.int32);pred[ids]=amounts
            variants[name]=check(r,pred)
        emit("mixed_baseline",np.argsort(-mixed,kind="stable")[:count])
        emit("hier_baseline",np.argsort(-h,kind="stable")[:count])
        for name,scores in [("quota_direct",tier),("quota_hier",[norm(a*h) for a in tier])]:
            tags=select_quota(scores,q);ids=list(tags)
            emit(name+"_capital",ids)
            emit(name+"_bounded",ids,bounded_amounts(cap[ids],list(tags.values())))
        out.append({"race_id":r["id"],"date":r["date"],"size":n,"variants":variants})
    return out

def report(rows):
    x=summarize(rows)
    for k,v in x.items():
        rs=[r["variants"][k] for r in rows]
        a=np.sum([r["tier_exact_matches"] for r in rs],axis=0)
        b=np.sum([r["teacher_tier_counts"] for r in rs],axis=0)
        v["exact_tier_recall_percent"]=[float(100*i/j) if j else None for i,j in zip(a,b)]
        v["mean_pred_tier_counts"]=np.mean([r["pred_tier_counts"] for r in rs],axis=0).tolist()
        paid=[r for r in rs if "pay" in r]
        high=[r for r in paid if r["market_pay100"]>=10000]
        v["high_payout_hits"]=sum(r["pay"]>0 for r in high);v["high_payout_races"]=len(high)
        p=sorted([r["pay"] for r in paid],reverse=True)
        v["roi_exclude_own_top5_paid_races"]=sum(p[5:])/max(1,100*len(p[5:]))
    return x

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
    tr=[r for r in rows if r["date"]<=CUT]
    va=[r for r in rows if CUT<r["date"]<=VALID_END]
    te=[r for r in rows if VALID_END<r["date"]]
    mod=fit(tr);vr=evaluate(va,mod);tt=evaluate(te,mod)
    v,t=report(vr),report(tt)
    return {"schema":"mrt-mirror-tier-quota/v1","retrospective_only":True,"previously_examined_dates":True,
            "automatic_promotion":False,"train":len(tr),"validation_n":len(va),"test_n":len(te),
            "validation_choice_by_overlap":max(v,key=lambda k:v[k]["overlap_percent"]),
            "validation":v,"test":t,"by_size":{str(n):report([r for r in tt if r["size"]==n]) for n in (7,9)},
            "validation_rows":vr,"test_rows":tt}

if __name__=="__main__":
    r=run()
    Path("mirror-tier-quota-report.json").write_text(json.dumps(r,ensure_ascii=False,indent=2,allow_nan=False))
    print("TIERQUOTA="+json.dumps({k:v for k,v in r.items() if not k.endswith("_rows") and k!="by_size"},ensure_ascii=False,separators=(",",":")))
