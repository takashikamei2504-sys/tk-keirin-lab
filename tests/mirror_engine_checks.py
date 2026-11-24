"""Smoke and parity checks for the independent MIRROR engine."""
import argparse,copy,gzip,json,tempfile
from pathlib import Path
import joblib,numpy as np
from mrt.mirror_engine import ROOT,CUT,features,infer,from_snapshot,freeze,feasible_quotas,SCHEMA
from mrt.mirror_benchmark import normalize
from mrt.mirror_tier_quota_benchmark import BANDS,evaluate
from mrt.research_data import INPUT_KEYS

def run(model_path):
    model=joblib.load(model_path)
    raw=json.loads(gzip.decompress((ROOT/"mrt/research_seed.json.gz").read_bytes()))
    cases=[]
    for n in (7,9):
        for r in raw:
            if r["date"]<=CUT or len(r["roster"])!=n:continue
            q=normalize(r)
            if q is None or not INPUT_KEYS<=r.keys():continue
            x={k:r[k] for k in INPUT_KEYS}
            try:f=features(x)
            except (KeyError,TypeError,ValueError):continue
            for k in ("race","riders","tri","paths"):
                np.testing.assert_array_equal(f[k],q[k])
            a=infer(model,x);b=infer(model,x)
            assert a==b and a["schema"]==SCHEMA
            assert sum(t["yen"] for t in a["tickets"])==10000
            assert a["points"]==len(a["tickets"])
            assert len({tuple(t["cars"]) for t in a["tickets"]})==a["points"]
            assert sum(a["tier_counts"].values())==a["points"]
            # Exact parity with research benchmark's fused, bounded variant.
            ref=evaluate([q],model["heads"])[0]["variants"]["quota_hier_bounded"]
            pred={tuple(t["cars"]):t["yen"] for t in a["tickets"]}
            yy=np.array([pred.get(k,0) for k in q["keys"]])
            assert np.isclose(np.minimum(yy,q["target"]).sum()/10000,ref["overlap"])
            assert [int(((yy>=lo)&(yy<=hi)).sum()) for lo,hi in BANDS]==ref["pred_tier_counts"]
            bad=copy.deepcopy(x);bad["labels"]={"finish":{}}
            try:infer(model,bad)
            except ValueError:pass
            else:raise AssertionError("accepted labels")
            cases.append(a)
            if sum(c["field_size"]==n for c in cases)>=3:break
    assert len(cases)==6, "missing historical parity cases"
    for n in range(1,101):
        for raw_count in ([0,0,0],[100,0,0],[0,0,100],[0,100,0],[3,5,2]):
            q=feasible_quotas(raw_count,n)
            assert sum(q)==n and np.dot(q,[1,4,10])<=100<=np.dot(q,[3,9,100])
    # Use an actual frozen pre-race input; prediction output is a replay,
    # never written to the forward ledger by this test.
    live=[]
    for p in sorted((ROOT/"data/mrt").glob("*/*-*.json"),reverse=True):
        try:
            s=json.loads(p.read_text())
            if not s.get("pre_race"):continue
            a=from_snapshot(model,s)
            if any(x["field_size"]==a["field_size"] for x in live):continue
            live.append(a)
            try:
                freeze(model,s,model_path,Path("/tmp/should-not-write.json"),clock=lambda:__import__("datetime").datetime.fromisoformat(s["sales_close_at"]))
            except ValueError:pass
            else:raise AssertionError("accepted after cutoff")
            if len(live)==2:break
        except (KeyError,ValueError,TypeError):continue
    assert live,"no eligible saved snapshot"
    return {"historical_parity_cases":len(cases),"snapshot_replay_cases":len(live),"quota_edge_cases":500,
            "model_train_races":model["train_races"],"paper_only":True,
            "sample_replays":[dict(x,pre_race=False,historical_replay=True) for x in live]}
if __name__=="__main__":
    ap=argparse.ArgumentParser();ap.add_argument("--model",required=True);a=ap.parse_args()
    r=run(a.model)
    Path("mirror-engine-checks.json").write_text(json.dumps(r,ensure_ascii=False,indent=2))
    print("MIRROR_ENGINE_CHECKS="+json.dumps({k:v for k,v in r.items() if k!="sample_replays"},ensure_ascii=False))
