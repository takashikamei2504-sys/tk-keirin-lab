"""Read-only runtime gate plus explicit health report; no forecast/model changes."""
import argparse, datetime as dt, json, os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
JST=dt.timezone(dt.timedelta(hours=9))
STAGES=("publish","micro","fusion","results","shadow","micro_eval","compare")
def read(path):
    try:return json.loads(path.read_text(encoding="utf-8"))
    except (OSError,ValueError):return {}
def timestamp(value):
    try:
        t=dt.datetime.fromisoformat(value)
        return t if t.utcoffset() is not None else None
    except (ValueError,TypeError):return None
def inspect(root=ROOT,now=None):
    now=now or dt.datetime.now(dt.timezone.utc)
    day=now.astimezone(JST).date().isoformat()
    folder=root/"data/mrt"/day
    base=root/"data/mrt_research"
    index=read(folder/"index.json")
    micro=read(base/"micro_forward/freeze_status.json")
    fusion=read(base/"mirror_fusion/freeze_status.json")
    pin=read(base/"mirror_fusion/active_model.json")
    rows=index.get("races",[])
    saved=[r for r in rows if r.get("file") and Path(r["file"]).name==r["file"] and (folder/r["file"]).is_file()]
    open_rows=[r for r in saved if timestamp(r.get("sales_close_at")) and timestamp(r["sales_close_at"])>now]
    def count(directory,items):
        return sum((directory/(r["race_id"]+".json")).is_file() for r in items)
    md=base/"micro_forward/snapshots"
    model=pin.get("model_sha256","")
    fd=base/"mirror_fusion"/model if len(model)==64 and all(c in "0123456789abcdef" for c in model) else base/"mirror_fusion"/"_no_active_model"
    return {"date":day,"checked_at":now.isoformat(),"index_updated_at":index.get("checked_at"),
            "listed":len(rows),"mrt_saved":len(saved),"mrt_open":len(open_rows),
            "micro_saved":count(md,saved),"fusion_saved":count(fd,saved),
            "micro_open_missing":len(open_rows)-count(md,open_rows),
            "fusion_open_missing":len(open_rows)-count(fd,open_rows),
            "micro_updated_at":micro.get("at"),"micro_date":micro.get("date"),
            "fusion_updated_at":fusion.get("updated_at"),"fusion_date":fusion.get("date"),
            "collection_errors":sum(e.get("scope")=="collection" for e in index.get("errors",[])),
            "entry_errors":sum(e.get("scope")!="collection" for e in index.get("errors",[])),
            "micro_rejected":len(micro.get("rejected",[])),"fusion_rejected":len(fusion.get("rejected",[]))}
def fallback_needed(root=ROOT,now=None):
    now=now or dt.datetime.now(dt.timezone.utc)
    report=read(root/"data/mrt_research/runtime_status.json")
    h=inspect(root,now)
    t=timestamp(report.get("checked_at"))
    if report.get("date")!=h["date"] or not t:return True
    age=(now-t).total_seconds()/60
    if age<0 or age>=45:return True
    # Give a failed/partial attempt a short cooldown rather than triggering a storm.
    if age>=15 and (report.get("status")!="ok" or h["micro_open_missing"] or h["fusion_open_missing"]):return True
    return False
def should_run(trigger,watchdog_push=False,root=ROOT,now=None):
    return (trigger!="workflow_run" and not watchdog_push) or fallback_needed(root,now)
def report(root=ROOT,now=None):
    h=inspect(root,now)
    outcomes={k:os.environ.get("MRT_"+k.upper(),"missing") for k in STAGES}
    h["schema"]="tk-mrt-runtime/v1"
    h["trigger"]=os.environ.get("MRT_TRIGGER","unknown")
    h["stages"]=outcomes
    h["status"]="ok" if all(v=="success" for k,v in outcomes.items() if k!="shadow") and not h["collection_errors"] and not h["micro_open_missing"] and not h["fusion_open_missing"] and h["micro_date"]==h["date"]==h["fusion_date"] else "degraded"
    p=root/"data/mrt_research/runtime_status.json"
    p.parent.mkdir(parents=True,exist_ok=True)
    tmp=p.with_suffix(".tmp");tmp.write_text(json.dumps(h,ensure_ascii=False,indent=2),encoding="utf-8");tmp.replace(p)
    return h
if __name__=="__main__":
    ap=argparse.ArgumentParser();g=ap.add_mutually_exclusive_group(required=True)
    for mode in ("gate","report","check"):g.add_argument("--"+mode,action="store_true")
    a=ap.parse_args()
    if a.gate:
        run=should_run(os.environ.get("MRT_TRIGGER"),os.environ.get("MRT_WATCHDOG_PUSH","false").lower()=="true")
        print("Fallback gate: "+str(run).lower())
        with open(os.environ["GITHUB_OUTPUT"],"a") as f:f.write("run="+str(run).lower()+"\n")
    elif a.report:print(json.dumps(report(),ensure_ascii=False))
    else:
        h=read(ROOT/"data/mrt_research/runtime_status.json")
        print(json.dumps(h,ensure_ascii=False))
        if h.get("status")!="ok":raise SystemExit("Runtime degraded; completed outputs were preserved.")
