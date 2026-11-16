#!/usr/bin/env python3
"""Time-ordered no-bet gate audit on fixed 90-day 5,745R, research only.

Entire 90-day retrospective eight-engine output is required as source.
Gate features are category, stage, or meeting-day labels known independently of result.
Each test race is selected ONLY from results of the preceding 30 calendar days.
No gate logic is applied to main, Railway or live predictions.
"""
import argparse
import collections
import datetime as dt
import json
import pathlib
import random

WAYS = ("auto","physical","causal","lab_v5","line","roi_coverage","b_upset_ad","b_upset_expanded")
ROOT = pathlib.Path("reports/year-race-type")
START = dt.date(2026,8,18)
CORRECTIONS = {
 ("2026-08-22:松戸:3","lab_v5"):180,
 ("2026-08-22:松戸:3","line"):180,
 ("2026-08-22:松戸:3","roi_coverage"):180,
 ("2026-08-26:玉野:6","b_upset_ad"):1590,
}
POLICIES = {
 "meeting_day_trim1_80": ("meeting_day", 50, 0.80),
 "stage_trim1_70": ("stage", 55, 0.70),
 "category_trim1_80": ("category", 70, 0.80),
 "category_stage_trim1_80": ("category_stage", 45, 0.80),
}
def key(row,kind):
 return row["category"]+"|"+row["stage"] if kind=="category_stage" else row[kind]
def score(rows,engine="auto"):
 pred=[r["predictions"][engine] for r in rows]
 stake=sum(x["stake"] for x in pred)
 paid=sum(x["payout"] for x in pred)
 winners=sorted(pred,key=lambda x:x["payout"],reverse=True)
 cut=winners[5:]
 s5=sum(x["stake"] for x in cut)
 p5=sum(x["payout"] for x in cut)
 bal=peak=dd=0
 for x in pred:
  bal+=x["payout"]-x["stake"]
  peak=max(peak,bal)
  dd=max(dd,peak-bal)
 return {
  "races":len(rows),"hits":sum(x["payout"]>0 for x in pred),
  "stake_yen":stake,"payout_yen":paid,"net_yen":paid-stake,
  "roi_pct":round(100*paid/stake,2) if stake else None,
  "trim5_roi_pct":round(100*p5/s5,2) if s5 else None,
  "max_drawdown_yen":dd
 }
def trim1_roi(rows):
 if not rows:return 0
 pred=[r["predictions"]["auto"] for r in rows]
 largest=max(pred,key=lambda x:x["payout"])
 stake=sum(x["stake"] for x in pred)-largest["stake"]
 paid=sum(x["payout"] for x in pred)-largest["payout"]
 return paid/stake if stake else 0
def read_input(filename):
 data=json.loads(pathlib.Path(filename).read_text(encoding="utf-8"))
 rows=data["races"]
 if len(rows)!=5745 or data["start"]!="2026-08-18" or data["end"]!="2026-11-15" or data["days"]!=90:
  raise RuntimeError("90-day fixed-cohort identity changed")
 days=set()
 ids=set()
 for r in rows:
  if r["race_id"] in ids:raise RuntimeError("Duplicate race ID")
  ids.add(r["race_id"])
  days.add(r["date"])
  if any(k not in r["predictions"] for k in WAYS):raise RuntimeError("Missing engine")
  r["d"]=(dt.date.fromisoformat(r["date"])-START).days
  if not 0<=r["d"]<90:raise RuntimeError("Out-of-range date")
  for engine in WAYS:
   p=r["predictions"][engine]
   if p["stake"]!=100*p["points"] or p["stake"]<0 or (engine=="auto" and p["stake"]<100):raise RuntimeError("Invalid investment")
   diff=CORRECTIONS.get((r["race_id"],engine),0)
   if diff:
    p["payout"]+=diff
    p["net"]+=diff
    p["hit"]=p["payout"]>0
 if len(days)!=90:raise RuntimeError("Missing dates")
 return sorted(rows,key=lambda r:(r["date"],r["race_id"]))
