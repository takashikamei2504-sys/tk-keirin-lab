#!/usr/bin/env python3
"""Observed B, independent proxy/B-AXIS agreement, finish paths and payoff.
Only existing 26 Nov6 + 58 Nov7 pre-race lineup matched historical B labels.
No B outcome, trifecta payout or finishing position is supplied to predictor.
Historical models were later trained/replayed; these are NOT live prospective bets.
"""
import datetime as dt, json, pathlib, runpy, math, collections
ROOT=pathlib.Path("reports/year-race-type")
base=runpy.run_path("scripts/year-finalday-b-line-scenario.py")
if base["out"]["cohort"]!={"all":5745,"finalday_losers":790}:
 raise RuntimeError("Historical 90-day source cohort changed")
p6=json.loads(pathlib.Path("research/b-axis/pilot_2026_11_06.json").read_text(encoding="utf8"))
e6=json.loads(pathlib.Path("research/b-axis/replay_2026_11_06_v02_v03.json").read_text(encoding="utf8"))
e7=json.loads(pathlib.Path("research/b-axis/nov7_replay_v02_v05.json").read_text(encoding="utf8"))
if len(p6["races"])!=26 or e6["count"]!=26 or e7["matched"]!=58 or len(e7["examples"])!=58:
 raise RuntimeError("Fixed B pilot sample or schema differs")
r6={x["id"]:x for x in e6["examples"]}
r7={x["id"]:x for x in e7["examples"]}
if len(r6)!=26 or len(r7)!=58:raise RuntimeError("Duplicated research pilot key")
data=base["data"];by_race={x["race_id"]:x for x in data};cards=base["archive"]
ROWS=[]
def combo_key(combo):return "-".join(str(int(x)) for x in combo)
def available_settlements(card):
 combos=[]
 for c in card.get("result_combos") or []:
  try:
   combo=[int(x) for x in c["combo"]]
   amount=int(c["payout"])
   if len(combo)==3 and len(set(combo))==3 and amount>0:
    combos.append({"key":combo_key(combo),"payout":amount,"trio":combo})
  except (ValueError,KeyError,TypeError):continue
 if not combos and card.get("result_top3") and card.get("payout_trifecta"):
  trio=[int(x) for x in card["result_top3"]]
  if len(trio)==3 and len(set(trio))==3:
   combos=[{"key":combo_key(trio),"payout":int(card["payout_trifecta"]),"trio":trio}]
 keys=[x["key"] for x in combos]
 if len(keys)!=len(set(keys)) or not combos:raise ValueError("Multiple or missing source outcomes")
 return combos
def v6(p):
 if p["race_id"] not in r6:raise RuntimeError("Missing archived 11/06 B-AXIS replay")
 old=r6[p["race_id"]]
 if int(old["b"])!=int(p["b_no"]) or combo_key(p["finish"])!=old["actual"]:
  raise RuntimeError("Nov6 observed B and finish discrepancy")
 return {"date":"2026-11-06","id":p["race_id"],"field":int(p["runners"]),
  "actual_b":int(p["b_no"]),"axis_b":int(old["aiB"]),
  "axis_version":"v0.3","tickets5":list(old["top5"]), "tickets3":list(old["top3"]),
  "actual":old["actual"],"source_paid":int(old["observedPayout"]),
  "external_B_line":list(map(int,p["published_b_line"]))}
def v7(p):
 if int(p["field"]) not in (7,9):raise RuntimeError("Invalid number of riders")
 if len(p["newTop5"])!=5:raise RuntimeError("Missing uniform B-AXIS five tickets")
 return {"date":"2026-11-07","id":p["id"],"field":int(p["field"]),
  "actual_b":int(p["actualB"]),"axis_b":int(p["modelB"]),
  "axis_version":"v0.5","tickets5":list(p["newTop5"]),
  "tickets3":list(p["newTop5"][:3]),
  "actual":p["actual"],"source_paid":int(p["payout"]),
  "external_B_line":list(map(int,p["bLine"].split("-"))),
  "all_external_lines":[list(map(int,x.split("-"))) for x in p["lines"]],
  "archive_saved_at":p["storedAt"]}
