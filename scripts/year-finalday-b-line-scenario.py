#!/usr/bin/env python3
"""FINAL-B line scenario research with 90-day SHA-verified pre-race fields.

The "B" below is a PROJECTED candidate to reach the final back. The
historic daily archive lacks observed actual-B indicators. NO claim is made
that winner, payout, or style alone establishes who actually took B.
Strictly no outcome/payout fields enter projection or favorite ranking.
Selected 2026-11-06 third-party actual-B pilot is reported separately;
it is small, retrospectively curated, and not official independently audited.
"""
import collections,datetime as dt,importlib.util,json,pathlib,statistics
ROOT=pathlib.Path("reports/year-race-type")
spec=importlib.util.spec_from_file_location(
 "tk_line_audit",str(pathlib.Path(__file__).with_name("year-finalday-line-topology-audit.py")))
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
src,days=mod.check_source()
rows=mod.read_rows(src,days)
archive={}
for date,day in days.items():
 for card in day["races"]:
  key=date+":"+str(card.get("venue"))+":"+str(card.get("race_number"))
  if key in archive:raise ValueError("Source duplicate "+key)
  archive[key]=card

def projection(card):
 """Rules frozen in source, no knowledge of results, payout or any predictor output."""
 es=card["entries"]
 means=statistics.mean(float(e["competition_score"]) for e in es)
 lines=collections.defaultdict(list)
 for e in es:
  a,b=map(int,e["line_position"].split("-"))
  lines[a].append((b,e))
 groups=[]
 for line_no,entries in sorted(lines.items()):
  entries.sort()
  assert [n for n,_ in entries]==list(range(1,len(entries)+1))
  group=[r for _,r in entries]
  first=group[0]
  lead=float(first["competition_score"])
  style=first["running_style"]
  if style not in ("逃","両","追"):raise ValueError("Style missing")
  support=(min(len(group),3)-1)*.30
  second=(.007*(float(group[1]["competition_score"])-means)) if len(group)>1 else 0
  b_score={"逃":2.0,"両":1.0,"追":-.8}[style]+.035*(lead-means)+support+second
  strength=lead+(.4*max(0,float(group[1]["competition_score"])-means) if len(group)>1 else 0)
  strength+=.4*(len(group)-1)
  groups.append({"line_id":line_no,"members":[int(x["car_number"]) for x in group],
   "head_no":int(first["car_number"]),"head_style":style,"head_score":lead,
   "line_length":len(group),"B_proxy":round(b_score,5),"strength_proxy":round(strength,5)})
 ranked=sorted(groups,key=lambda x:(-x["B_proxy"],-x["head_score"],x["head_no"]))
 power=sorted(groups,key=lambda x:(-x["strength_proxy"],-x["head_score"],x["head_no"]))
 projected=ranked[0];strong=power[0]
 margin=round(ranked[0]["B_proxy"]-ranked[1]["B_proxy"],5)
 return {"projected_b_head":projected["head_no"],
  "projected_b_members":projected["members"],"favorite_head":strong["head_no"],
  "favorite_members":strong["members"],
  "projected_nonfavorite":projected["line_id"]!=strong["line_id"],
  "projected_b_margin":margin,
  "b_gap_class":"拮抗(<0.6)" if margin<.6 else "中間(0.6〜1.2未満)" if margin<1.2 else "優勢(1.2以上)",
  "escape_head_count":sum(x["head_style"]=="逃" for x in groups),
  "candidate_lines":len(groups),
  "projected_b_head_style":projected["head_style"],
  "favorite_head_style":strong["head_style"],
  "has_solo":any(len(x["members"])==1 for x in groups),
  "summary":[{"head":x["head_no"],"style":x["head_style"],"members":x["members"],"b_proxy":x["B_proxy"],"strength":x["strength_proxy"]} for x in ranked]}
