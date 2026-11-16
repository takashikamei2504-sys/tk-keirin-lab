#!/usr/bin/env python3
"""Post-hoc matched exposure checks for discovered #7 and proposed #6.
Read only the audited per-race 90-day fun-lite shard artifacts; no re-prediction.
This is NOT untouched confirmation because digit 7 was identified on same history.
"""
import datetime as dt,json,pathlib,random
ROOT=pathlib.Path("reports/year-race-type")
items=[]
for part in range(18):
 f=json.loads((ROOT/"fun-lite-shards"/f"part-{part}.json").read_text())
 if f["schema"]!="tk-keirin-fun-third-score-and-b-head-replay/v1" or f["failures"] or f["expected"]!=f["completed"]:
  raise ValueError("Invalid replay shard")
 for row in f["rows"]:
  row["offset"]=(dt.date.fromisoformat(row["date"])-dt.date(2026,8,18)).days
  items.append(row)
if len(items)!=5745 or len({x["id"] for x in items})!=5745:raise RuntimeError("Duplicate / missing 90day race")
def score(rows,kind):
 x=[r["depth"]["1"]["extra"][kind] for r in rows]
 stake=sum(q["s"] for q in x);payout=sum(q["p"] for q in x)
 ordered=sorted(x,key=lambda q:q["p"],reverse=True)
 def trim(i):
  z=ordered[i:];s=sum(q["s"] for q in z)
  return round(100*sum(q["p"] for q in z)/s,2) if s else None
 return {"n":len(rows),"points":sum(q["n"] for q in x),
         "hits":sum(q["p"]>0 for q in x),"stake":stake,"paid":payout,"net":payout-stake,
         "roi":round(100*payout/stake,2) if stake else None,"trim1":trim(1),"trim5":trim(5),
         "biggest":ordered[0]["p"] if ordered else 0}
def boot(rows,kind1,kind2,rounds=8000):
 # Time-cluster bootstrap of ROI difference for exactly equal-cost tickets in paired cases.
 groups={}
 for r in rows:
  b=r["offset"]//5
  groups.setdefault(b,[]).append(r)
 a=[]
 for group in groups.values():
  x=score(group,kind1);y=score(group,kind2)
  if x["stake"]!=y["stake"]:raise ValueError("Not matched exposure")
  a.append((x["stake"],x["paid"]-y["paid"]))
 rng=random.Random(20261116+len(rows))
 vals=[]
 for _ in range(rounds):
  draw=[a[rng.randrange(len(a))] for _ in a]
  s=sum(q[0] for q in draw)
  if s:vals.append(100*sum(q[1] for q in draw)/s)
 vals.sort()
 return{"n_blocks":len(a),"reps":len(vals),
        "diff_95":[round(vals[int(len(vals)*.025)],1),round(vals[int(len(vals)*.975)],1)],
        "fraction_positive":round(sum(v>0 for v in vals)/len(vals),3)}
def compare(cohort,first,second):
 if any(r["depth"]["1"]["extra"][first]["s"]!=r["depth"]["1"]["extra"][second]["s"] for r in cohort):
  raise RuntimeError("Matched exposure needed")
 return{"first":score(cohort,first),"second":score(cohort,second),
        "paired_bootstrap":boot(cohort,first,second) if cohort else None}
contexts={
 "all90":items,
 "last60":[r for r in items if r["offset"]>=30],
 "period1":[r for r in items if r["offset"]<30],
 "period2":[r for r in items if 30<=r["offset"]<60],
 "period3":[r for r in items if r["offset"]>=60],
 "car7":[r for r in items if r["cars"]==7],
 "car9":[r for r in items if r["cars"]==9],
 "nonfavorite":[r for r in items if r["nonfavorite"]],
 "finalday_loser":[r for r in items if r["meeting"]=="最終日" and r["stage"]=="敗者戦"]
}
groups={}
for k,rs in contexts.items():
 only7=[r for r in rs if r["depth"]["1"]["extra"]["digit_7"]["n"]==1]
 only6=[r for r in rs if r["depth"]["1"]["extra"]["digit_6"]["n"]==1]
 both=[r for r in only7 if r["depth"]["1"]["extra"]["digit_6"]["n"]==1]
 groups[k]={
  "seven_eligible_vs_random":compare(only7,"digit_7","random"),
  "six_eligible_vs_random":compare(only6,"digit_6","random"),
  "both_eligible_seven_vs_six":compare(both,"digit_7","digit_6"),
  "seven_when_six_unavailable":compare([r for r in only7 if r["depth"]["1"]["extra"]["digit_6"]["n"]==0],"digit_7","random"),
  "7_in_eligible":len(only7),"6_in_eligible":len(only6),"both_eligible":len(both)
 }
