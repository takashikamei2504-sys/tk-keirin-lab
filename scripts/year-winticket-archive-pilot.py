#!/usr/bin/env python3
"""Four-page, robots-aware WINTICKET archived lineup feasibility probe.
The sample consists of 2025-2026 race IDs selected previously from archived K-Dreams
without reading outcomes. No protected raw page, odds, player text, or complete race
data is saved. If robots disallows, stop with an explicit inaccessible status.
"""
import collections,json,pathlib,re,time,urllib.request,urllib.error,urllib.robotparser
ROOT="https://www.winticket.jp"
UA="TK-Keirin-Lab-Research/1.0 (+https://github.com/takashikamei2504-sys/tk-keirin-lab; bounded source validation)"
SAMPLES=[
 {"race_id":"5620251116010012","slug":"kishiwada","source_ref":"validated-lineup-60",
  "reference_lines":[[1,7],[2,4],[3,5],[6]]},
 {"race_id":"4820260124010012","slug":"yokkaichi","source_ref":"validated-lineup-60",
  "reference_lines":[[2,7],[4],[1],[3,5,6]]},
 {"race_id":"2720260617010005","slug":"keiokaku","source_ref":"validated-lineup-60",
  "reference_lines":[[7,1,5],[2,4],[3,6]]},
 {"race_id":"4520260818010001","slug":"toyohashi","source_ref":"independent daily archived August",
  "reference_lines":[[1,4,7,2],[5,3],[6]]},
]
def get(url):
 req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept-Language":"ja-JP,ja;q=0.9"})
 with urllib.request.urlopen(req,timeout=25) as res:return res.read(5000000).decode("utf-8",errors="replace"),res.status
def get_state(html):
 for marker in ("window.__PRELOADED_STATE__ = ","window.__PRELOADED_STATE__="):
  i=html.find(marker)
  if i>=0:
   try:return json.JSONDecoder().raw_decode(html[i+len(marker):].lstrip())[0]
   except Exception:return {}
 return {}
def query_data(state,qname):
 for q in (state.get("tanStackQuery") or {}).get("queries") or []:
  if qname in str(q.get("queryKey") or []):return (q.get("state") or {}).get("data") or {}
 return {}
def parse_lineup(d):
 x=d.get("linePrediction") or {}
 lines=x.get("lines") or []
 result=[]
 slots_shared=0
 for line in lines:
  block=[]
  for e in line.get("entries") or []:
   nums=e.get("numbers") or []
   if len(nums)>1:slots_shared+=1
   for no in nums:
    if not isinstance(no,int) or no<1 or no>9:return None,slots_shared
    block.append(no)
  if block:result.append(block)
 return result,slots_shared
def compare(got,ref):
 def flat(groups):return [x for y in groups for x in y]
 return {"all_cars":len(flat(got))==len(flat(ref)) and len(set(flat(got)))==len(flat(got)) and set(flat(got))==set(flat(ref)),
         "same_groups":sorted(map(tuple,got))==sorted(map(tuple,ref)),
         "same_order":got==ref}
out={"schema":"tk-keirin-winticket-archive-lineup-four-page-probe/v1",
 "goal":"Confirm independently archived 2025-2026 line predictions and source completeness",
 "source":ROOT,"robots":None,"pages":[],"notes":[
 "Provider-issued predictions are not actual during-race formations.",
 "No bulk scraping, no original HTML or player records saved.",
 "A provider difference is not an error without contemporaneous validation.",
 "Historical data alone cannot establish a genuine frozen prospective ROI."]}
rp=urllib.robotparser.RobotFileParser()
try:
 robots,status=get(ROOT+"/robots.txt")
 rp.parse(robots.splitlines());out["robots"]="verified"
except Exception as e:out["robots"]="not_verified:"+repr(e)[:150]
for ix,s in enumerate(SAMPLES):
 rid=s["race_id"];num=int(rid[-4:]);start=rid[2:10];day=int(rid[10:12]);cup=start+rid[:2]
 url=f"{ROOT}/keirin/{s['slug']}/racecard/{cup}/{day}/{num}"
 row={"race_id":rid,"date":start,"expected_entrants":sum(map(len,s["reference_lines"])),"url":url,"reference_source":s["source_ref"]}
 if out["robots"]!="verified" or not rp.can_fetch(UA,url):
  row["status"]="skipped_robots_not_verified_or_disallowed";out["pages"].append(row);continue
 try:
  html,status=get(url)
  if status!=200:raise ValueError("HTTP "+str(status))
  state=get_state(html);d=query_data(state,"FETCH_KEIRIN_RACE")
  got,shared=parse_lineup(d)
  if not got:
   row["status"]="no_historical_linePrediction"
  else:
   checks=compare(got,s["reference_lines"])
   row.update({"status":"parsed","line_count":len(got),"cars":sum(map(len,got)),
               "shared_competition_slots":shared,**checks,
               "score_records_present":isinstance(d.get("records"),list) and bool(d.get("records")),
               "entries_present":len(d.get("entries") or []),
               "race_record_keys":sorted(list((d.get("race") or {}).keys()))[:40]})
 except urllib.error.HTTPError as e:
  row.update({"status":"http_error","code":e.code})
  out["pages"].append(row)
  if e.code in (403,429):
   out["blocked"]=True
   break
  continue
 except Exception as e:row.update({"status":"error","reason":repr(e)[:150]})
 out["pages"].append(row)
 if ix<len(SAMPLES)-1:time.sleep(2)
out["totals"]={
 "candidates":len(SAMPLES),"attempted":len(out["pages"]),
 "parsed":sum(r["status"]=="parsed" for r in out["pages"]),
 "same_line_order":sum(r.get("same_order") is True for r in out["pages"]),
 "all_cars":sum(r.get("all_cars") is True for r in out["pages"]),
 "status_counts":dict(collections.Counter(r["status"] for r in out["pages"]))}
p=pathlib.Path("reports/year-race-type/winticket-archive-four-page-check.json")
p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
print("WINTICKET_BOUNDED_ARCHIVE_QA",json.dumps(out["totals"],ensure_ascii=False),flush=True)
