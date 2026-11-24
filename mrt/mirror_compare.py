"""Independent three-way, equal-budget paper comparison. No production writes."""
import argparse, collections as C, datetime as dt, hashlib,json,re
from pathlib import Path
import joblib
from .mirror_engine import ROOT,freeze,fingerprint,SCHEMA,train
from .research_data import digest,verify_snapshot

JST=dt.timezone(dt.timedelta(hours=9))
AREA="data/mrt_research/mirror_fusion"
METHODS=("MRT","MICRO","FUSION")
def now():return dt.datetime.now(dt.timezone.utc)
def read(p):return json.loads(p.read_text())
def write(p,x):
    p.parent.mkdir(parents=True,exist_ok=True)
    temp=p.with_suffix(".tmp")
    temp.write_text(json.dumps(x,ensure_ascii=False,allow_nan=False,separators=(",",":")))
    temp.replace(p)
def ts(x):
    t=dt.datetime.fromisoformat(x)
    if t.utcoffset() is None:raise ValueError("naive timestamp")
    return t
def sha(p):return hashlib.sha256(json.dumps(p,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
def roster(p):return {str(c):str(v) for c,v in p.items()}
def valid_tickets(t,rs):
    seen=set();total=0
    for x in t:
        k=tuple(x["cars"]);y=x["yen"]
        if len(k)!=3 or len(set(k))!=3 or not set(map(str,k))<=set(rs) or k in seen or type(y)!=int or y<100 or y%100:raise ValueError("invalid tickets")
        seen.add(k);total+=y
    if total!=10000:raise ValueError("unequal budget")
    return {"-".join(map(str,x["cars"])):x["yen"] for x in t}
def source(folder,row):
    rid=row["race_id"];name=row["file"]
    if not re.fullmatch(r"\d{12}-[0-9a-f]+\.json",name) or not name.startswith(rid+"-"):raise ValueError("snapshot filename")
    p=read(folder/name);verify_snapshot(p)
    if p["race_id"]!=rid or p["identity_sha256"]!=row["identity_sha256"]:raise ValueError("manifest identity")
    return p
def freeze_day(model_path):
    area=ROOT/AREA; model_path=Path(model_path)
    m=joblib.load(model_path);h=digest(model_path)
    pin=area/"active_model.json"
    info={"model_sha256":h,"source_sha256":fingerprint(),"training_through":m["training_through"],"train_races":m["train_races"]}
    if pin.exists() and read(pin)!=info:raise ValueError("fixed model mismatch; no silent replacement")
    if m["source_sha256"]!=info["source_sha256"]:raise ValueError("source mismatch")
    if not pin.exists():
        pin.parent.mkdir(parents=True,exist_ok=True)
        with pin.open("x") as f:json.dump(info,f)
    date=now().astimezone(JST).date().isoformat();folder=ROOT/"data/mrt"/date
    status={"date":date,"updated_at":now().isoformat(),"frozen":0,"already":0,"closed":0,"rejected":[]}
    if not (folder/"index.json").exists():
        status["rejected"].append({"reason":"MRT input index not yet available"})
    else:
        for row in read(folder/"index.json").get("races",[]):
            rid=row["race_id"]
            if not row.get("file"):continue
            try:
                p=source(folder,row)
                target=area/h/(rid+".json")
                if target.exists():status["already"]+=1;continue
                if now()>=ts(p["sales_close_at"]):status["closed"]+=1;continue
                freeze(m,p,model_path,target);status["frozen"]+=1
            except (ValueError,KeyError,TypeError,OSError) as e:status["rejected"].append({"race_id":rid,"reason":str(e)})
    write(area/"freeze_status.json",status)
    return status
def match(p,b,f):
    rid=p["race_id"];rs=roster({c:v["rider_id"] for c,v in p["input"]["entry"]["players"].items()})
    if b["schema"]!="tk-mrt-micro-forward/v1" or f["schema"]!=SCHEMA:raise ValueError("schema mismatch")
    if any(x["race_id"]!=rid or not x.get("pre_race") or not x.get("frozen") or roster(x["roster"])!=rs or x["identity_sha256"]!=p["identity_sha256"] for x in (b,f)):raise ValueError("identity mismatch")
    close=ts(p["sales_close_at"]);start=ts(p["start_at"]);original=ts(p["generated_at"])
    if not original<close<start:raise ValueError("source timing")
    for x,k in ((b,"original_generated_at"),(f,"source_generated_at")):
        if not original==ts(x[k])<=ts(x["generated_at"])<close or ts(x["sales_close_at"])!=close or ts(x["start_at"])!=start or x["source_sha256"]!=sha(p):raise ValueError("different source or late prediction")
    if b["model_sha256"]!=p["model_sha256"] or b["engine_sha256"]!=p["engine_sha256"] or f["source_model_sha256"]!=p["model_sha256"] or f["source_engine_sha256"]!=p["engine_sha256"]:raise ValueError("baseline version")
    a=p["automatic"]["tickets"];d=b["methods"]["D_hybrid"];z=f["tickets"]
    maps={k:valid_tickets(t,rs) for k,t in zip(METHODS,(a,d,z))}
    if maps["MRT"]!=valid_tickets(b["methods"]["A_original"],rs):raise ValueError("baseline tickets mismatch")
    return rs,maps
def score(m,pays):
    return sum(y*pays.get(k,0)//100 for k,y in m.items())
def settle(rs,result,rid):
    if not result or result.get("status")!="final":return None
    if result["race_id"]!=rid or roster(result["roster"])!=rs:raise ValueError("result roster mismatch")
    pays=result["payouts"]
    if not pays or any(not re.fullmatch(r"[1-9]-[1-9]-[1-9]",k) or len(set(k.split("-")))!=3 or not set(k.split("-"))<=set(rs) or type(v)!=int or v<=0 for k,v in pays.items()):raise ValueError("invalid final payouts")
    return pays
def teacher_map(ref,rs,rid):
    if not ref or not ref.get("result_crosspage_verified") or ref["race_id"]!=rid or ref.get("expert_id")!=634 or roster(ref["measured_result"]["roster"])!=rs:return None
    l=ref["labels"]
    if l.get("cancelled") or l.get("refund") or set(l["tickets"])!={"3連単"}:return None
    try:return valid_tickets(l["tickets"]["3連単"],rs)
    except ValueError:return None
def stats(rows):
    valid=[r for r in rows if r["status"]=="final"]
    out={}
    for m in METHODS:
        rr=[r["metrics"][m] for r in valid];t=[r["teacher_metrics"][m] for r in valid if r.get("teacher_metrics")]
        spend=10000*len(rr);pay=sum(x["pay"] for x in rr)
        out[m]={"races":len(rr),"stake":spend,"payout":pay,"net":pay-spend,"hits":sum(x["pay"]>0 for x in rr),"roi":100*pay/spend if spend else None,
            "mean_points":sum(x["points"] for x in rr)/len(rr) if rr else None,
            "teacher_races":len(t),"teacher_ticket_recall":sum(x["matched"] for x in t)/sum(x["teacher_points"] for x in t) if t else None,
            "teacher_stake_overlap":sum(x["overlap"] for x in t)/(10000*len(t)) if t else None}
    return out
def build(root=ROOT):
    root=Path(root);area=root/AREA;pin=read(area/"active_model.json") if (area/"active_model.json").exists() else None
    records={};teachers={}
    for p in (root/"data/mrt_teacher/records").glob("*.json"):
        try:
            r=read(p);teachers.setdefault(r["race_id"],[]).append(r)
        except (OSError,ValueError,KeyError):continue
    for fp in sorted(area.glob("[0-9a-f]*/[0-9]*.json")):
        try:
            f=read(fp)
            if fp.parent.name!=f["model_sha256"] or fp.stem!=f["race_id"]:continue
            records.setdefault(f["race_id"],[]).append(f)
        except (OSError,ValueError,KeyError):continue
    groups=C.defaultdict(list);days=[]
    first=min((r[:8] for r in records),default=now().astimezone(JST).strftime("%Y%m%d"))
    for ip in sorted((root/"data/mrt").glob("*/index.json")):
        date=ip.parent.name
        if date.replace("-","")<first:continue
        results={}
        rp=ip.parent/"results.json"
        if rp.exists():results={x["race_id"]:x for x in read(rp).get("results",[])}
        day=[]
        for row in read(ip).get("races",[]):
            rid=row["race_id"];r={"race_id":rid,"venue":row.get("venue_name",""),"race_no":row.get("race_no"),"start_at":row.get("start_at"),"status":"unpaired","available":{}}
            try:
                p=source(ip.parent,row);r["available"]["MRT"]=True
                mp=root/"data/mrt_research/micro_forward/snapshots"/(rid+".json")
                b=read(mp) if mp.exists() else None
                r["available"]["MICRO"]=bool(b)
                fs=records.get(rid,[]);r["available"]["FUSION"]=bool(fs)
                # Independently display only validated same-source records, even
                # while waiting for the other research engine. No unpaired ROI.
                f=next((x for x in fs if pin and x["model_sha256"]==pin["model_sha256"]),None)
                rs=roster({c:v["rider_id"] for c,v in p["input"]["entry"]["players"].items()})
                a=p["automatic"]["tickets"];valid_tickets(a,rs)
                r["preview_tickets"]={"MRT":a};r["preview_generated"]={"MRT":p["generated_at"]}
                for method,x,k,t in (
                    ("MICRO",b,"original_generated_at",b["methods"]["D_hybrid"] if b else None),
                    ("FUSION",f,"source_generated_at",f["tickets"] if f else None)):
                    if not x:continue
                    try:
                        if not x.get("pre_race") or not x.get("frozen") or x["race_id"]!=rid or x["identity_sha256"]!=p["identity_sha256"] or roster(x["roster"])!=rs or x["source_sha256"]!=sha(p):raise ValueError("source mismatch")
                        if not ts(x[k])==ts(p["generated_at"])<=ts(x["generated_at"])<ts(p["sales_close_at"]):raise ValueError("late or mismatched source")
                        valid_tickets(t,rs)
                        r["preview_tickets"][method]=t;r["preview_generated"][method]=x["generated_at"]
                    except (ValueError,KeyError,TypeError):continue
                if not b or not fs:raise ValueError("三方式未揃い")
                if not f:raise ValueError("固定モデル不一致")
                rs,maps=match(p,b,f)
                g=":".join((p["model_sha256"],p["engine_sha256"],b["protocol_id"],f["model_sha256"]))
                r.update(group=g,field_size=len(rs),race_class=b["race_class"],tickets={"MRT":p["automatic"]["tickets"],"MICRO":b["methods"]["D_hybrid"],"FUSION":f["tickets"]},
                         generated={"MRT":p["generated_at"],"MICRO":b["generated_at"],"FUSION":f["generated_at"]},status="pending")
                pays=settle(rs,results.get(rid),rid)
                if pays is not None:
                    r.update(status="final",payouts=pays,metrics={m:{"pay":score(t,pays),"points":len(t)} for m,t in maps.items()})
                    refs=teachers.get(rid,[])
                    if len(refs)==1:
                        tm=teacher_map(refs[0],rs,rid)
                        if tm is not None:
                            r["teacher_metrics"]={m:{"matched":len(set(t)&set(tm)),"teacher_points":len(tm),"overlap":sum(min(t[k],tm[k]) for k in set(t)&set(tm))} for m,t in maps.items()}
                r.pop("preview_tickets",None);r.pop("preview_generated",None)
                groups[g].append(r)
            except (ValueError,KeyError,TypeError,OSError) as e:
                r.update(status="excluded" if r.get("group") else "unpaired",reason=str(e))
            day.append(r)
        write(area/"days"/(date+".json"),{"date":date,"races":day});days.append(date)
    summary={}
    for g,rows in groups.items():
        final=[r for r in rows if r["status"]=="final"]
        dates=sorted({r["race_id"][:8] for r in final})
        span=(dt.datetime.strptime(dates[-1],"%Y%m%d")-dt.datetime.strptime(dates[0],"%Y%m%d")).days+1 if dates else 0
        ranked=sorted(final,key=lambda r:(-max(r["metrics"][m]["pay"] for m in METHODS),r["race_id"]))
        summary[g]={"paired":len(rows),"final":len(final),"days":span,"eligible_review":len(final)>=200 and span>=28,"summary":stats(rows),
                    "by_size":{str(n):stats([r for r in rows if r["field_size"]==n]) for n in (7,9)},
                    "exclude_top":{str(n):stats(ranked[n:]) for n in (1,3,5)}}
    out={"schema":"tk-mrt-three-way/v1","updated_at":now().isoformat(),"days":days,"groups":summary,"active_model":pin,"paper_only":True,"automatic_promotion":False}
    write(area/"comparison.json",out);return out
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--model");a=p.parse_args()
    if a.model:print(json.dumps(freeze_day(a.model),ensure_ascii=False))
    print(json.dumps(build(),ensure_ascii=False))