def flag(f,k):
 if k=="B候補＝強いライン":return not f["projected_nonfavorite"]
 if k=="B候補＝非有力ライン":return f["projected_nonfavorite"]
 if k=="逃ライン先頭が1人":return f["escape_head_count"]==1
 if k=="逃ライン先頭が2人以上":return f["escape_head_count"]>=2
 if k=="逃ライン先頭なし":return f["escape_head_count"]==0
 if k=="主導権争い拮抗":return f["projected_b_margin"]<.6
 if k=="B候補優勢明確":return f["projected_b_margin"]>=1.2
 if k=="非有力B候補かつ拮抗":return f["projected_nonfavorite"] and f["projected_b_margin"]<.6
 raise KeyError(k)
SCENARIOS=["B候補＝強いライン","B候補＝非有力ライン","逃ライン先頭が1人",
 "逃ライン先頭が2人以上","逃ライン先頭なし","主導権争い拮抗","B候補優勢明確",
 "非有力B候補かつ拮抗"]
data=[]
for r in rows:
 card=archive.get(r["race_id"])
 if card is None:raise ValueError("Card not found")
 f=projection(card)
 if len(f["summary"])!=r["line_count"]:raise ValueError("Line count mismatch")
 # Tied placings may have several valid trifecta settlements and no result_top3.
 # These are legitimate paid races and must not be silently removed.
 observed=card.get("result_top3")
 if isinstance(observed,list) and len(observed)==3:
  combos=[observed]
 else:
  combos=[x.get("combo") for x in (card.get("result_combos") or [])]
 if not combos or any(not isinstance(c,list) or len(c)!=3 for c in combos):
  raise ValueError("Missing all valid placements "+r["race_id"])
 numbers={int(c[0]) for c in combos}
 field={int(x["car_number"]) for x in card["entries"]}
 if not numbers.issubset(field):raise ValueError("Winner not a starter "+r["race_id"])
 # If there is a first-place tie, classify winning line as unknown for rates.
 winner=next(iter(numbers)) if len(numbers)==1 else None
 rr=dict(r)
 rr["b_feature"]=f
 rr["outcome_check"]={
  "winner_in_projected_b_line":winner in f["projected_b_members"] if winner is not None else None,
  "winner_is_projected_b_head":winner==f["projected_b_head"] if winner is not None else None,
  "winner_in_favorite_line":winner in f["favorite_members"] if winner is not None else None,
  "first_two_in_projected_b_line":all(all(int(n) in f["projected_b_members"] for n in c[:2]) for c in combos)
 }
 data.append(rr)
final=[r for r in data if r["meeting_day"]=="最終日" and r["stage"]=="敗者戦"]
if len(data)!=5745 or len(final)!=790:raise RuntimeError("Cohort changed")
def pack(group):
 ev={}
 for k in ("auto","physical","line","b_upset_ad","b_upset_expanded","roi_coverage"):
  ev[k]=mod.metrics(group,k)
 n=len(group)
 hits=collections.Counter()
 unknown=collections.Counter()
 for r in group:
  for k,v in r["outcome_check"].items():
   if v is None:unknown[k]+=1
   elif v:hits[k]+=1
 def rate(k):
  denom=n-unknown[k]
  return round(100*hits[k]/denom,1) if denom else None
 return {"n":n,"winner_known":n-unknown["winner_in_projected_b_line"],
  "winner_projected_b_line_pct":rate("winner_in_projected_b_line"),
  "winner_projected_b_head_pct":rate("winner_is_projected_b_head"),
  "winner_favorite_line_pct":rate("winner_in_favorite_line"),
  "first_two_projected_b_line_pct":rate("first_two_in_projected_b_line"),
  "engines":ev}
def groups(rows):
 return {k:pack([r for r in rows if flag(r["b_feature"],k)]) for k in SCENARIOS}
