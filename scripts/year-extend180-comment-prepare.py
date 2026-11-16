#!/usr/bin/env python3
"""Research-only, outcome-blind preceding 90-day lineup reconstruction.
Source publication/ownership remains with publishers. Only aggregate audits committed.
Use exact explicit rider-follow quotes, never finish/paybacks to build a line.
"""
import collections,concurrent.futures,csv,datetime,hashlib,io,json,pathlib,re,time,unicodedata,urllib.request,urllib.error
ROOT=pathlib.Path("reports/year-race-type");ROOT.mkdir(parents=True,exist_ok=True)
SN_SHA="6ea68de4d92d3a8294e1a7d168e918a8a90eb155"
CSV_SHA="55c425947770080fe3f3629720cda0f4ede69b9e"
OLD_SHA="4588ec938a2fec9e81216d3fd3423329805aa3d5"
START=datetime.date(2026,5,20)
DATES=[START+datetime.timedelta(days=i) for i in range(90)]
BASE=f"https://raw.githubusercontent.com/snarfnet/keirin-data/{SN_SHA}/"
CSV_BASE=f"https://raw.githubusercontent.com/Kenseimk/keirin-data/{CSV_SHA}/keirin_data/"
OLD_BASE=f"https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/{OLD_SHA}/"
UA="tk-keirin-lab/180-day-outcome-blind-public-source-audit"
def get(url):
 for attempt in range(3):
  try:
   req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept-Language":"ja-JP"})
   with urllib.request.urlopen(req,timeout=45) as r:return r.read()
  except urllib.error.HTTPError as e:
   if e.code==404:return None
   if attempt==2:raise
  except Exception:
   if attempt==2:raise
  time.sleep(1.0*(attempt+1))
def norm(x):return re.sub(r"[\s\u3000]","",unicodedata.normalize("NFKC",str(x or "")))
def numbers(x):
 try:return int(x)
 except:return None
def line_comments(entries):
 ids=[numbers(x.get("umaban")) for x in entries]
 if len(ids) not in (7,9) or None in ids or len(set(ids))!=len(ids):return None,"bad_numbers"
 follows={};self_ids=set()
 for row in entries:
  no=int(row["umaban"]);comment=norm(row.get("comment"))
  candidates=[]
  for other in entries:
   target=int(other["umaban"])
   if no==target:continue
   name=norm(other.get("name"))
   for k in range(2,min(5,len(name))+1):
    if any(name[:k]+s in comment for s in ("君","さん","選手")):candidates.append((k,target))
  if candidates:
   width=max(k for k,_ in candidates);targets=set(n for k,n in candidates if k==width)
   if len(targets)!=1:return None,"ambiguous_named_target"
   follows[no]=targets.pop()
  elif re.search("単騎|一人で|独りで|自力|自在|先行|前々|自分で|決めず",comment):
   self_ids.add(no)
  else:return None,"unresolved_comment"
 edges=collections.defaultdict(list)
 for a,b in follows.items():edges[b].append(a)
 if any(len(x)>1 for x in edges.values()):return None,"multiple_followers"
 groups=[]
 for root in ids:
  if root in follows:continue
  g=[root];t=root
  while edges[t]:
   t=edges[t][0]
   if t in g:return None,"cycle"
   g.append(t)
  groups.append(g)
 flat=[x for g in groups for x in g]
 if len(flat)!=len(ids) or len(set(flat))!=len(ids):return None,"incomplete"
 return groups,"strict_complete"
def parse_rid(rid):
 if not isinstance(rid,str) or not re.fullmatch(r"\d{16}",rid):return None
 try:
  first=datetime.date(int(rid[2:6]),int(rid[6:8]),int(rid[8:10]))
  nth=int(rid[10:12]);race=int(rid[12:])
  if nth<1 or nth>5 or race<1 or race>12:return None
  return ((first+datetime.timedelta(days=nth-1)).strftime("%Y%m%d"),str(int(rid[:2])),race)
 except:return None
def csv_month(m):
 raw=get(CSV_BASE+m+"_keirin.csv")
 if raw is None:raise ValueError("Missing CSV "+m)
 data=list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
 grouped=collections.defaultdict(list)
 for r in data:
  key=parse_rid(str(r.get("race_id","")))
  if key:grouped[key].append(r)
 return m,grouped,hashlib.sha256(raw).hexdigest(),len(data),(list(data[0].keys()) if data else [])
def same_riders(entries,rr):
 if len(entries)!=len(rr):return False
 seen={}
 for r in rr:
  no=numbers(r.get("banum"))
  if no is None or no in seen:return False
  seen[no]=norm(r.get("player_name"))
 for e in entries:
  en=norm(e.get("name"));cn=seen.get(numbers(e.get("umaban")),"")
  if not en or not cn or min(len(en),len(cn))<3 or not (en.startswith(cn) or cn.startswith(en)):return False
 return True
