#!/usr/bin/env python3
"""Aggregate 5745 outcome-blind B-axis-head rational + whimsical third-place runs."""
import collections,datetime as dt,json,pathlib,random
R=pathlib.Path("reports/year-race-type")
allrows=[];seen=set();expected_sha="4588ec938a2fec9e81216d3fd3423329805aa3d5"
for shard in range(18):
 f=json.loads((R/"fun-lite-shards"/f"part-{shard}.json").read_text())
 if f["schema"]!="tk-keirin-fun-third-score-and-b-head-replay/v1" or f["shard"]!=shard or f["source_sha"]!=expected_sha or f["failures"] or f["expected"]!=f["completed"]:
  raise RuntimeError(f"Shard invalid {shard}: {f.get('failures')}")
 for row in f["rows"]:
  if row["id"] in seen:raise ValueError("Repeated race")
  seen.add(row["id"])
  row["offset"]=(dt.date.fromisoformat(row["date"])-dt.date(2026,8,18)).days
  if not 0<=row["offset"]<90:raise ValueError("Date outside 90day")
  for depth in ("1","2"):
   d=row["depth"][depth]
   if d["base"]["s"]!=100*int(depth):raise ValueError("Base ticket count")
   for kind,p in d["extra"].items():
    if p["s"]!=p["n"]*100 or p["n"]>int(depth) or p["p"]<0:raise ValueError("Added tickets invalid")
   if d["extra"]["matched6"]["s"]!=d["extra"]["matched_random6"]["s"]:
    raise ValueError("Matched controls are not cost equal")
  allrows.append(row)
if len(allrows)!=5745 or len(seen)!=5745:raise ValueError("Incomplete 90day")
allrows.sort(key=lambda x:(x["date"],x["id"]))
NAMES=[*(f"digit_{n}" for n in range(1,10)),"date_digit","random","lowest_score","outside_line","matched6","matched_random6"]
def money(rows):
 stake=sum(x["s"] for x in rows);paid=sum(x["p"] for x in rows)
 order=sorted(rows,key=lambda x:x["p"],reverse=True)
 def trim(n):
  rest=order[n:];s=sum(x["s"] for x in rest)
  return round(100*sum(x["p"] for x in rest)/s,2) if s else None
 return {"races":len(rows),"tickets":sum(x["n"] for x in rows),
         "purchased_races":sum(x["n"]>0 for x in rows),
         "hits":sum(x["p"]>0 for x in rows),
         "stake":stake,"payout":paid,"net":paid-stake,
         "roi_pct":round(100*paid/stake,2) if stake else None,
         "trim1_pct":trim(1),"trim5_pct":trim(5),
         "top1":order[0]["p"] if order else 0,
         "hit50plus":sum(x["p"]>=5000 for x in rows)}
def calc(rows,depth,kind):
 base=[r["depth"][depth]["base"] for r in rows]
 extra=[r["depth"][depth]["extra"][kind] for r in rows]
 together=[{"s":b["s"]+e["s"],"p":b["p"]+e["p"],"n":b["n"]+e["n"]}
           for b,e in zip(base,extra)]
 return {"base":money(base),"extra":money(extra),"combined":money(together),
         "rescued_base_miss":sum(b["p"]==0 and e["p"]>0 for b,e in zip(base,extra))}
def swap(rows,kind):
 subset=[r["depth"]["1"]["swaps"][kind] for r in rows if kind in r["depth"]["1"]["swaps"]]
 before=money([x["before"] for x in subset]);after=money([x["after"] for x in subset])
 assert before["stake"]==after["stake"]
 return {"eligible_races":len(subset),"before":before,"after":after,
         "roi_difference_pp":round(after["roi_pct"]-before["roi_pct"],2) if subset else None}
def pair_ci(rows,depth,n=8000):
 groups=[[] for _ in range(12)]
 for r in rows:
  i=(r["offset"]-30)//5
  if not 0<=i<12:raise ValueError("Unexpected paired sample")
  groups[i].append(r)
 sums=[]
 for g in groups:
  a=money([r["depth"][depth]["extra"]["matched6"] for r in g])
  b=money([r["depth"][depth]["extra"]["matched_random6"] for r in g])
  assert a["stake"]==b["stake"]
  sums.append((a["stake"],a["payout"],b["payout"]))
 rng=random.Random(20261116+int(depth))
 bootstrap=[]
 for _ in range(n):
  draws=[sums[rng.randrange(12)] for j in range(12)]
  investment=sum(t[0] for t in draws)
  if investment:
   bootstrap.append(100*sum(t[1]-t[2] for t in draws)/investment)
 bootstrap.sort()
 return {"95pct_diff_six_minus_matched_random":[round(bootstrap[int(.025*len(bootstrap))],1),round(bootstrap[int(.975*len(bootstrap))],1)],
         "positive_fraction":round(sum(x>0 for x in bootstrap)/len(bootstrap),3),
         "five_day_clusters":12,"draws":len(bootstrap)}