category={k:pack([r for r in final if r["category"]==k]) for k in sorted(set(r["category"] for r in final))}
out={
 "schema":"tk-keirin-90day-finalday-projected-b-line-audit/v1",
 "created_at":dt.datetime.now(dt.timezone.utc).isoformat(),
 "source":{"provider":"kurinaka12-afk/keirin-app-data",
  "sha":mod.ARCHIVE,"verified_SHA_for_all_90days":True},
 "cohort":{"all":len(data),"finalday_losers":len(final)},
 "main":pack(final),
 "by_scenario":groups(final),
 "by_category":category,
 "by_period":{str(i+1):pack([r for r in final if r["period30"]==i]) for i in range(3)},
 "scenario_by_period":{k:{str(i+1):pack([r for r in final if r["period30"]==i and flag(r["b_feature"],k)]) for i in range(3)} for k in SCENARIOS},
 "all_stages":groups(data),
 "temporal_gate":{},
 "observed_b_pilot":{},
 "limits":[
 "Projected-B is an explicit score-and-head-style heuristic; not observed last-back rider or true B probability.",
 "Strength favorite is an internal score proxy, NOT actual market favorite or betting odds.",
 "Published line_prediction may differ from actual racing formation.",
 "After-the-event 2026-11 model retrospective predictions, not frozen from the real race day.",
 "Feature thresholds are exploratory; multiple comparisons and payout tails matter.",
 "All race outcomes and payouts are used ONLY for evaluation after scenario assignment.",
 "One 26-race B pilot is source-curated from a third party, cannot establish population B accuracy.",
 "Earlier selected 661R is from a different coverage mechanism and is NOT combined.",
 "No production or Railway updates."
 ]}
# Separately audit a non-random observed-B pilot without using B in B-line feature construction.
pilot_path=pathlib.Path("research/b-axis/pilot_2026_11_06.json")
pilot=json.loads(pilot_path.read_text(encoding="utf8"))
checks=[];excluded=[]
for p in pilot["races"]:
 r=next((x for x in data if x["race_id"]==p["race_id"]),None)
 if not r:
  excluded.append({"id":p["race_id"],"reason":"not in fixed 90day cohort"})
  continue
 f=r["b_feature"]
 number=int(p["b_no"])
 orig=set(f["projected_b_members"])
 other_lines=[set(q["members"]) for q in f["summary"]]
 actual_line=next((s for s in other_lines if number in s),None)
 if actual_line is None:raise ValueError("Actual-B rider absent "+p["race_id"])
 pilot_line=set(p["published_b_line"])
 if actual_line!=pilot_line:
  excluded.append({"id":p["race_id"],"reason":"published B-line disagrees with fixed source"})
  continue
 checks.append({"id":p["race_id"],"predicted_b_head_match":f["projected_b_head"]==number,
  "actual_b_in_projected_line":number in orig,
  "actual_b_in_strength_favorite_line":number in f["favorite_members"],
  "actual_b_head_of_actual_line":number in [q["head"] for q in f["summary"]],
  "matched_card":True})
def rat(key):
 return round(100*sum(x[key] for x in checks)/len(checks),2) if checks else None
out["observed_b_pilot"]={
 "pilot_source":"research/b-axis/pilot_2026_11_06.json (keirinhex third party, not official audited)",
 "sampled":len(pilot["races"]),"matched_and_line_consistent":len(checks),
 "excluded":excluded,
 "projected_head_equals_B_pct":rat("predicted_b_head_match"),
 "B_inside_projected_line_pct":rat("actual_b_in_projected_line"),
 "B_inside_strength_favorite_line_pct":rat("actual_b_in_strength_favorite_line"),
 "B_line_head_any_pct":rat("actual_b_head_of_actual_line"),
 "warning":"Single selected 2026-11-06 set, not a representative accuracy estimate."}
