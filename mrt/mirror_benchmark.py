"""MIRROR fixed retrospective benchmark. Research-only; no serving exports.
Dates: train <=20260630; validation Jul-Sep; test Oct-Nov 21.
Teacher actions, amounts and outcomes are targets exclusively. Historical
entry-card provenance is retrospective, so no certified forward claims.
"""
import collections as C
import gzip, hashlib, itertools, json, math
from pathlib import Path
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier as HGC, HistGradientBoostingRegressor as HGR
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler
from .teacher_result_census import record, summary
from .research_data import v3, payout
from .allocation_audit import allocate

ROOT=Path(__file__).resolve().parents[1]
CUT="20260630"
VALID_END="20260930"
SEED=634
FIELDS=("score","S","H","B","nige","makuri","sashi","mark","win_rate","top2_rate","top3_rate","age")
def finite(v):
    try:
        f=float(v);return f if math.isfinite(f) else 0.
    except (TypeError,ValueError):return 0.

def normalize(r):
    lab=r["labels"]; cars=sorted(map(int,r["roster"]))
    entry=r.get("entry") or {}; players=entry.get("players") or {}
    if len(cars) not in (7,9) or len(set(cars))!=len(cars) or "ガールズ" in str(entry.get("race_class")):return
    if lab.get("refund") or lab.get("cancelled") or set(lab.get("tickets",{}))!={"3連単"}:return
    if not all(str(c) in players and finite(players[str(c)].get("score"))>0 for c in cars):return
    lines=[list(map(int,l)) for l in r.get("lines",[]) if l]
    flat=[c for l in lines for c in l]
    if len(flat)!=len(set(flat)) or not set(flat)<=set(cars):return
    t=C.Counter()
    for x in lab["tickets"]["3連単"]:
        k=tuple(map(int,x["cars"])); y=int(x["yen"])
        if len(k)!=3 or len(set(k))!=3 or not set(k)<=set(cars) or y<100 or y%100:return
        t[k]+=y
    if not t or sum(t.values())!=10000:return
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
    target=np.array([t[k] for k in keys],dtype=np.int32)
    rel=[]
    for a,b in ((0,1),(0,2),(1,2)):
        rel.append([int(loc.get(k[a],(-1,))[0]>=0 and loc.get(k[a],(-1,))[0]==loc.get(k[b],(-2,))[0]) for k in keys])
    tri=np.c_[np.tile(race,(len(paths),1)),riders[paths[:,0]],riders[paths[:,1]],riders[paths[:,2]],np.asarray(rel).T].astype(np.float32)
    fav=lab.get("honmei")
    try:fav=int(fav)
    except (TypeError,ValueError):fav=None
    events=lab.get("source_actor_events") or lab.get("events") or []
    acts={int(e["actor"]) for e in events if e.get("actor") is not None and e.get("action") in ("先行","カマシ","突っ張り") and not e.get("conditional") and not e.get("negated")}
    acts &= set(cars)
    actual=None
    # Outcomes usable only after strict separate accounting validation.
    try:
        c=record(r); w=v3.winners(lab)
        pays={k:payout({"cars":list(k),"yen":100},"3連単",lab) for k in set(w)}
        actual={"pays":pays,"back":set(map(int,lab.get("back") or [])),"census":c}
    except (ValueError,TypeError,KeyError,AttributeError):pass
    return dict(id=r["race_id"],date=r["date"],n=n,cars=cars,canon=canon,race=race,riders=riders,
                eye=np.c_[np.tile(race,(n,1)),riders],memory=memory,paths=paths,keys=keys,
                target=target,tri=tri,fav=fav,acts=acts,actual=actual)

def clf(X,y):
    return HGC(max_iter=55,max_leaf_nodes=15,min_samples_leaf=80,learning_rate=.09,l2_regularization=2,random_state=SEED).fit(X,y)
def reg(X,y):
    return HGR(max_iter=55,max_leaf_nodes=15,min_samples_leaf=80,learning_rate=.09,l2_regularization=2,random_state=SEED).fit(X,y)
def prob(m,x):return m.predict_proba(x)[:,1]
def norm(v):
    v=np.maximum(v,1e-8);return v/v.sum()