scopes={
 "all90":allrows,
 "heldout60":[r for r in allrows if r["offset"]>=30],
 "period1":[r for r in allrows if r["offset"]<30],
 "period2":[r for r in allrows if 30<=r["offset"]<60],
 "period3":[r for r in allrows if r["offset"]>=60],
 "seven":[r for r in allrows if r["cars"]==7],
 "nine":[r for r in allrows if r["cars"]==9],
 "finalday_loser":[r for r in allrows if r["meeting"]=="最終日" and r["stage"]=="敗者戦"],
 "nonfavorite":[r for r in allrows if r["nonfavorite"]],
 "disagreement":[r for r in allrows if not r["agreement"]],
 "nonfavorite_disagreement":[r for r in allrows if r["nonfavorite"] and not r["agreement"]],
}
for category in sorted({r["category"] for r in allrows}):
 scopes["category_"+category]=[r for r in allrows if r["category"]==category]
output={}
for group,rows in scopes.items():
 output[group]={"n":len(rows)}
 for depth in ("1","2"):
  by={k:calc(rows,depth,k) for k in NAMES}
  output[group][depth]={"variants":by}
  if depth=="1":output[group][depth]["swap"]={k:swap(rows,k) for k in ("digit_6","digit_7","random","lowest_score","date_digit","matched_random6")}
  if group=="heldout60":
   output[group][depth]["paired_6_vs_placebo"]=pair_ci(rows,depth)
# Chronological training: winning historical digit 1-9 on prior30 days, trim top1,
# select next five days. This is a diagnostic of number-mining overfit.
walk={}
for depth in ("1","2"):
 chosen=[];fixed6=[];placebo=[];decisions=[]
 for day in range(30,90,5):
  train=[r for r in allrows if day-30<=r["offset"]<day]
  test=[r for r in allrows if day<=r["offset"]<day+5]
  candidates=[]
  for k in range(1,10):
   score=money([r["depth"][depth]["extra"][f"digit_{k}"] for r in train])
   if score["tickets"]>=50:
    candidates.append({"digit":k,"train_tickets":score["tickets"],"train_trim1":score["trim1_pct"],"train_roi":score["roi_pct"]})
  best=max(candidates,key=lambda x:(x["train_trim1"],-x["digit"])) if candidates else None
  decisions.append({"train_first":train[0]["date"],"train_last":train[-1]["date"],
   "test_first":test[0]["date"],"test_last":test[-1]["date"],"selected":best})
  for r in test:
   if best is not None:chosen.append(r["depth"][depth]["extra"][f"digit_{best['digit']}"])
   fixed6.append(r["depth"][depth]["extra"]["digit_6"])
   placebo.append(r["depth"][depth]["extra"]["random"])
 walk[depth]={"prior30_best_digit":money(chosen),"digit6_fixed":money(fixed6),"pseudo_random":money(placebo),"decisions":decisions}