# Separate 2026-11-07 pilot: independently archived retrospective actual-B labels.
nov7_path=pathlib.Path("research/b-axis/nov7_replay_v02_v05.json")
nov7=json.loads(nov7_path.read_text(encoding="utf8"))
if nov7.get("matched")!=58 or len(nov7.get("examples",[]))!=58:
 raise ValueError("Fixed November 7 B-pilot case count changed")
pilot2=[];pilot2excluded=[]
by_rid={r["race_id"]:r for r in data}
for p in nov7["examples"]:
 rid=p["id"]
 r=by_rid.get(rid)
 if not r:
  pilot2excluded.append({"id":rid,"reason":"not in 90-day complete cohort"})
  continue
 if r["date"]!="2026-11-07":raise ValueError("B pilot date mismatch "+rid)
 f=r["b_feature"]
 actual=int(p["actualB"])
 others=[set(l["members"]) for l in f["summary"]]
 actual_group=next((s for s in others if actual in s),None)
 if actual_group is None:raise ValueError("B-rider absent from field "+rid)
 source_line=set(map(int,p["bLine"].split("-")))
 if actual_group!=source_line:
  pilot2excluded.append({"id":rid,"reason":"B-rider lineup differs across sources"})
  continue
 source_all=sorted([tuple(sorted(s)) for s in others])
 pilot_all=sorted([tuple(sorted(int(z) for z in line.split("-"))) for line in p["lines"]])
 if source_all!=pilot_all:
  pilot2excluded.append({"id":rid,"reason":"full pre-race lineup differs"})
  continue
 pilot2.append({"id":rid,"field":int(p["field"]),"actualB":actual,
  "our_correct_B":f["projected_b_head"]==actual,
  "our_line_contains_B":actual in f["projected_b_members"],
  "existing_B_AXIS_correct_B":int(p["modelB"])==actual,
  "favorite_B_correct":actual in f["favorite_members"],
  "projected_B_nonfavorite":f["projected_nonfavorite"]})
def pilotstat(v):
 n=len(v)
 if not n:return {"n":0}
 def rate(k):return round(100*sum(x[k] for x in v)/n,1)
 return {"n":n,
  "our_head_matches":sum(x["our_correct_B"] for x in v),
  "our_head_match_pct":rate("our_correct_B"),
  "our_line_contains_actual_B_pct":rate("our_line_contains_B"),
  "existing_axis_correct":sum(x["existing_B_AXIS_correct_B"] for x in v),
  "existing_axis_correct_pct":rate("existing_B_AXIS_correct_B"),
  "favorite_line_has_actual_B_pct":rate("favorite_B_correct"),
  "nonfavorite_projection_count":sum(x["projected_B_nonfavorite"] for x in v)}
out["observed_b_pilot_nov7"]={
 "origin":"research/b-axis/nov7_replay_v02_v05.json; retrospective Chariloto B marks",
 "source_cases":58,"matched":len(pilot2),"excluded":pilot2excluded,
 "all":pilotstat(pilot2),
 "by_car_count":{str(n):pilotstat([r for r in pilot2 if r["field"]==n]) for n in (7,9)},
 "method":"All pre-result model inputs come from SHA-pinned 90-day source; historical B only for validation",
 "warning":"B-AXIS v0.5 and this proxy developed after race dates, not genuine historical forecasts"}
out["observed_b_pilot"]["existing_axis_v03_nov6_correct_pct"]=69.2
out["observed_b_pilot"]["existing_axis_v03_nov6_correct_races"]=18
out["observed_b_pilot"]["existing_axis_v03_nov6_source"]="research/b-axis/replay_2026_11_06_v02_v03.json; retrospective"

# Pre-declared gate hypotheses (selection on pre-result features only).
heldout=[r for r in final if r["period30"]>0]
out["heldout_baseline"]=pack(heldout)
gate_names=["B候補＝非有力ライン","B候補＝強いライン","逃ライン先頭が2人以上",
 "逃ライン先頭が1人","主導権争い拮抗","B候補優勢明確"]