def model_fit(train):
    f=[r for r in train if r["fav"] in r["cars"]]
    b=[r for r in train if len(r["acts"])==1]
    a=[r for r in train if r["actual"]]
    ab=[r for r in a if len(r["actual"]["back"])==1]
    cat=lambda rs:np.concatenate([r["eye"] for r in rs])
    eye=clf(cat(f),np.concatenate([[c==r["fav"] for c in r["cars"]] for r in f]))
    tactics=clf(cat(b),np.concatenate([[c in r["acts"] for c in r["cars"]] for r in b]))
    actualB=clf(cat(ab),np.concatenate([[c in r["actual"]["back"] for c in r["cars"]] for r in ab]))
    reality=clf(cat(a),np.concatenate([[any(k[0]==c for k in r["actual"]["pays"]) for c in r["cars"]] for r in a]))
    # All positives + deterministic negative subsample, fixed seed. Used for ranking, not calibrated probability.
    rng=np.random.default_rng(SEED)
    X=[];Y=[];capitalX=[];capitalY=[]
    for r in train:
        pos=np.flatnonzero(r["target"]>0); neg=np.flatnonzero(r["target"]==0)
        sel=np.r_[pos,rng.choice(neg,min(4*len(pos),len(neg)),replace=False)]
        X.append(r["tri"][sel]);Y.append(r["target"][sel])
        capitalX.append(r["tri"][pos]);capitalY.append(np.log(r["target"][pos]))
    X=np.concatenate(X);Y=np.concatenate(Y)
    select=clf(X,Y>0)
    micro=clf(X,(Y>0)&(Y<=300))
    main=clf(X,Y>=1000)
    capital=reg(np.concatenate(capitalX),np.concatenate(capitalY))
    count={n:reg(np.array([r["race"] for r in train if r["n"]==n]),np.array([np.count_nonzero(r["target"]) for r in train if r["n"]==n])) for n in (7,9)}
    memory={}
    for n in (7,9):
        group=[r for r in train if r["n"]==n]
        scaler=StandardScaler().fit([r["memory"] for r in group])
        nn=NearestNeighbors(n_neighbors=min(24,len(group))).fit(scaler.transform([r["memory"] for r in group]))
        memory[n]=(group,scaler,nn)
    return locals() | {"training_counts":{"eye":len(f),"tactics":len(b),"actual_B":len(ab),"reality":len(a),"ticket_train_rows":len(Y)}}

def neighbor(r,m):
    g,sc,nn=m["memory"][r["n"]]
    distances,ix=nn.kneighbors(sc.transform([r["memory"]]))
    ranks={c:i for i,c in enumerate(r["canon"])}
    votes=C.Counter()
    for d,i in zip(distances[0],ix[0]):
        q=g[i]; cr={c:j for j,c in enumerate(q["canon"])}
        for k,v in zip(q["keys"],q["target"]):
            if v:votes[tuple(cr[c] for c in k)]+=float(v)/(1+float(d))
    return norm(np.array([votes[tuple(ranks[c] for c in k)] for k in r["keys"]]))

