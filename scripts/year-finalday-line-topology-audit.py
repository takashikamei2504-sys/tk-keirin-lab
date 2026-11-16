#!/usr/bin/env python3
"""Fixed-cohort final-day versus structure audit, 5745 races across eight engines.
Historical input (including published LINE position) is downloaded from a pinned
repository version, digest-checked against the original 90-day archive. Finishes,
payouts and model predictions NEVER influence pre-race topology derivation.
Not true frozen before-race performance; retrospective current-model analysis.
"""
import collections, concurrent.futures, datetime as dt, hashlib, json, pathlib, random, re, time, urllib.request
ROOT=pathlib.Path("reports/year-race-type")
INPUT=ROOT/"complete90-eight-engine-audit.json"
OUTPUT=ROOT/"90day-finalday-line-structure-20261116.json"
REPORT=ROOT/"90day-finalday-line-structure-20261116-ja.md"
DATE0=dt.date(2026,8,18)
ARCHIVE="4588ec938a2fec9e81216d3fd3423329805aa3d5"
WAYS=["auto","physical","causal","lab_v5","line","roi_coverage","b_upset_ad","b_upset_expanded"]
LABELS={"auto":"AUTO","physical":"物理修正版","causal":"因果展開型",
"lab_v5":"LAB V5","line":"LAB LINE","roi_coverage":"ROI COVERAGE",
"b_upset_ad":"B-UPSET A〜D","b_upset_expanded":"B-UPSET拡張"}
TIE={("2026-08-22:松戸:3","lab_v5"):180,
("2026-08-22:松戸:3","line"):180,
("2026-08-22:松戸:3","roi_coverage"):180,
("2026-08-26:玉野:6","b_upset_ad"):1590}
def fetch_day(day):
 url="https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/"+ARCHIVE+"/"+day+".json"
 for attempt in range(3):
  try:
   req=urllib.request.Request(url,headers={"User-Agent":"tk-keirin-lab/line-structure-retrospective-audit"})
   with urllib.request.urlopen(req,timeout=45) as response:raw=response.read()
   doc=json.loads(raw)
   if doc.get("date")!=day or not isinstance(doc.get("races"),list):raise ValueError("Bad day "+day)
   return day,doc,hashlib.sha256(raw).hexdigest()
  except Exception:
   if attempt==2:raise
   time.sleep(1+attempt)
def check_source():
 obj=json.loads(INPUT.read_text(encoding="utf8"))
 if obj.get("schema")!="tk-keirin-90day-exhaustive-fullrace-eight-engine-report/v1" or len(obj["races"])!=5745 or obj.get("days")!=90:raise ValueError("Wrong cohort")
 if obj["source"]["pinned_commit"]!=ARCHIVE:raise ValueError("Archive commit mismatch")
 dates=[(DATE0+dt.timedelta(days=i)).isoformat() for i in range(90)]
 days={}
 with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
  for day,doc,sha in pool.map(fetch_day,dates):
   if sha!=obj["source"]["day_sha256"].get(day):raise ValueError("Immutable raw source digest mismatch "+day)
   days[day]=doc
 return obj,days
def line_shape(src):
 entries=src["entries"]
 if len(entries) not in (7,9):raise ValueError("Wrong car count")
 lines=collections.defaultdict(list)
 nums=set()
 for e in entries:
  no=int(e["car_number"])
  mm=re.fullmatch(r"(\d{1,2})-(\d{1,2})",str(e.get("line_position") or ""))
  if not mm or no in nums:raise ValueError("Ambiguous lineup position")
  nums.add(no);lines[int(mm[1])].append((int(mm[2]),no,str(e.get("running_style") or "")))
 groups=[]
 for _,members in sorted(lines.items()):
  members.sort()
  if [m[0] for m in members]!=list(range(1,len(members)+1)):raise ValueError("Non-contiguous line")
  groups.append(members)
 if len(groups)<2 or sum(map(len,groups))!=len(entries):raise ValueError("Incomplete lineup")
 nlines=len(groups)
 mult=sum(len(g)>1 for g in groups)
 solos=sum(len(g)==1 for g in groups)
 sprinters=sum(g[0][2]=="逃" for g in groups)
 if nlines==2: shape="2ライン"
 elif nlines==3:shape="3ライン"
 elif nlines==4:shape="4ライン"
 else:shape="5ライン以上"
 return {"line_count":nlines,"multi_line_count":mult,"solo_count":solos,
         "sprint_heads":sprinters,"line_shape":shape,
         "sole_sprinter_proxy":sprinters==1,
         "max_length":max(len(g) for g in groups)}