def category(rr):
 ranks=[norm(x.get("player_class")) for x in rr]
 if not ranks or any(x.startswith("L") for x in ranks):return None
 if all(x=="A3" for x in ranks):return "チャレンジ_"+str(len(rr))
 if any(x.startswith("S") for x in ranks):return "S級_"+str(len(rr))
 if all(x.startswith("A") for x in ranks):return "A級_"+str(len(rr))
 return None
def payout_csv(rr):
 options={}
 for row in rr:
  v=norm(row.get("san_ren_tan"))
  for a,b,c,yen in re.findall(r"([1-9])-([1-9])-([1-9])([\d,]+)円",v):
   key="-".join((a,b,c));p=int(yen.replace(",",""))
   if len(set((a,b,c)))==3 and p>0:options[key]=p
 return [{"key":k,"trio":[int(q) for q in k.split("-")],"payout":v} for k,v in options.items()]
def payout_result(obj):
 combos={}
 for p in obj.get("paybacks",[]):
  if p.get("type")!="3連単":continue
  k=norm(p.get("combination"));v=numbers(p.get("payout"))
  if not re.fullmatch("[1-9]-[1-9]-[1-9]",k) or v is None or v<=0:continue
  if len(set(k.split("-")))!=3:continue
  if k in combos and combos[k]!=v:return []
  combos[k]=v
 return [{"key":k,"trio":[int(q) for q in k.split("-")],"payout":v} for k,v in combos.items()]
def day(d):
 dstr=d.strftime("%Y%m%d")
 a=get(BASE+"entries_"+dstr+".json")
 b=get(BASE+"results_"+dstr+".json")
 if not a:raise RuntimeError("Missing entries "+dstr)
 o=json.loads(a);s=json.loads(b) if b else None
 if o.get("date")!=dstr or (s is not None and s.get("date")!=dstr):raise RuntimeError("Date mismatch "+dstr)
 return d,o,s,hashlib.sha256(a).hexdigest(),(hashlib.sha256(b).hexdigest() if b else None)
def normalized_groups(groups):return sorted(tuple(q) for q in groups)
def benchmark():
 test_dates=["2026-08-18","2026-08-19","2026-08-20","2026-08-29","2026-09-10","2026-10-16"]
 counts=collections.Counter();mismatches=[]
 for d in test_dates:
  n=json.loads(get(BASE+"entries_"+d.replace("-","")+".json"))
  o=json.loads(get(OLD_BASE+d+".json"))
  for x in n["races"]:
   old=next((r for r in o["races"] if r.get("venue")==x.get("venue") and r.get("race_number")==x.get("race_no") and len(r.get("entries") or [])==len(x.get("entries") or [])),None)
   if old is None or old.get("is_girls") or len(x.get("entries") or []) not in (7,9):continue
   lookup={int(e["car_number"]):e for e in old["entries"]}
   if not all(int(e["umaban"]) in lookup and norm(lookup[int(e["umaban"])].get("rider_full_name") or lookup[int(e["umaban"])].get("rider_name"))==norm(e["name"]) for e in x["entries"]):continue
   groups=collections.defaultdict(list)
   for e in old["entries"]:
    m=re.fullmatch(r"(\d+)-(\d+)",str(e.get("line_position") or ""))
    if not m:groups={};break
    groups[int(m[1])].append((int(m[2]),int(e["car_number"])))
   if not groups:continue
   counts["verified_cards"]+=1
   pred,why=line_comments(x["entries"])
   if pred is None:continue
   counts["reconstructed"]+=1
   truth=[[t[1] for t in sorted(v)] for _,v in sorted(groups.items())]
   if normalized_groups(pred)==normalized_groups(truth):counts["agreed"]+=1
   else:
    counts["disagreed"]+=1
    if len(mismatches)<10:mismatches.append({"date":d,"id":x["race_id"],"pred":pred,"expected":truth})
 return {"days":test_dates,"counts":dict(counts),"mismatches":mismatches}