candidate=[v6(p) for p in p6["races"]]+[v7(p) for p in e7["examples"]]
if len(candidate)!=84 or len({x["id"] for x in candidate})!=84:raise RuntimeError("No 84 distinct races")
for p in candidate:
 row=by_race.get(p["id"]);card=cards.get(p["id"])
 if row is None or card is None:raise RuntimeError("Fixed 90-day source card absent "+p["id"])
 if row["date"]!=p["date"] or row["cars"]!=p["field"]:raise RuntimeError("Date/field mismatch")
 f=row["b_feature"]
 if sorted(f["projected_b_members"])!=sorted(f["summary"][0]["members"]):raise RuntimeError("B head members out of sync")
 if not any(sorted(x["members"])==sorted(p["external_B_line"]) for x in f["summary"]):
  raise RuntimeError("Archived actual-B line disagrees "+p["id"])
 if p.get("all_external_lines"):
  a=sorted(tuple(sorted(x["members"])) for x in f["summary"])
  b=sorted(tuple(sorted(x)) for x in p["all_external_lines"])
  if a!=b:raise RuntimeError("Complete archived line disagreement "+p["id"])
 if "archive_saved_at" in p:
  ts=dt.datetime.fromisoformat(str(p["archive_saved_at"]).replace("Z","+00:00"))
  start=dt.datetime.fromisoformat(p["date"]+"T"+card["start_time"]+"+09:00")
  if not ts<start:raise RuntimeError("Historical pre-start snapshot not proven "+p["id"])
 paid=available_settlements(card)
 winners={x["key"]:x["payout"] for x in paid}
 if p["actual"] not in winners or winners[p["actual"]]!=p["source_paid"]:
  raise RuntimeError("Published trifecta disagrees with prior pilot "+p["id"])
 no={int(e["car_number"]) for e in card["entries"]}
 if any(set(c["trio"])-no for c in paid):raise RuntimeError("Winner not a rider "+p["id"])
 if any(len(p[k])!=len(set(p[k])) or any(x not in
      {f"{a}-{b}-{c}" for a in range(1,10) for b in range(1,10) for c in range(1,10) if len({a,b,c})==3}
      for x in p[k]) for k in ("tickets3","tickets5")):
  raise RuntimeError("Invalid ticket set "+p["id"])
 def settle(tickets):
  keys=set(tickets)
  payout=sum(x["payout"] for x in paid if x["key"] in keys)
  return {"stake":100*len(keys),"payout":payout,"hit":payout>0,"points":len(keys)}
 observed_b_line=next(x["members"] for x in f["summary"] if p["actual_b"] in x["members"])
 winner_nos={int(x["trio"][0]) for x in paid}
 # No invented unique winning rider for genuine first-place tie.
 unique_winner=next(iter(winner_nos)) if len(winner_nos)==1 else None
 if unique_winner is None:finish_path="1着同着または不明"
 elif unique_winner==p["actual_b"]:finish_path="B通過選手が1着"
 elif unique_winner in observed_b_line:finish_path="Bライン別選手が1着"
 else:finish_path="別ラインが1着"
 winner_in_b_line=unique_winner in observed_b_line if unique_winner is not None else None
 auto=row["predictions"]["auto"];line=row["predictions"]["line"];upset=row["predictions"]["b_upset_ad"]
 for name,pr in (("auto",auto),("line",line),("b_upset_ad",upset)):
  if pr["stake"]!=pr["points"]*100:raise RuntimeError("Invalid eight-way settlement "+name)
 j={
  "date":p["date"],"id":p["id"],"field":p["field"],"category":row["category"],
  "meeting_day":row["meeting_day"],"stage":row["stage"],"venue":row["venue"],
  "proposed_b_head":int(f["projected_b_head"]),"axis_b_head":p["axis_b"],
  "actual_b":p["actual_b"],
  "b_forecasts_agree":int(f["projected_b_head"])==p["axis_b"],
  "proxy_b_hit":int(f["projected_b_head"])==p["actual_b"],
  "axis_b_hit":p["axis_b"]==p["actual_b"],
  "projected_nonfavorite_b":f["projected_nonfavorite"],
  "forecast_b_margin":f["projected_b_margin"],
  "actual_b_published_line":observed_b_line,
  "observed_b_at_published_line_position":observed_b_line.index(p["actual_b"])+1,
  "winner_first_no":unique_winner,"winner_in_observed_b_line":winner_in_b_line,
  "finish_path":finish_path,
  "actual_b_line_1st2nd":any(all(int(x) in observed_b_line for x in c["trio"][:2]) for c in paid),
  "bet_metrics":{
   "b_axis_top3":settle(p["tickets3"]),"b_axis_top5":settle(p["tickets5"]),
   "auto":{k:auto[k] for k in ("stake","payout","hit","points")},
   "lab_line":{k:line[k] for k in ("stake","payout","hit","points")},
   "b_upset_ad":{k:upset[k] for k in ("stake","payout","hit","points")}
   }
 }
 ROWS.append(j)