def read_rows(obj,daydocs):
 dates=set()
 index={}
 for d,day in daydocs.items():
  dates.add(d)
  for s in day["races"]:
   key=d+":"+str(s.get("venue"))+":"+str(s.get("race_number"))
   if key in index:raise ValueError("Duplicate day venue race "+key)
   index[key]=(s,day)
 seen=set();rows=[];errors=[]
 for r in obj["races"]:
  rid=r["race_id"]
  if rid in seen:raise ValueError("Duplicate prediction "+rid)
  seen.add(rid)
  if any(k not in r["predictions"] for k in WAYS):raise ValueError("Eight-way predictions missing")
  if rid not in index:raise ValueError("No source card "+rid)
  card,day=index[rid]
  if len(card["entries"])!=r["cars"] or card.get("is_girls"):raise ValueError("Cards gender/count mismatch")
  if (str(card.get("round_name") or "")!=r["round"] or
      str(day.get("venue_info",{}).get(r["venue"],{}).get("meeting_day") or "不明")!=r["meeting_day"]):
   raise ValueError("Round/meeting mismatch "+rid)
  data={k:v for k,v in r.items() if k!="predictions"}
  data.update(line_shape(card))
  data["period30"]=(dt.date.fromisoformat(r["date"])-DATE0).days//30
  if data["period30"] not in (0,1,2):raise ValueError("Out of bounds period")
  predictions={}
  for engine,p in r["predictions"].items():
   z=dict(p)
   if z.get("stake",0)!=z.get("points",0)*100:raise ValueError("Stake/points inconsistent "+rid)
   z["payout"]+=TIE.get((rid,engine),0)
   if z["payout"]<0 or z["stake"]<0:raise ValueError("Invalid settlement")
   z["net"]=z["payout"]-z["stake"]
   z["hit"]=z["payout"]>0
   predictions[engine]=z
  data["predictions"]=predictions
  data["final_group"]=("非最終日" if r["meeting_day"]!="最終日" else
   {"敗者戦":"最終日敗者戦","決勝":"最終日決勝","特選等":"最終日特選等"}.get(r["stage"],"最終日その他"))
  rows.append(data)
 if len(rows)!=5745 or len(dates)!=90:raise ValueError("Lost a race/day")
 rows.sort(key=lambda r:(r["date"],r["race_id"]))
 return rows
def metrics(rows,engine):
 p=[r["predictions"][engine] for r in rows]
 stake=sum(v["stake"] for v in p);paid=sum(v["payout"] for v in p)
 def cut(k):
  z=sorted(p,key=lambda v:v["payout"],reverse=True)[k:]
  s=sum(v["stake"] for v in z)
  return round(100*sum(v["payout"] for v in z)/s,2) if s else None
 hits=[v for v in p if v["payout"]>0]
 return {"races":len(rows),"hits":len(hits),"stake_yen":stake,
  "payout_yen":paid,"net_yen":paid-stake,
  "roi_pct":round(100*paid/stake,2) if stake else None,
  "trim1_roi_pct":cut(1),"trim5_roi_pct":cut(5),
  "max_single_payout_yen":max((v["payout"] for v in p),default=0),
  "payout5k_to10k_hit_races":sum(5000<=v["payout"]<10000 for v in p),
  "payout10kplus_hit_races":sum(v["payout"]>=10000 for v in p),
  "largest_win_share_pct":round(100*max((v["payout"] for v in p),default=0)/paid,1) if paid else None}
def pack(rows):return {"n":len(rows),"engines":{k:metrics(rows,k) for k in WAYS}}
def group(rows,func):
 keys=sorted(set(func(r) for r in rows))
 return {k:pack([r for r in rows if func(r)==k]) for k in keys}