out={"schema":"tk-keirin-rational-irrational-third-place-matched-followup/v1",
 "scope":"5745 historical 90day source + same-new-prediction base, no new hyperparameters",
 "methods":"Same-race comparisons: when 3rd7 is a NEW valid extra ticket, compare to deterministic RANDOM third on the exact same race (random can itself be 7); when both #6 and #7 are eligible, compare them with equal stakes.",
 "groups":groups,
 "limitations":[
  "This is post-selection sensitivity analysis: seven was identified as best-performing digit in the same 90 days.",
  "Random baseline is one deterministic draw per race. It may itself select #7; not a repeated independent placebo distribution.",
  "The same-race 5day block bootstrap accounts for within-day clustering only, not model development leakage or nine-number multiple testing.",
  "Same underlying simple rational model, NOT original AUTO or B-UPSET portfolios.",
  "No authentic pre-race odds and not timestamp-verified 2026-08..11 snapshots.",
  "Do not deploy any numerology derived from this sample."
 ]}
(ROOT/"fun-third-place-irrational-matched-followup.json").write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n")
md=["# 自由研究補足：同一レース・同一100円投資で3着7は無作為より優位か",
 "",
 "3着7の好結果は9個の数字から事後発見されたもの。正当な追試ではないため、同じ追加券購入機会での対照比較に限定。",
 "",
 "| 対象 | 条件一致R | 3着7のROI | 無作為3着のROI | 同一レース・5日ブロック差95%区間 |",
 "|---|---:|---:|---:|---|"]
for k in ["all90","last60","period1","period2","period3","car7","car9","nonfavorite","finalday_loser"]:
 g=groups[k]["seven_eligible_vs_random"]
 md.append(f"| {k} | {g['first']['n']} | {g['first']['roi']}% | {g['second']['roi']}% | {g['paired_bootstrap']['diff_95'] if g['paired_bootstrap'] else '－'} |")
md.extend(["","## 3着7が可能、しかし3着6は追加できないレース（特殊構造の探索）",
 "| 期間 | 対象R | 3着7単独ROI | 高額5件除外 | 同条件ランダムROI | 差95%区間 |",
 "|---|---:|---:|---:|---:|---|"])
for k in ["all90","last60","period1","period2","period3"]:
 g=groups[k]["seven_when_six_unavailable"]
 md.append(f"| {k} | {g['first']['n']} | {g['first']['roi']}% | {g['first']['trim5']}% | {g['second']['roi']}% | {g['paired_bootstrap']['diff_95'] if g['paired_bootstrap'] else '－'} |")
md.extend(["","この条件は既に3着7が好成績だったことを見て発見した**完全な事後探索**。6が1・2着にいる場合や、合理3着として元から選ばれている場合が含まれる。選別条件の優位性・因果性を保証しない。"])
md.extend(["","## 3着6と7の双方を買えるレースだけで比較",
 "| 期間 | 対象R | 3着7のROI | 3着6のROI | 差95%区間 |",
 "|---|---:|---:|---:|---|"])
for k in ["all90","last60","period1","period2","period3"]:
 g=groups[k]["both_eligible_seven_vs_six"]
 md.append(f"| {k} | {g['first']['n']} | {g['first']['roi']}% | {g['second']['roi']}% | {g['paired_bootstrap']['diff_95'] if g['paired_bootstrap'] else '－'} |")
md.extend(["","## 注意",
 "- 9数字を試した後で7を選んでいるため、統計的に差があっても未来の優位性は確認できない。",
 "- 無作為は固定ハッシュ1組のみ。追加で無作為を複数seedに変えた試験も有効。",
 "- 3着7が利用可能な出走表だけ比較することで、出走者位置・元の買い目との重複による投資額差を抑えた。",
 "- 全データの分析は独立した研究専用ブランチのみ、main/Railwayは変更なし。"])
(ROOT/"fun-third-place-irrational-matched-followup-ja.md").write_text("\n".join(md)+"\n")
print("FUN_MATCHED_7_CONTROL",json.dumps({k:{q:{"n":v[q]["first"]["n"],"first":v[q]["first"]["roi"],"second":v[q]["second"]["roi"],"ci":v[q]["paired_bootstrap"]["diff_95"] if v[q]["paired_bootstrap"] else None} for q in ("seven_eligible_vs_random","both_eligible_seven_vs_six")} for k,v in groups.items()},ensure_ascii=False).replace("\u0000","")[:12000])