ROWS.sort(key=lambda r:(r["date"],r["id"]))
if len(ROWS)!=84 or sum(x["b_forecasts_agree"] for x in ROWS)!=64:
 raise RuntimeError("Historic agreement 64 of 84 changed")
def metrics(rows,name,trim=5):
 ps=[r["bet_metrics"][name] for r in rows]
 stake=sum(x["stake"] for x in ps);paid=sum(x["payout"] for x in ps)
 win=sorted(ps,key=lambda x:x["payout"],reverse=True)
 def cut(n):
  skip=win[:min(n,len(win))]
  s=stake-sum(x["stake"] for x in skip)
  p=paid-sum(x["payout"] for x in skip)
  return round(100*p/s,2) if s>0 else None
 return {"races":len(rows),"wins":sum(x["payout"]>0 for x in ps),
  "stake":stake,"payout":paid,"net":paid-stake,
  "roi_pct":round(100*paid/stake,2) if stake else None,
  "trim1_roi_pct":cut(1),"trim5_roi_pct":cut(5),
  "max_one_payout":win[0]["payout"] if win else None,
  "largest_payout_share_pct":round(100*win[0]["payout"]/paid,1) if paid else None}
ENGINES=["b_axis_top3","b_axis_top5","auto","lab_line","b_upset_ad"]
def detail(group):
 n=len(group)
 return {"races":n,
  "forecast_agree_count":sum(x["b_forecasts_agree"] for x in group),
  "true_b_prediction_count":sum(x["proxy_b_hit"] for x in group),
  "true_b_proxy_pct":round(100*sum(x["proxy_b_hit"] for x in group)/n,1) if n else None,
  "true_b_axis_pct":round(100*sum(x["axis_b_hit"] for x in group)/n,1) if n else None,
  "observed_B_line_win_pct":round(100*sum(x["winner_in_observed_b_line"] is True for x in group)/sum(x["winner_in_observed_b_line"] is not None for x in group),1) if sum(x["winner_in_observed_b_line"] is not None for x in group) else None,
  "finish_paths":dict(collections.Counter(x["finish_path"] for x in group)),
  "bets":{x:metrics(group,x) for x in ENGINES}}
def block(field):
 return {str(k):detail([x for x in ROWS if str(x[field])==str(k)])
  for k in sorted({str(x[field]) for x in ROWS})}