def evaluate(rs,m):
    output=[]; eye_rows=[];b_rows=[];reality_rows=[]
    for r in rs:
        y=r["target"]; positive=y>0; n=r["n"]
        ep=norm(prob(m["eye"],r["eye"])); tp=norm(prob(m["tactics"],r["eye"]))
        bp=norm(prob(m["actualB"],r["eye"])); rp=norm(prob(m["reality"],r["eye"]))
        if r["fav"] in r["cars"]:
            f=r["cars"].index(r["fav"]);eye_rows.append({"correct":int(ep.argmax()==f),"score_correct":int(r["riders"][:,0].argmax()==f)})
        if len(r["acts"])==1:
            c=next(iter(r["acts"]));b_rows.append({"imitated":int(r["cars"][tp.argmax()]==c),"max_B_count_imitated":int(r["cars"][r["riders"][:,3].argmax()]==c),"actual_model_imitated":int(r["cars"][bp.argmax()]==c)})
        actual=r["actual"]
        if actual:
            ws={k[0] for k in actual["pays"]};actual_b=actual["back"]
            reality_rows.append({"actual_win_teacher_eye":int(r["cars"][ep.argmax()] in ws),"actual_win_model":int(r["cars"][rp.argmax()] in ws),
                    "actual_win_score":int(r["cars"][r["riders"][:,0].argmax()] in ws),"actual_B_known":bool(actual_b),
                    "actual_B_tactics":int(r["cars"][tp.argmax()] in actual_b),"actual_B_model":int(r["cars"][bp.argmax()] in actual_b)})
        ps=norm(prob(m["select"],r["tri"])); pm=norm(prob(m["micro"],r["tri"])); ph=norm(prob(m["main"],r["tri"]))
        kn=neighbor(r,m); cap=np.exp(np.clip(m["capital"].predict(r["tri"]),math.log(100),math.log(10000)))
        count=max(1,min(100,int(round(float(m["count"][n].predict([r["race"]])[0])))))
        # Fixed candidate variants; no test-based tuning. No candidate uses current teacher labels.
        eyeweight=ep[r["paths"][:,0]]
        tacticsweight=tp[r["paths"][:,0]] # exploratory first-rider sensitivity, not causal B transition
        scores={"SELECT_direct":ps,"MEMORY_knn":kn,"EYE_SELECT":norm(ps*eyeweight),
                "TACTICS_SELECT_probe":norm(ps*(.5+tacticsweight)),
                "SELECT_tiers":norm(.5*ps+.25*pm+.25*ph),"ENSEMBLE":norm(.75*ps+.25*kn)}
        variants={}
        for name,s in scores.items():
            ids=np.argsort(-s,kind="stable")[:count]
            for wname,weights in [("equal",np.ones(len(ids))),("CAPITAL",cap[ids])]:
                # Compare equal vs learned allocation on identical predicted support.
                tickets=[{"cars":list(r["keys"][i]),"yen":100} for i in ids]
                alloc=allocate(tickets,10000,list(map(float,weights)))
                pred=np.zeros(len(y),dtype=np.int32);pred[ids]=[t["yen"] for t in alloc]
                chosen=pred>0;hit=chosen&positive
                key=name+"_"+wname
                out={"matched":int(hit.sum()),"target_n":int(positive.sum()),"pred_n":int(chosen.sum()),
                     "overlap":float(np.minimum(y,pred).sum()/10000),"main_match":int((chosen&(y>=1000)).sum()),"main_n":int((y>=1000).sum()),
                     "micro_match":int((chosen&(y>0)&(y<=300)).sum()),"micro_n":int(((y>0)&(y<=300)).sum()),
                     "count_error":abs(count-int(positive.sum()))}
                if actual:
                    pay=sum(int(pred[i])*actual["pays"].get(k,0)//100 for i,k in enumerate(r["keys"]))
                    out.update(pay=pay,actual_hit=int(pay>0),teacher_pay=actual["census"]["pay"])
                variants[key]=out
        output.append({"id":r["id"],"n":n,"date":r["date"],"variants":variants})
    def metrics(rows):
        ans={}
        for name in rows[0]["variants"] if rows else []:
            q=[r["variants"][name] for r in rows]; real=[x for x in q if "pay" in x]
            ratio=lambda k,d:sum(x[k] for x in q)/max(1,sum(x[d] for x in q))
            ans[name]={"races":len(q),"ticket_recall":ratio("matched","target_n"),"precision":ratio("matched","pred_n"),
                       "stake_overlap":float(np.mean([x["overlap"] for x in q])),"main_recall":ratio("main_match","main_n"),"micro_recall":ratio("micro_match","micro_n"),
                       "count_mae":float(np.mean([x["count_error"] for x in q])),"result_races":len(real),
                       "roi_percent":sum(x["pay"] for x in real)/max(1,len(real)*100),"actual_hit_rate":sum(x["actual_hit"] for x in real)/max(1,len(real)),
                       "teacher_roi_same_subset":sum(x["teacher_pay"] for x in real)/max(1,len(real)*100)}
        return ans
    def means(rows):
        return {"n":len(rows),**{k:float(np.mean([r[k] for r in rows])) for k in rows[0]} } if rows else {"n":0}
    bb=[r for r in reality_rows if r["actual_B_known"]]
    return {"n":len(rs),"eye":means(eye_rows),"tactics":means(b_rows),
            "reality":means(reality_rows),"actual_B":means(bb),"models":metrics(output),
            "by_size":{str(n):metrics([r for r in output if r["n"]==n]) for n in (7,9)}}

def run():
    manifest=json.loads((ROOT/"mrt/research_seed_manifest.json").read_text())
    blob=(ROOT/"mrt/research_seed.json.gz").read_bytes()
    if hashlib.sha256(blob).hexdigest()!=manifest["sha256"]:raise ValueError("seed hash")
    raw=json.loads(gzip.decompress(blob)); assert len(raw)==manifest["records"]
    rows=[];rejected=0;seen=set()
    for r in sorted(raw,key=lambda x:(x["date"],x["race_id"])):
        if r["race_id"] in seen:rejected+=1;continue
        q=normalize(r)
        if q is None:rejected+=1;continue
        seen.add(q["id"]);rows.append(q)
    train=[r for r in rows if r["date"]<=CUT]
    valid=[r for r in rows if CUT<r["date"]<=VALID_END]
    test=[r for r in rows if VALID_END<r["date"]]
    print("SPLIT",len(train),len(valid),len(test),flush=True)
    m=model_fit(train)
    return {"schema":"mrt-mirror-benchmark/v1","raw":len(raw),"excluded":rejected,
            "cutoffs":[CUT,VALID_END],"train_races":len(train),"training_counts":m["training_counts"],
            "historical_entry_asof_unverified":True,"no_model_export":True,
            "validation":evaluate(valid,m),"test":evaluate(test,m)}
if __name__=="__main__":
    report=run()
    Path("mirror-benchmark.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print("MIRROR="+json.dumps({**report,"validation":{k:v for k,v in report["validation"].items() if k!="by_size"},"test":{k:v for k,v in report["test"].items() if k!="by_size"}},ensure_ascii=False,separators=(",",":")))