report={
 "schema":"tk-keirin-fun-rational-irrational-third-place-v1",
 "period":["2026-08-18","2026-11-15"],"eligible":5745,
 "model":"Saved B-AXIS v0.6 top projected B head + published lineup; logical first/second (head/follower and reverse), rational third highest-score remaining",
 "model_is_original_auto_or_upset":False,
 "simulation":"100 yen per trifecta, add 1-2 speculative third tickets if not duplicating the rational baseline, or swap 1 ticket for no stake change",
 "source_sha":expected_sha,
 "validation":{"unique_eligible_races":len(seen),"source_days":90,"placebo_same_investment_in_every_race":True,
  "all_payouts_evaluated_only_after_constructing_picks":True},
 "by_scope":output,"walkforward_best_digit":walk,
 "limitations":[
  "This is a NEW lightweight rational baseline built from past archived B-AXIS candidate and lineup, NOT addition to original AUTO/B-UPSET tickets.",
  "Current model and archived cards may have been recorded or revised after races, so not verified genuine pre-race predictions.",
  "9 fixed numbers and multiple structural subsets are comparisons; observed best result is highly vulnerable to multiple testing.",
  "3rd-place #6 winning on certain races is not causal magic: vehicle numbers encode structural rider strength and line arrangements.",
  "Outcome is only used for settlement, never for constructing a ticket in the same race.",
  "No authentic historical pre-close trifecta odds for losing tickets; cannot reliably restrict to ex-ante 50x-100x.",
  "A high marginal ROI can arise from just one large payout; stress-test tail events and heldout periods.",
  "The fully sampled 5745R cohort differs from earlier selected 661R.",
  "No main/Railway/live production change."
 ]
}
(R/"fun-third-place-irrational-5745r-summary.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
md=["# 競輪LAB自由研究：合理的な1・2着 × 3着車番の遊び",
 "",
 "2026-08-18〜11-15・5,745Rの記録からB-AXISの保存済みB先頭候補と公開ラインを使用。1・2着をB先頭と番手（2案では逆順）と仮定。合理的3着は残った選手の競走得点上位。",
 "",
 "**重要：これはオリジナルAUTOやB-UPSETの既存買い目を再生成したものではなく、独立した軽量な研究用合理モデルです。**",
 "",
 "## 1・2着ペア1組、元の1点に3着を1点追加（90日5,745R）",
 "",
 "| 追加する3着 | 追加購入点数 | 追加部分の回収率 | 元1点回収率 | 追加後回収率 | 追加後の最高5件除外 |",
 "|---|---:|---:|---:|---:|---:|"]
for k in ["digit_6","digit_7","digit_1","digit_2","digit_3","digit_4","digit_5","digit_8","digit_9","random","date_digit","lowest_score","outside_line"]:
 s=output["all90"]["1"]["variants"][k]
 md.append(f"| {k} | {s['extra']['tickets']} | {s['extra']['roi_pct']}% | {s['base']['roi_pct']}% | {s['combined']['roi_pct']}% | {s['combined']['trim5_pct']}% |")
md.extend(["","## 3着6だけの追加と、同条件で選んだ非6ランダム券",
 "",
 "| 期間 | 追加6の券数 | 6だけのROI | 無作為非6券ROI |",
 "|---|---:|---:|---:|"])
for k in ["period1","period2","period3"]:
 a=output[k]["1"]["variants"]["matched6"]["extra"]
 b=output[k]["1"]["variants"]["matched_random6"]["extra"]
 md.append(f"| {k} | {a['tickets']} | {a['roi_pct']}% | {b['roi_pct']}% |")
ci=output["heldout60"]["1"]["paired_6_vs_placebo"]
md.extend(["",f"後半60日、5日単位ブートストラップで『6 − ランダム』回収率差の95%区間：{ci['95pct_diff_six_minus_matched_random']}ポイント。固定疑似乱数1種との比較であり、多重比較・依存性の補正なし。",
 "","## 予算を増やさない車番入替（元の1点→3着6）",
 ""])
for k in ["digit_6","digit_7","random","lowest_score","date_digit"]:
 s=output["all90"]["1"]["swap"][k]
 md.append(f"- {k}: 差替え可能{s['eligible_races']}R、同額購入で元回収率 {s['before']['roi_pct']}%、差替え後 {s['after']['roi_pct']}%、差 {s['roi_difference_pp']}ポイント")
for depth in ["1","2"]:
 s=walk[depth]
 md.extend(["",f"## 1・2着ペア {depth}組の過去30日首位数字を次5日に採用",
 f"過去30日首位の追加ROI {s['prior30_best_digit']['roi_pct']}%、3着6固定 {s['digit6_fixed']['roi_pct']}%、疑似乱数 {s['pseudo_random']['roi_pct']}%。"])
md.extend(["","## 結論と限界",
 "- 固定数字の一時的な好成績は『非合理が有効』という証拠ではない。月別、単純な無作為比較、高額払戻除外後ROIを優先する。",
 "- 追加投資ROIが100%未満なら元の1点と合算してもプラスの投資判断を保証しない。",
 "- 頭の予想はB-AXIS保存先頭と公開ラインから簡易生成したものであり、過去のAUTO／B-UPSETへの追加結果を装わない。",
 "- 数字・モデル選択に過去の結果を用いると、その選択は必ず次の未使用期間で検証する。",
 "- 研究用ブランチだけに保存。本番main、Railway、自動購入・通知は変更なし。"])
(R/"fun-third-place-irrational-5745r-summary-ja.md").write_text("\n".join(md)+"\n")
print("FUN_THIRD_LITE_FULL_AUDIT",json.dumps({
 "n":report["eligible"],"baseline":output["all90"]["1"]["variants"]["digit_6"]["base"]["roi_pct"],
 "extra6":output["all90"]["1"]["variants"]["digit_6"]["extra"],
 "extra7":output["all90"]["1"]["variants"]["digit_7"]["extra"],
 "random":output["all90"]["1"]["variants"]["random"]["extra"],
 "placebo":output["heldout60"]["1"]["paired_6_vs_placebo"],
 "walk":walk["1"]["prior30_best_digit"]["roi_pct"]},ensure_ascii=False))