for name in gate_names:
 sample=[r for r in heldout if flag(r["b_feature"],name)]
 q=pack(sample)
 q["by_period"]={str(i+1):pack([r for r in sample if r["period30"]==i]) for i in (1,2)}
 # Paired ROI of B-UPSET vs AUTO on the SAME selected races.
 if len(sample)>=60:
  q["b_upset_ad_vs_auto_5day_bootstrap"]=mod.bootstrap_diff(sample,"b_upset_ad","auto")
 out["temporal_gate"][name]=q
# One strategy with actual prior-period performance-based admission.
train_select=[]
for target in (1,2):
 train=[r for r in final if r["period30"]==target-1]
 test=[r for r in final if r["period30"]==target]
 selected=[]
 criteria={}
 # Three disjoint B-type categories, fixed 30R and trimmed-1 80% floor.
 for name in ("B候補＝強いライン","B候補＝非有力ライン"):
  subset=[r for r in train if flag(r["b_feature"],name)]
  m=mod.metrics(subset,"auto")
  enabled=(len(subset)>=30 and (m["trim1_roi_pct"] or 0)>=80)
  criteria[name]={"train_races":len(subset),"train_auto_trim1_roi_pct":m["trim1_roi_pct"],"admit":enabled}
  if enabled:selected += [r for r in test if flag(r["b_feature"],name)]
 train_select.extend(selected)
 out.setdefault("adaptive_prior30",[]).append({"train_period":target,"test_period":target+1,
  "decisions":criteria,"buy_count":len(selected),"roi":mod.metrics(selected,"auto")})
out["adaptive_prior30_summary"]={"selected":pack(train_select),
 "coverage_pct":round(100*len(train_select)/len(heldout),1)}