def bootstrap_diff(rows,a,b,seed=20261116,trials=12000):
 blocks=collections.defaultdict(list)
 for r in rows:blocks[(dt.date.fromisoformat(r["date"])-DATE0).days//5].append(r)
 pack_blocks=[]
 for v in blocks.values():
  pack_blocks.append(tuple(sum(r["predictions"][e][f] for r in v) for e in (a,b) for f in ("stake","payout")))
 if len(pack_blocks)<10:return None
 rng=random.Random(seed);diff=[]
 for _ in range(trials):
  vals=[pack_blocks[rng.randrange(len(pack_blocks))] for _ in pack_blocks]
  as_=sum(x[0] for x in vals);ap=sum(x[1] for x in vals)
  bs_=sum(x[2] for x in vals);bp=sum(x[3] for x in vals)
  if as_ and bs_:diff.append(100*ap/as_-100*bp/bs_)
 diff.sort()
 return {"difference_roi_pctpoints_95pct":[round(diff[int(len(diff)*.025)],1),round(diff[int(len(diff)*.975)],1)],
  "fraction_advantage":round(sum(x>0 for x in diff)/len(diff),3),
  "sampled_5day_blocks":len(pack_blocks),"resamples":len(diff)}
def make():
 obj,source=check_source()
 rows=read_rows(obj,source)
 final=[r for r in rows if r["meeting_day"]=="最終日"]
 loss=[r for r in final if r["stage"]=="敗者戦"]
 other=[r for r in rows if r["stage"]=="敗者戦" and r["meeting_day"]!="最終日"]
 groups={
  "final_groups":group(rows,lambda r:r["final_group"]),
  "finalday_categories":group(final,lambda r:r["category"]),
  "finalday_category_stages":group(final,lambda r:r["category"]+"|"+r["stage"]),
  "finalday_line_shapes":group(final,lambda r:r["line_shape"]),
  "finalday_loss_category_shape":group(loss,lambda r:r["category"]+"|"+r["line_shape"]),
  "finalday_loss_single_sprinter":group(loss,lambda r:"逃先頭1ライン" if r["sole_sprinter_proxy"] else "その他"),
  "finalday_loss_solo_count":group(loss,lambda r:str(min(2,r["solo_count"]))+("人以上" if r["solo_count"]>=2 else "人")),
  "finalday_loss_shape":group(loss,lambda r:r["line_shape"]),
  "finalday_loss_by_period":group(loss,lambda r:str(r["period30"]+1)+"期"),
  "finalday_loss_category_period":group(loss,lambda r:r["category"]+"|"+str(r["period30"]+1)+"期"),
  "nonfinal_loss_by_period":group(other,lambda r:str(r["period30"]+1)+"期")
 }
 windows=[]
 stable=[]
 for category_shape,cohort in groups["finalday_loss_category_shape"].items():
  if cohort["n"]<90:continue
  src=[r for r in loss if r["category"]+"|"+r["line_shape"]==category_shape]
  by_period=[pack([r for r in src if r["period30"]==i]) for i in range(3)]
  for engine in WAYS:
   m=cohort["engines"][engine]
   w=[p["engines"][engine]["roi_pct"] for p in by_period]
   stable.append({"category_structure":category_shape,"engine":engine,"races":cohort["n"],
    "by_period_n":[x["n"] for x in by_period],"by_period_roi":w,
    "roi_pct":m["roi_pct"],"trim5_roi_pct":m["trim5_roi_pct"],
    "qualified_all3_profit_and_trim5":(
      min(x["n"] for x in by_period)>=20 and all(v is not None and v>=100 for v in w)
      and m["trim5_roi_pct"] is not None and m["trim5_roi_pct"]>=100)})
 stable.sort(key=lambda x:(not x["qualified_all3_profit_and_trim5"],
  -(x["trim5_roi_pct"] if x["trim5_roi_pct"] is not None else -1),-x["races"]))
 out={"schema":"tk-keirin-90day-finalday-topology-eight-way/v1",
      "created_at":dt.datetime.now(dt.timezone.utc).isoformat(),
      "source":{"original_90day_repository":obj["source"]["github_repository"],
                "pinned_commit":ARCHIVE,"all_90_daily_sha256_verified":True},
      "period":["2026-08-18","2026-11-15"],
      "counts":{"races":len(rows),"finalday":len(final),"finalday_losers":len(loss),
       "nonfinal_losers":len(other),"finalday_final":sum(r["stage"]=="決勝" for r in final)},
      "all":pack(rows),"finalday":pack(final),"finalday_losers":pack(loss),
      "nonfinalday_losers":pack(other),
      "by":groups,
      "physics_vs_auto_finalday_loss_block_bootstrap":bootstrap_diff(loss,"physical","auto"),
      "finalday_losers_Auto_vs_nonfinalday_losers_block_bootstrap":None,
      "stable_subgroup_test":{"rule":"n>=90, each period n>=20, ROI >=100% across all 3 periods AND trim5 ROI>=100% in full group",
       "qualifying":sum(x["qualified_all3_profit_and_trim5"] for x in stable),
       "all_eligible_candidates":stable},
      "limitations":[
        "Topology is published PRE-RACE line_position as found in retrospectively captured daily archive, not actual on-track lineup.",
        "Head rider with style=逃 is only a proxy for sole leader/sole sprinter; actual lead and B not observed.",
        "The 90day source snapshot may have been updated after race; absolute information timestamps not independently proven.",
        "Current November 2026 model retrospectively applied to August-November race cards, NOT contemporaneous frozen forecasts.",
        "Splitting by topology/round and selecting winning subgroups after observing their results incurs multiple testing.",
        "May-Aug preceding 90day strict-comment 661R is biased and cannot be pooled into uniform 180day full-backtest.",
        "5day-block bootstrap expresses internal uncertainty only, not future guaranteed profit." ]}
 OUTPUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 def pct(v):return "未算出" if v is None else f"{v:.1f}%"
 lines=[
 "# 競輪LAB・90日5,745R：最終日×級班×ライン構成の8方式監査",
 "",
 "対象: 2026-08-18〜2026-11-15。2026年11月版8エンジンによる現行モデル事後再生成。",
 "元データ90日分のSHA256をすべて照合し、レース前公開ラインを予想・払戻とID照合。ラインは実際の先行隊形ではない。",
 "",
 "## 主要レースの分類",
 "",
 "| 区分 | R | AUTO | 物理 | LINE | AUTO高額5件除外 |",
 "|---|---:|---:|---:|---:|---:|",
 ]
 for k in ("最終日敗者戦","最終日決勝","最終日特選等","最終日その他","非最終日"):
  g=groups["final_groups"].get(k)
  if not g:continue
  lines.append(f"| {k} | {g['n']} | {pct(g['engines']['auto']['roi_pct'])} | {pct(g['engines']['physical']['roi_pct'])} | {pct(g['engines']['line']['roi_pct'])} | {pct(g['engines']['auto']['trim5_roi_pct'])} |")
 lines.extend(["","## 最終日敗者戦・8方式","",
 "| エンジン | 的中 | 回収率 | 最大1件除外 | 最大5件除外 | 最大1件払戻 |",
 "|---|---:|---:|---:|---:|---:|"])
 for k in WAYS:
  v=out["finalday_losers"]["engines"][k]
  lines.append(f"| {LABELS[k]} | {v['hits']} | {pct(v['roi_pct'])} | {pct(v['trim1_roi_pct'])} | {pct(v['trim5_roi_pct'])} | {v['max_single_payout_yen']:,}円 |")
 lines+=["","物理-AUTOの5日ブロック比較 95%区間："+str(out["physics_vs_auto_finalday_loss_block_bootstrap"]["difference_roi_pctpoints_95pct"]),
 "","## 最終日敗者戦のライン構成（グループ数）","",
 "| 予想ライン数 | R | AUTO | AUTO 5件除外 | 物理 | LINE |",
 "|---|---:|---:|---:|---:|---:|"]
 for k,g in groups["finalday_loss_shape"].items():
  v=g["engines"]
  lines.append(f"| {k} | {g['n']} | {pct(v['auto']['roi_pct'])} | {pct(v['auto']['trim5_roi_pct'])} | {pct(v['physical']['roi_pct'])} | {pct(v['line']['roi_pct'])} |")
 lines+=["","## 級班×ライン構成（30日分割に跨る候補）","",
 "| 級班×ライン | エンジン | R | 1/2/3期R | 1/2/3期ROI | 全期5件除外 | 3期連続100%超かつtrim5≥100% |",
 "|---|---|---:|---|---|---:|---|"]
 for x in stable[:18]:
  yes="はい" if x["qualified_all3_profit_and_trim5"] else "いいえ"
  lines.append(f"| {x['category_structure']} | {LABELS[x['engine']]} | {x['races']} | {x['by_period_n']} | {x['by_period_roi']} | {pct(x['trim5_roi_pct'])} | {yes} |")
 lines+=["",f"厳格基準に合致する組合せ：**{out['stable_subgroup_test']['qualifying']}**。候補のすべてはJSON内を参照。",
 "","## 判定・制約","",
 "- 5件除外時は、的中上位5レースの払戻と投資をともに除外。",
 "- 最終日敗者戦の級班×ラインを事後探索した結果を、事前の購入優位性としては扱わない。",
 "- 単騎、逃げ1ライン等のproxyは出走表記載の見込み。B獲得やレース中隊形の実測ではない。",
 "- 新しい180日一括回収率は未算出。追加の661Rは選別抽出で比較対象の条件が異なる。",
 "- 本番main、Railway、通知、購入戦略は変更しない。"]
 REPORT.write_text("\n".join(lines)+"\n",encoding="utf8")
 print("FINALDAY_TOPOLOGY_AUDIT",json.dumps({
  "counts":out["counts"],
  "finalday_loss_auto":out["finalday_losers"]["engines"]["auto"]["roi_pct"],
  "finalday_loss_physical":out["finalday_losers"]["engines"]["physical"]["roi_pct"],
  "by_shapes":{k:{"n":v["n"],"auto":v["engines"]["auto"]["roi_pct"]} for k,v in groups["finalday_loss_shape"].items()},
  "stable_count":out["stable_subgroup_test"]["qualifying"],
  "paired_bootstrap":out["physics_vs_auto_finalday_loss_block_bootstrap"]
 },ensure_ascii=False))
if __name__=="__main__":
 make()