def main():
 by_csv={};hashes={};fields={}
 months=["2026_%02d"%m for m in (5,6,7,8)]
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
  for m,groups,sha,n,columns in ex.map(csv_month,months):
   hashes[m]=sha;fields[m]={"rows":n,"columns":columns}
   for k,arr in groups.items():by_csv[k]=arr
 summary=collections.Counter();qa=collections.Counter();reasons=collections.Counter()
 selected=[];digest={}
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
  for d,entry,result,h1,h2 in ex.map(day,DATES):
   ds=d.isoformat();digest[ds]={"entries":h1,"results":h2}
   rs={r["race_id"]:r for r in (result.get("results",[]) if result else [])}
   if result:summary["result_days"]+=1
   summary["days"]+=1
   for race in entry["races"]:
    summary["entry_races"]+=1
    es=race.get("entries") or []
    if len(es) not in (7,9):continue
    summary["seven_nine_any"]+=1
    if any((float(e.get("score") or 0))<60 for e in es):continue
    summary["seven_nine_potential_male"]+=1
    line,why=line_comments(es)
    reasons[why]+=1
    if line is None:continue
    summary["strict_lines"]+=1
    key=(d.strftime("%Y%m%d"),str(int(race.get("venue_cd") or "0")),int(race.get("race_no") or 0))
    rr=by_csv.get(key)
    if not rr:qa["no_monthly_csv_match"]+=1;continue
    if not same_riders(es,rr):qa["rider_name_mismatch"]+=1;continue
    cl=category(rr)
    if cl not in ("A級_7","S級_7","S級_9","チャレンジ_7"):qa["invalid_class"]+=1;continue
    summary["strict_plus_grade_name"]+=1
    outcome=rs.get(race["race_id"])
    result_source="snarfnet" if outcome else "Kenseimk_monthly_csv"
    combos=payout_result(outcome) if outcome else payout_csv(rr)
    if not combos:qa["no_usable_trifecta"]+=1;continue
    car_set={int(e["umaban"]) for e in es}
    if any(set(o["trio"])-car_set for o in combos):qa["payout_nonstarter"]+=1;continue
    raw_entries=[]
    position={no:f"{li}-{pos}" for li,g in enumerate(line,1) for pos,no in enumerate(g,1)}
    for e in es:
     match=next(q for q in rr if int(q["banum"])==int(e["umaban"]))
     raw_entries.append({"car_number":int(e["umaban"]),"rider_full_name":norm(e["name"]),
       "class_rank":norm(match["player_class"]),"competition_score":float(e["score"]),
       "running_style":str(e.get("style") or ""),"line_position":position[int(e["umaban"])]})
    selected.append({"date":ds,"race_id":race["race_id"],"venue":race["venue"],"race_no":race["race_no"],
      "start_time":race["start_time"],"category":cl,"grade":"未確認","round_name":"未取得",
      "entries":raw_entries,"observed":{"combos":combos},"result_source":result_source,
      "line_source":"strict_named_comment_inference","lineup":line,"reference_csv_id":str(rr[0]["race_id"])})
    summary["replay_ready"]+=1
    summary["replay_ready_"+cl]+=1
    summary["result_"+result_source]+=1
    print("READY_DAY",ds,"total",summary["replay_ready"],flush=True) if False else None
 b=benchmark()
 summary_out={"schema":"tk-keirin-extended180-comment-reconstructed-prep/v1",
  "period":{"start":DATES[0].isoformat(),"end":DATES[-1].isoformat(),"days":len(DATES)},
  "source":{"entries_results":"snarfnet/keirin-data@"+SN_SHA,"csv":"Kenseimk/keirin-data@"+CSV_SHA,"overlap_comparison":"kurinaka12-afk/keirin-app-data@"+OLD_SHA},
  "counts":dict(summary),"excluded_reasons":dict(qa),"line_reconstruction":dict(reasons),
  "cross_source_verification":b,"csv_columns":fields,"source_sha256":digest,
  "method":"No finishing position or payout used to select line; named comment references only; no unknown line filled.",
  "limitations":["Comment-derived lineups have no independently verified truth for May-Aug historical period.",
    "This is a selection-biased minority of races; never pool ROI with preceding validated 90-day all eligible races.",
    "Published monthly CSV payouts are unverified independently; historical input timing is not proven.",
    "Race round name and grade event class unavailable. Rider class is independently matched, meeting stage unknown.",
    "November 2026 code on past races, not pre-race frozen contemporary prediction."]}
 # Keep selected source cards in Actions artifact only; aggregated report committed separately.
 (ROOT/"extended180-comment-inputs-temporary.json").write_text(json.dumps({"summary":summary_out,"cards":selected},ensure_ascii=False),encoding="utf8")
 (ROOT/"extended180-comment-input-summary.json").write_text(json.dumps(summary_out,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
 print("PREP_DONE",json.dumps({"counts":dict(summary),"excluded":dict(qa),"line_reasons":dict(reasons),
  "verification":b},ensure_ascii=False),flush=True)
 if b["counts"].get("disagreed",0):raise RuntimeError("Independent benchmark mismatch. Keep outputs and forbid replay.")
 if summary["replay_ready"]<20:raise RuntimeError("Not enough validated race inputs to run eight-way scenario.")
if __name__=="__main__":main()