ROOT.mkdir(parents=True,exist_ok=True)
(ROOT/"90day-finalday-b-line-scenario-20261116.json").write_text(
 json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
def pct(x):return "－" if x is None else f"{x:.1f}%"
lines=[
 "# 競輪LAB・最終日敗者戦：どのラインがBを取るかという事前仮説の検証",
 "",
 "固定90日5,745R、最終日敗者戦790R、後半60日の時系列比較517R。",
 "",
 "## 定義上の最重要注意",
 "",
 "ここでの「B候補」とは、**脚質・先頭得点・ライン長から、Bを取る可能性が高いと仮定したライン**。過去90日の実際のB実測は収録されていない。**勝者をB獲得者とみなしていない。**",
 "有力ラインも競走得点を使った内部proxyであり、実際の人気ラインや配当オッズ上の評価ではない。",
 "",
 "## 最終日敗者戦790R（同一対象を重複条件別に集計）",
 "",
 "| 発走前の主導権仮説 | R | B候補ラインからの1着率 | AUTO回収率 | AUTO上位5件除外 | 物理回収率 | B-UPSET A〜D回収率 |",
 "|---|---:|---:|---:|---:|---:|---:|",
 ]
for k,v in out["by_scenario"].items():
 e=v["engines"]
 lines.append("| "+k+" | "+str(v["n"])+" | "+pct(v["winner_projected_b_line_pct"])+" | "+
  pct(e["auto"]["roi_pct"])+" | "+pct(e["auto"]["trim5_roi_pct"])+" | "+
  pct(e["physical"]["roi_pct"])+" | "+pct(e["b_upset_ad"]["roi_pct"])+" |")
lines+=["",
 "## 後半60日517R（事前定義した固定条件、期間別内訳あり）",
 "",
 "| 固定条件 | R | AUTO | B-UPSET A〜D | AUTO上位5件除外 | 第2期AUTO | 第3期AUTO |",
 "|---|---:|---:|---:|---:|---:|---:|"]
for k,v in out["temporal_gate"].items():
 lines.append("| "+k+" | "+str(v["n"])+" | "+pct(v["engines"]["auto"]["roi_pct"])+" | "+
  pct(v["engines"]["b_upset_ad"]["roi_pct"])+" | "+pct(v["engines"]["auto"]["trim5_roi_pct"])+" | "+
  pct(v["by_period"]["2"]["engines"]["auto"]["roi_pct"])+" | "+pct(v["by_period"]["3"]["engines"]["auto"]["roi_pct"])+" |")
a=out["observed_b_pilot"]
lines+=["","## 別枠：実測Bを含む26件の既存パイロット","",
 f"元データ26R、固定90日とラインが一致したもの{a['matched_and_line_consistent']}R。",
 f"B予測先頭者と実際のBが同一 {pct(a['projected_head_equals_B_pct'])}。",
 f"B予測ラインに実際のB獲得者が含まれる {pct(a['B_inside_projected_line_pct'])}。",
 f"得点有力ラインに実際のB獲得者が含まれる {pct(a['B_inside_strength_favorite_line_pct'])}。",
 "既存B-AXIS v0.3の11月6日パイロットは18/26件一致で、今回の簡易代理モデル15/26件より高い（いずれも事後再生成）。",
 "",
 "## 11月7日・58件の実測Bを用いた追加独立照合",
 "",
 f"固定90日アーカイブで発走前ラインが一致する対象：{out['observed_b_pilot_nov7']['matched']}R / 58R。",
 f"今回の得点・脚質・ライン長による簡易B先頭一致率：{pct(out['observed_b_pilot_nov7']['all'].get('our_head_match_pct'))}。",
 f"既存B-AXIS v0.5の同一対象一致率：{pct(out['observed_b_pilot_nov7']['all'].get('existing_axis_correct_pct'))}。",
 f"簡易B候補ラインに実際のB選手が含まれる割合：{pct(out['observed_b_pilot_nov7']['all'].get('our_line_contains_actual_B_pct'))}。",
 "どちらも開発済みモデルの過去再生成であり、前向き予想の成績ではない。級班別ではなく車数別の詳細はJSON。",
  "第三者により選別された小標本であるため、真のB予測精度として一般化しない。",
 "",
 "## 前30日→次30日、B候補が有力ラインかどうかだけで購入を選別",
 "",
 "2区分それぞれ前期30R以上、AUTOの最大1件除外後回収率80%以上なら次期AUTO購入。満たさない区分は見送り。",
 f"後半60日の購入 {out['adaptive_prior30_summary']['selected']['n']}R / {len(heldout)}R。",
 f"購入AUTO回収率 {pct(out['adaptive_prior30_summary']['selected']['engines']['auto']['roi_pct'])}。",
 f"最大5件除外 {pct(out['adaptive_prior30_summary']['selected']['engines']['auto']['trim5_roi_pct'])}。",
 "",
 "## 判断",
 "",
 "- B実測は大半で利用できないため、主導権『予測』と本当のB獲得実績との精度差を継続検証する。",
 "- 各区分で高回収率が出ても最大5件除外、30日ごとの再現を確認するまで本番採用しない。",
 "- 本番main/Railway、通知、現行AUTO選択基準は変更していない。",
 "",
 "出所・全８エンジンおよび級班・月別データは同名JSONを参照。"]
(ROOT/"90day-finalday-b-line-scenario-20261116-ja.md").write_text(
 "\n".join(lines)+"\n",encoding="utf8")
print("PROJECTED_B_LINE_SCENARIO",json.dumps({
 "n":len(final),"pilot":out["observed_b_pilot"],
 "scenarios":{k:{"n":v["n"],"auto_roi":v["engines"]["auto"]["roi_pct"],
   "auto_trim5":v["engines"]["auto"]["trim5_roi_pct"],
   "win_b_line":v["winner_projected_b_line_pct"]} for k,v in out["by_scenario"].items()},
 "adaptive_prior30":out["adaptive_prior30_summary"]["selected"]["engines"]["auto"]["roi_pct"]
},ensure_ascii=False)[:15000])