out={
 "schema":"tk-keirin-B-consensus-finish-roi-84r-retro/v1",
 "source":{
  "B_observations":["research/b-axis/pilot_2026_11_06.json",
   "research/b-axis/replay_2026_11_06_v02_v03.json",
   "research/b-axis/nov7_replay_v02_v05.json"],
  "same_pre_race_source":"90-day keirin-app-data pinned and SHA256 verified",
  "model_and_settlement":"Nov6 B-AXIS v0.3 top5, Nov7 B-AXIS v0.5 top5, all 8-engine 2026-11-16 replay"
 },
 "n":len(ROWS),"all":detail(ROWS),
 "by_forecast_agreement":block("b_forecasts_agree"),
 "by_prediction_correct":block("proxy_b_hit"),
 "by_day":block("date"),"by_field":block("field"),
 "by_meeting_day":block("meeting_day"),
 "by_finish_path":block("finish_path"),
 "by_projected_nonfavorite":block("projected_nonfavorite_b"),
 "source_checks":{
  "distinct_race_ids":len({r["id"] for r in ROWS}),
  "third_ties_supported":True,"lineup_conflicts":0,"payout_conflicts":0,
  "B_not_used_in_prediction":True,
  "cash_stakes":100},
 "limitations":[
  "Selected only 84 retrospective actual B labels from two historical dates; not an exhaustive 90day or final-day cohort.",
  "The B-AXIS v0.3/v0.5 was developed after target race; not truly frozen predictions.",
  "Payouts are historical third-party records crosschecked against source, not original time-stamped odds.",
  "Joint agreement might improve actual-B precision but cannot show wagering edge without independent future proof.",
  "Ticket sets differ between engines. ROI is sum winnings / sum stakes for each selected subset, not per-race normalized.",
  "Winner in actual B line uses the SOURCE PRE-RACE grouped line, not verified race formation or block outcomes.",
  "No rates of successful blocking/line detachment can be inferred without observed event-level denominators.",
  "Never pool the 661 comment-inferred pre-90 sample with 5745 source-complete 90-day records.",
  "All thresholds and hypotheses explorative, not pre-registered prospective."
 ]}
def wilson95(h,n):
 if not n:return None
 z=1.959963984540054
 p=h/n
 den=1+z*z/n
 center=(p+z*z/(2*n))/den
 radius=z*math.sqrt((p*(1-p)+z*z/(4*n))/n)/den
 return [round(100*(center-radius),1),round(100*(center+radius),1)]
out["by_agreement_day"]={
 d:{str(a):detail([r for r in ROWS if r["date"]==d and r["b_forecasts_agree"]==a])
   for a in (True,False)}
 for d in sorted({r["date"] for r in ROWS})}
out["by_agreement_field"]={
 str(n):{str(a):detail([r for r in ROWS if r["field"]==n and r["b_forecasts_agree"]==a])
   for a in (True,False)}
 for n in (7,9)}
out["agreement_baxis_top5_hit_interval_95pct"]={
 str(a):wilson95(out["by_forecast_agreement"][str(a)]["bets"]["b_axis_top5"]["wins"],
  out["by_forecast_agreement"][str(a)]["races"])
 for a in (True,False)}
out["methodology_notes"]=[
 "Wilson intervals are binomial small-sample descriptive uncertainty, NOT correction for selection bias, day-clustering, or model development leakage.",
 "B-AXIS v0.3 and v0.5 differ by date; day and 7/9-car stratification is recorded for transparency.",
 "Actual first-place winner classification is separate from observed B rider and line-group membership."]

