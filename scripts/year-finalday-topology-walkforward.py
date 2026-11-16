#!/usr/bin/env python3
"""Final-day loser 30day->next30day topology-only walk-forward, research.
Line geometry is sourced from exact SHA-checked 90 daily racecards.
No test outcome enters the selection logic for that test period.
Current November model retrospectively replayed; NOT frozen pre-race predictions.
"""
import importlib.util,json,pathlib
ROOT=pathlib.Path("reports/year-race-type")
modspec=importlib.util.spec_from_file_location(
 "tk_finalday_topology",str(pathlib.Path(__file__).with_name("year-finalday-line-topology-audit.py")))
mod=importlib.util.module_from_spec(modspec)
modspec.loader.exec_module(mod)
src,days=mod.check_source()
rows=mod.read_rows(src,days)
loss=[r for r in rows if r["meeting_day"]=="最終日" and r["stage"]=="敗者戦"]
if len(rows)!=5745 or len(loss)!=790:raise RuntimeError("Fixed cohort or final-day loser count differs")
WAYS=mod.WAYS
def synthetic(r,pred):
 z=dict(r)
 z["predictions"]={"strategy":pred}
 return z
def results(rows):return mod.metrics(rows,"strategy")
periods=[];baseline=[];routed=[];gated=[];four=[]
for target in (1,2):
 train=[r for r in loss if r["period30"]==target-1]
 test=[r for r in loss if r["period30"]==target]
 shapes=sorted(set(x["line_shape"] for x in train+test))
 policy={}
 for shape in shapes:
  x=[r for r in train if r["line_shape"]==shape]
  n=len(x)
  if n<30:
   policy[shape]={"training_n":n,"route_engine":"auto","gate":False,
                  "reason":"Insufficient 30 historical races"}
   continue
  trim={k:mod.metrics(x,k)["trim1_roi_pct"] for k in WAYS}
  best=max(WAYS,key=lambda k:trim[k] if trim[k] is not None else -1)
  policy[shape]={"training_n":n,"route_engine":best,
   "trim1_roi_pct_selected":trim[best],
   "trim1_roi_pct_auto":trim["auto"],
   "gate":trim["auto"] is not None and trim["auto"]>=80}
 selected=[];pass_gate=[];only_four=[]
 for r in test:
  decision=policy[r["line_shape"]]
  selected.append(synthetic(r,r["predictions"][decision["route_engine"]]))
  if decision["gate"]:pass_gate.append(synthetic(r,r["predictions"]["auto"]))
  if r["line_shape"]=="4ライン":only_four.append(synthetic(r,r["predictions"]["physical"]))
 baseline.extend(test);routed.extend(selected);gated.extend(pass_gate);four.extend(only_four)
 periods.append({"train_period":target,"test_period":target+1,"train_races":len(train),
  "heldout_races":len(test),"decisions":policy,
  "baseline_auto":mod.metrics(test,"auto"),
  "baseline_physical":mod.metrics(test,"physical"),
  "line_count_routing":results(selected),
  "line_count_gate_auto":results(pass_gate),
  "fixed_four_line_physical":results(only_four)})
if len(baseline)!=517:raise RuntimeError("Heldout period not 517 R")
pair=[dict(r,predictions={"route":s["predictions"]["strategy"],"auto":r["predictions"]["auto"]})
 for r,s in zip(baseline,routed)]