def walk(rows,rolling=True):
 chosen={name:set() for name in POLICIES}
 decisions=[]
 for d in range(30,90,5):
  train=[r for r in rows if (d-30<=r["d"]<d)] if rolling else [r for r in rows if r["d"]<30]
  test=[r for r in rows if d<=r["d"]<d+5]
  for name,(field,min_n,threshold) in POLICIES.items():
   groups=collections.defaultdict(list)
   for r in train:groups[key(r,field)].append(r)
   qualified={k for k,g in groups.items() if len(g)>=min_n and trim1_roi(g)>=threshold}
   for r in test:
    if key(r,field) in qualified:chosen[name].add(r["race_id"])
   decisions.append({"train_start_day":d-30 if rolling else 0,
     "test_start_day":d,"policy":name,"qualified_group_count":len(qualified),
     "tested_races":len(test),"selected_races":sum(key(r,field) in qualified for r in test)})
 return chosen,decisions
def bootstrap(rows,selected_ids,seed=20261116,iterations=12000):
 blocks=[]
 for index in range(6,18):
  base=[r for r in rows if r["d"]//5==index]
  gate=[r for r in base if r["race_id"] in selected_ids]
  blocks.append((sum(r["predictions"]["auto"]["stake"] for r in base),
   sum(r["predictions"]["auto"]["payout"] for r in base),
   sum(r["predictions"]["auto"]["stake"] for r in gate),
   sum(r["predictions"]["auto"]["payout"] for r in gate)))
 rng=random.Random(seed)
 delta=[]
 for _ in range(iterations):
  bs=bp=gs=gp=0
  for _ in range(12):
   a,b,c,d=blocks[rng.randrange(len(blocks))]
   bs+=a;bp+=b;gs+=c;gp+=d
  if gs>0:delta.append(100*gp/gs-100*bp/bs)
 delta.sort()
 if not delta:return None
 return {
  "difference_pctpoints_95pct_interval":[round(delta[int(0.025*len(delta))],1),round(delta[int(0.975*len(delta))],1)],
  "bootstrap_fraction_gate_outperforms":round(sum(x>0 for x in delta)/len(delta),3),
  "resamples":len(delta),"cluster_size_days":5
 }
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--input",default=str(ROOT/"complete90-eight-engine-audit.json"))
 args=parser.parse_args()
 rows=read_input(args.input)
 test=[r for r in rows if r["d"]>=30]
 out={"schema":"tk-keirin-90day-rolling-30day-gates-oos-v1",
  "period":{"all":["2026-08-18","2026-11-15"],"train_initial_days":30,
   "heldout_from":"2026-09-17","heldout_through":"2026-11-15",
   "train_days_prior":30,"step_days":5},
  "full_90day":score(rows),
  "out_of_time_baseline":score(test),
  "policies":{},"fixed_train_30day":{},
  "method":"Gate threshold set against preceding 30 days' max-one-winner-removed AUTO ROI and minimum n. No test payout used in gate decision. Four candidate policy families are exploratory, not pre-registered prospective validation.",
  "limitations":[
   "Underlying current 2026-11 model retrospective replays, not frozen contemporaneous predictions.",
   "Source-provided lineups and payouts lack an independent race-by-race official timestamp audit.",
   "Multiple attempted policies; apparent top performer may be selection luck.",
   "Meeting day/round publication may differ from original pre-race source.",
   "Small selected sample and top-5 payout dependence preclude production promotion.",
   "Reduced total loss is not proof of alpha: abstaining from every race trivially avoids losses.",
   "661R strict-comment reconstructed subset has a different selection mechanism and MUST NOT be pooled."
  ]}
 for rolling,tag in [(True,"policies"),(False,"fixed_train_30day")]:
  selected,decisions=walk(rows,rolling)
  for name,ids in selected.items():
   matched=[r for r in test if r["race_id"] in ids]
   first=[r for r in matched if r["d"]<60]
   second=[r for r in matched if r["d"]>=60]
   record={"all_test":score(matched),"coverage_pct":round(100*len(matched)/len(test),1),
      "test_first_30days":score(first),"test_last_30days":score(second),
      "baseline_first_30days":score([r for r in test if r["d"]<60]),
      "baseline_last_30days":score([r for r in test if r["d"]>=60])}
   record["relative_roi_gap_pctpoints"]=round(record["all_test"]["roi_pct"]-out["out_of_time_baseline"]["roi_pct"],2) if matched else None
   if rolling:record["bootstrap"]=bootstrap(test,ids)
   out[tag][name]=record
  if rolling:out["decision_audit"]=decisions
 ROOT.mkdir(parents=True,exist_ok=True)
 jp=ROOT/"90day-walkforward-abstention-20261116.json"
 jp.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 md=["# 競輪LAB・90日全件5,745R：購入見送り条件の時系列外検証",
  "",
  "2026-08-18〜11-15、90日5,745R。最初の30日は学習のみ、後半60日3,748RでAUTO購入・見送りを比較。",
  "30日間の過去成績だけで条件判定、5日ごとに更新。各買い目100円。**本番変更なし**。",
  "",
  "## 後半60日の結果",
  "",
  "| ルール | 購入R | 購入率 | 回収率 | 最大的中5件除外 | AUTO全件との差（ポイント） | 差の5日ブロック95%区間 |",
  "|---|---:|---:|---:|---:|---:|---|"]
 baseline=out["out_of_time_baseline"]
 md.append("| AUTO全件 | "+str(baseline["races"])+" | 100% | "+str(baseline["roi_pct"])+"% | "+str(baseline["trim5_roi_pct"])+"% | 基準 | - |")
 label={"meeting_day_trim1_80":"開催日程：trim1≥80%","stage_trim1_70":"番組種別：trim1≥70%",
    "category_trim1_80":"級班：trim1≥80%","category_stage_trim1_80":"級班×番組：trim1≥80%"}
 for name,v in out["policies"].items():
  q=v["all_test"];interval=v["bootstrap"]["difference_pctpoints_95pct_interval"]
  md.append("| "+label[name]+" | "+str(q["races"])+" | "+str(v["coverage_pct"])+"% | "+str(q["roi_pct"])+"% | "+str(q["trim5_roi_pct"])+"% | "+str(v["relative_roi_gap_pctpoints"])+" | "+str(interval[0])+"〜"+str(interval[1])+" |")
 md.extend(["","## 観察された不安定性",
  "",
  "最も良く見えた開催日程の購入ゲートも、前半30日と後半30日の回収率はそれぞれ"+
   str(out["policies"]["meeting_day_trim1_80"]["test_first_30days"]["roi_pct"])+"%／"+
   str(out["policies"]["meeting_day_trim1_80"]["test_last_30days"]["roi_pct"])+"%。"+
   "同ゲートの高額上位5件を除くと"+
   str(out["policies"]["meeting_day_trim1_80"]["all_test"]["trim5_roi_pct"])+"%。",
  "",
  "固定の最初30日だけで選択を決める方式では、開催日程ゲートの後半30日は"+
   str(out["fixed_train_30day"]["meeting_day_trim1_80"]["test_last_30days"]["roi_pct"])+"%まで悪化。",
  "",
  "## 判断",
  "",
  "- 級班単独、級班×番組単独による単純な選別は時系列外でAUTOを下回った。",
  "- 開催日程ゲートの見かけの上昇は誤差範囲に留まり、高額払い戻し除外後は低調。採用保留。",
  "- 5日単位ブロック再標本化の区間は将来利益の保証ではない。",
  "- 複数候補を探索済みのため、今後の新規期間は完全に未使用の前向き検証として区別。",
  "- **これらは現行コードを2026年8〜11月に遡及適用した結果で、当時の発走前凍結予想ではない。**",
  "- 180日の追加661Rは選別されたコメント復元レースで母集団条件が異なり、ここには混合しない。",
  "",
  "出典：GitHub Actions 43796244008 の complete90-eight-engine-all-race-results、同着3Rの4払戻補正。"])
 (ROOT/"90day-walkforward-abstention-20261116-ja.md").write_text("\n".join(md)+"\n",encoding="utf-8")
 print("WALK_FORWARD_GATE_AUDIT",json.dumps({"baseline":baseline,
  "selected":{name:{"n":v["all_test"]["races"],"roi":v["all_test"]["roi_pct"],
    "trim5":v["all_test"]["trim5_roi_pct"],"CI":v["bootstrap"]["difference_pctpoints_95pct_interval"]}
      for name,v in out["policies"].items()}},ensure_ascii=False))
if __name__=="__main__":
 main()