ROOT.mkdir(parents=True,exist_ok=True)
(ROOT/"observed-b-consensus-84r-replay-audit.json").write_text(
 json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
def pct(x):return "－" if x is None else f"{x:.1f}%"
md=["# B-AXIS × 簡易B候補の一致が三連単成績と決着構造に与える影響",
 "",
 "対象は実測B照合の残っている2026-11-06（26R）と2026-11-07（58R）の計84Rのみ。",
 "予測Bが一致するかを発走前の出走表・保存された候補から判定し、実際のBと結果を後付け照合。",
 "既存B-AXISはレース後に開発・再生成された版を含み、これは過去の真の発走前予測ではない。",
 "",
 "## 2モデル一致・不一致で三連単を同一の84R上で比較",
 "",
 "| B予測の一致 | R | B予測的中率 | B-AXIS上位5点 ROI | AUTO ROI | LAB LINE ROI | B-UPSET A〜D ROI | B-AXIS上位5点最大5件除外 |",
 "|---|---:|---:|---:|---:|---:|---:|---:|"]
for choice,label in (("True","一致"),("False","不一致")):
 v=out["by_forecast_agreement"][choice]
 a=v["bets"]
 md.append(f"| {label} | {v['races']} | {pct(v['true_b_proxy_pct'])} | {pct(a['b_axis_top5']['roi_pct'])} | {pct(a['auto']['roi_pct'])} | {pct(a['lab_line']['roi_pct'])} | {pct(a['b_upset_ad']['roi_pct'])} | {pct(a['b_axis_top5']['trim5_roi_pct'])} |")
md.extend(["",
 "## 日別に分けた同一モデル比較（B-AXIS上位5点）",
 "",
 "| 日付 | B予測一致 | R | B-AXIS上位5点的中R | 的中率 | 回収率 | 最大5件除外 |",
 "|---|---|---:|---:|---:|---:|---:|"])
for day,groups in out["by_agreement_day"].items():
 for val,label in (("True","一致"),("False","不一致")):
  q=groups[val]
  m=q["bets"]["b_axis_top5"]
  hr=round(100*m["wins"]/q["races"],1) if q["races"] else None
  md.append(f"| {day} | {label} | {q['races']} | {m['wins']} | {pct(hr)} | {pct(m['roi_pct'])} | {pct(m['trim5_roi_pct'])} |")
md.extend(["",
 "上位5点的中率（2日合計）の95% Wilson区間：一致群 "+str(out["agreement_baxis_top5_hit_interval_95pct"]["True"])+"%、不一致群 "+str(out["agreement_baxis_top5_hit_interval_95pct"]["False"])+"%。",
 "少数レース・特定2日の選別標本であり、予測効率の改善や将来収益性に関する統計的証明ではない。日別でのモデルバージョン差にも注意。",
 ])
md.extend(["","## 2モデル一致・不一致と実測Bラインの決着構造","",
 "| 一致 | B通過者1着 | 同ライン別選手1着 | 別ライン1着 |",
 "|---|---:|---:|---:|"])
for choice,label in (("True","一致"),("False","不一致")):
 v=out["by_forecast_agreement"][choice]["finish_paths"]
 md.append(f"| {label} | {v.get('B通過選手が1着',0)} | {v.get('Bライン別選手が1着',0)} | {v.get('別ラインが1着',0)} |")
md.extend(["","## 対象84R共通、上位5点100円購入の仮想精算","",
 "| 方式 | 的中R | 投資円 | 払戻円 | 回収率 | 高額的中1件除外 | 5件除外 |",
 "|---|---:|---:|---:|---:|---:|---:|"])
for key in ENGINES:
 m=out["all"]["bets"][key]
 md.append(f"| {key} | {m['wins']} | {m['stake']:,} | {m['payout']:,} | {pct(m['roi_pct'])} | {pct(m['trim1_roi_pct'])} | {pct(m['trim5_roi_pct'])} |")
md+=["","## 注意事項",
 "- 最大1件・5件除外は最高払戻レースの投資額も分母から除外。",
 "- 特定の結果を見て選定した84Rであり、利幅の予測や本番導入判断には使えない。",
 "- 成立するのは実際のB通過選手と公開並び・着順の対応まで。番手ブロック成功や千切れの実測値はここから推定しない。",
 "- AUTO・LAB LINE・B-UPSET A〜Dは同一84Rの現行2026-11モデル事後再生成。B-AXISは11/6 v0.3と11/7 v0.5の混成。",
 "- 払戻・Bラベル・全ラインが既存検証結果と一致したことを検証。過去90日全件5,745Rや追加90日の限定661Rとは、評価母集団を分けて扱う。",
 "- この研究で本番main / Railway / 自動通知 / 購入戦略は変更しない。",
 "",
 "完全な記述集計はobserved-b-consensus-84r-replay-audit.jsonを参照。"]
(ROOT/"observed-b-consensus-84r-replay-audit-ja.md").write_text("\n".join(md)+"\n",encoding="utf8")
print("OBSERVED_B_CONSENSUS_AUDIT",json.dumps({
 "n":out["n"],
 "agree":out["by_forecast_agreement"]["True"]["races"],
 "agree_b_axis_top5_roi":out["by_forecast_agreement"]["True"]["bets"]["b_axis_top5"]["roi_pct"],
 "disagree_b_axis_top5_roi":out["by_forecast_agreement"]["False"]["bets"]["b_axis_top5"]["roi_pct"],
 "agree_auto_roi":out["by_forecast_agreement"]["True"]["bets"]["auto"]["roi_pct"],
 "agree_b_roi":out["by_forecast_agreement"]["True"]["true_b_proxy_pct"],
 "finish_paths_all":out["all"]["finish_paths"],
 "source_checks":out["source_checks"]
},ensure_ascii=False))