out={"schema":"tk-keirin-finalday-line-topology-walkforward/v1",
 "methodology":"Train fixed previous 30d using final-day losers only, test next 30d, two independent period blocks. Route by training trim-largest-winner ROI among 8 where line-shape n>=30, otherwise AUTO. Gate purchases AUTO only if corresponding training shape n>=30 and trim1 ROI>=80. Shape alone is pre-race feature. Thresholds are exploratory; no retrospective best rule selected from test outcomes.",
 "source":{"repository":src["source"]["github_repository"],
           "commit":src["source"]["pinned_commit"],"all_daily_SHA_checked":True},
 "period":["2026-08-18","2026-11-15"],
 "counts":{"all":len(rows),"finalday_losers":len(loss),"heldout":len(baseline)},
 "heldout_auto":mod.metrics(baseline,"auto"),
 "heldout_physical":mod.metrics(baseline,"physical"),
 "line_count_rolling_router":results(routed),
 "line_count_auto_gate":results(gated),
 "gate_coverage_percent":round(100*len(gated)/len(baseline),2),
 "four_line_physical_only":results(four),
 "router_vs_auto_block_bootstrap":mod.bootstrap_diff(pair,"route","auto"),
 "periods":periods,
 "limitations":[
  "The initial 90-day archive itself and policy thresholds have been explored; this is temporal holdout, not completely untouched prospective validation.",
  "The data are retrospectively replayed with current November 2026 models, not predictions frozen before original starts.",
  "Line groups are publisher pre-race forecast and not race-day actual line or B point.",
  "Group selection as well as engine selection depend on small data, mostly high-tail wins.",
  "The 661 selected earlier historical cases are a different selection process and not pooled into this test.",
  "No main branch, Railway or live purchase change."
 ]}
ROOT.mkdir(parents=True,exist_ok=True)
(ROOT/"90day-finalday-topology-walkforward-20261116.json").write_text(
 json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
def fmt(x):return "－" if x is None else str(x)+"%"
labels=[("heldout_auto","AUTO固定・全件"),
 ("heldout_physical","物理修正版固定・全件"),
 ("line_count_rolling_router","前30日のライン数別首位エンジン"),
 ("line_count_auto_gate","前30日のライン数別AUTO購入ゲート"),
 ("four_line_physical_only","4ライン物理のみ（事後探索）")]
md=["# 最終日敗者戦：ライン数ルーティングと購入見送りの時系列検証",
 "",f"対象: 90日5,745R中の最終日敗者戦790R。学習最初30日、後半60日の**{len(baseline)}R**を2回に分けて時系列評価。第2期の選択は第1期だけ、第3期は第2期だけを参照。各買い目100円。","",
 "| 方式 | 購入R | 回収率 | 上位5件除外 |",
 "|---|---:|---:|---:|"]
for key,label in labels:
 o=out[key]
 md.append("| "+label+" | "+str(o["races"])+" | "+fmt(o["roi_pct"])+" | "+fmt(o["trim5_roi_pct"])+" |")
md+=["",
 "前30日×ライン数によるエンジン切替とAUTO固定との差、5日ブロック95%区間："+
 str(out["router_vs_auto_block_bootstrap"]["difference_roi_pctpoints_95pct"]),
 "",
 "## 30日別の検証結果",
 "",
 "| 次の期間 | R | AUTO | ライン数別ルーティング | AUTO購入ゲート | ゲート購入R |",
 "|---|---:|---:|---:|---:|---:|"]
for q in periods:
 md.append("| 第"+str(q["test_period"])+"期 | "+str(q["heldout_races"])+" | "+
 fmt(q["baseline_auto"]["roi_pct"])+" | "+fmt(q["line_count_routing"]["roi_pct"])+" | "+
 fmt(q["line_count_gate_auto"]["roi_pct"])+" | "+str(q["line_count_gate_auto"]["races"])+" |")
md+=["","## 解釈",
 "- この比較は過去30日のルールを次の30日に適用した時系列外テスト。ただし全データ自体はモデル開発で使われた可能性があり、新規前向きテストではない。",
 "- 4ライン物理限定は同じ90日の結果を既に見て着目した**事後探索**であり、真の外部ホールドアウト戦略とは区別。",
 "- 的中上位5R除外時のROIを重視。少数高配当のプラスでは購入判断を変更しない。",
 "- 追加90日の661Rはライン構成・番組の取得条件が異なるため合算禁止。",
 "- 本番main、Railway、通知は変更していない。",
 "",
 "30日別・ライン数別の事前選択履歴と全8エンジンはJSONを参照。"]
(ROOT/"90day-finalday-topology-walkforward-20261116-ja.md").write_text(
 "\n".join(md)+"\n",encoding="utf8")
print("FINALDAY_LINE_WALKFORWARD",json.dumps({k:{"n":out[k]["races"],"roi":out[k]["roi_pct"],
 "trim5":out[k]["trim5_roi_pct"]} for k,_ in labels}|{"ci":out["router_vs_auto_block_bootstrap"]["difference_roi_pctpoints_95pct"]},
 ensure_ascii=False))
