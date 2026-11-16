#!/usr/bin/env python3
"""Independent archived-source lineup validation on a fixed, small public 2026 sample.

Source-1: K-Dreams HTML historical 'line_position' anticipated lines
Source-2: pre-existing keirin-app-data daily JSON lineup positions.
Compare by matching car-number/rider-name with pinned Kenseimk race IDs.
The sampling uses only race identity/class, never race result or payout.
No HTML/rider personally identifying records are retained in the public audit.
"""
import collections,concurrent.futures,csv,datetime,hashlib,io,json,pathlib,re,time,unicodedata
from html.parser import HTMLParser
from urllib import request,error,robotparser
GH_CSV="55c425947770080fe3f3629720cda0f4ede69b9e"
GH_DAILY="4588ec938a2fec9e81216d3fd3423329805aa3d5"
CSV_BASE=f"https://raw.githubusercontent.com/Kenseimk/keirin-data/{GH_CSV}/keirin_data/{{}}_keirin.csv"
JSON_BASE=f"https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/{GH_DAILY}/{{}}.json"
KD="https://keirin.kdreams.jp"
UA="TK-Keirin-Lab-Research/1.0 (+https://github.com/takashikamei2504-sys/tk-keirin-lab; capped cross-source QA)"
FIXED_DAYS=["2026-08-18","2026-08-29","2026-09-10","2026-09-24","2026-10-12","2026-10-27","2026-11-05","2026-11-10"]
LIMIT=16
TARGET_GRADES={"A級_7","S級_7","S級_9","チャレンジ_7"}
def get(url,max_bytes=1400000):
 req=request.Request(url,headers={"User-Agent":UA,"Accept-Language":"ja-JP,ja"})
 with request.urlopen(req,timeout=30) as res:return res.read(max_bytes)
def norm(x):return re.sub(r"\s+","",unicodedata.normalize("NFKC",str(x or "")))
def date_from_id(rid):
 try:
  date=datetime.date(int(rid[2:6]),int(rid[6:8]),int(rid[8:10]))
  day=int(rid[10:12])
  return (date+datetime.timedelta(days=day-1)).isoformat() if day in range(1,6) else None
 except Exception:return None
def category(rows):
 ranks=[norm(x.get("player_class")) for x in rows]
 if any(x.startswith("L") for x in ranks):return None
 cl="チャレンジ" if all(x=="A3" for x in ranks) else "S級" if any(x.startswith("S") for x in ranks) else "A級" if all(x.startswith("A") for x in ranks) else None
 return cl+"_"+str(len(rows)) if cl else None
def join_names(rows,es):
 if len(rows)!=len(es):return False
 named={int(r["banum"]):norm(r.get("player_name")) for r in rows}
 if len(named)!=len(rows):return False
 n=0
 for e in es:
  a=named.get(int(e["car_number"]),"");b=norm(e.get("rider_full_name") or e.get("rider_name"))
  if a and b and (a.startswith(b) or b.startswith(a)) and min(len(a),len(b))>=3:n+=1
 return n>=len(es)-1
class Line(HTMLParser):
 def __init__(self):
  super().__init__(convert_charrefs=True)
  self.in_box=False;self.depth=0;self.tokens=[]
 def handle_starttag(self,tag,attrs):
  classes=dict(attrs).get("class","").split()
  if not self.in_box:
   if tag=="div" and "line_position" in classes:self.in_box=True;self.depth=0
   return
  self.depth+=1
  if tag=="span" and "icon_p" in classes and "space" in classes:self.tokens.append("/")
  if tag=="span":
   for c in classes:
    if re.fullmatch(r"p00[1-9]",c):self.tokens.append(int(c[-1]));break
 def handle_endtag(self,tag):
  if self.in_box:
   self.depth-=1
   if self.depth<0:self.in_box=False
def parse_groups(s):
 dom=Line();dom.feed(s)
 groups=[];cur=[]
 for t in dom.tokens:
  if t=="/":
   if cur:groups.append(cur);cur=[]
  else:cur.append(t)
 if cur:groups.append(cur)
 return groups
def group_from_position(entries):
 groups=collections.defaultdict(list)
 for e in entries:
  m=re.fullmatch(r"(\d+)-(\d+)",str(e.get("line_position") or ""))
  if not m:return None
  groups[int(m.group(1))].append((int(m.group(2)),int(e["car_number"])))
 return [list(n for _,n in sorted(v)) for _,v in sorted(groups.items())]
dates={};csvs={};errs={}
tasks={}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 for d in FIXED_DAYS:tasks[pool.submit(get,JSON_BASE.format(d))]=("day",d)
 for m in sorted({d[:7].replace("-","_") for d in FIXED_DAYS}):tasks[pool.submit(get,CSV_BASE.format(m),8000000)]=("csv",m)
 for t in concurrent.futures.as_completed(tasks):
  kind,key=tasks[t]
  try:
   raw=t.result()
   if kind=="day":
    day=json.loads(raw)
    if day.get("date")!=key:raise ValueError("Date mismatch")
    dates[key]=day
   else:csvs[key]=list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
  except Exception as e:errs[kind+key]=str(e)[:180]
if errs:raise RuntimeError("Historical provider data incomplete "+str(errs))
bydate=collections.defaultdict(list)
for rows in csvs.values():
 byid=collections.defaultdict(list)
 for r in rows:byid[r.get("race_id","")].append(r)
 for rid,rr in byid.items():
  d=date_from_id(rid)
  if d in dates and len(rr) in (7,9) and category(rr) in TARGET_GRADES:
   bydate[(d,int(rid[-4:]))].append((rid,rr))
picked=[]
for day,body in sorted(dates.items()):
 for race in body.get("races",[]):
  es=race.get("entries") or []
  if len(es) not in (7,9) or race.get("is_girls"):continue
  if group_from_position(es) is None:continue
  candidates=[(rid,rr) for rid,rr in bydate.get((day,int(race.get("race_number",0))),[]) if join_names(rr,es)]
  if len(candidates)!=1:continue
  rid,rr=candidates[0];kind=category(rr)
  if kind not in TARGET_GRADES:continue
  slug=rr[0].get("venue_slug","")
  if not re.fullmatch(r"[a-z-]{3,30}",slug):continue
  picked.append({"id":rid,"date":day,"class":kind,"slug":slug,"baseline":group_from_position(es)})
# Fair deterministic balancing across class/period by SHA256 (not result-dependent)
by_grade=collections.defaultdict(list)
for p in picked:by_grade[p["class"]].append(p)
selected=[];used=set()
for cl in sorted(TARGET_GRADES):
 ordered=sorted(by_grade[cl],key=lambda x:hashlib.sha256((x["id"]+"|line-crossvalidate-v1").encode()).hexdigest())
 for r in ordered[:4]:
  if r["id"] not in used:selected.append(r);used.add(r["id"])
selected=selected[:LIMIT]
rp=robotparser.RobotFileParser()
try:
 rp.parse(get(KD+"/robots.txt",100000).decode("utf-8",errors="replace").splitlines())
 permitted=True
except Exception as e:permitted=False;errs["robots"]=str(e)[:200]
records=[]
for r in selected:
 url=f"{KD}/{r['slug']}/racedetail/{r['id']}/"
 row={"race_id":r["id"],"date":r["date"],"category":r["class"]}
 if not permitted or not rp.can_fetch(UA,url):
  row["status"]="robots_unverified_or_denied";records.append(row);continue
 try:
  b=get(url);groups=parse_groups(b.decode("utf-8",errors="replace"))
  expected=r["baseline"]
  valid=(len([x for group in groups for x in group])==len(expected) and
         len(set(x for g in groups for x in g))==sum(map(len,expected)) and
         set(x for g in groups for x in g)==set(x for g in expected for x in g))
  if not valid:row.update({"status":"invalid_reconstructed_cars","source_line_count":len(groups)})
  else:
   ordered=(groups==expected)
   group_set=(sorted(map(tuple,groups))==sorted(map(tuple,expected)))
   row.update({"status":"valid_reconstructed_cars","same_ordered_lines":ordered,
       "same_line_members_and_positions":group_set,"cars":len([x for g in groups for x in g]),
       "lines_kdreams":len(groups),"lines_daily":len(expected)})
 except error.HTTPError as e:
  row.update({"status":"HTTP_"+str(e.code)})
  records.append(row)
  if e.code in (403,429):break
  continue
 except Exception as e:row.update({"status":"source_error","detail":str(e)[:140]})
 records.append(row);time.sleep(1.7)
out={"schema":"tk-keirin-cross-source-published-line-validation/v1",
     "source_1":"K-Dreams historical webpage, robots checked, 16 requests max",
     "source_2":"immutable public daily lineup JSON", "selection":"4 random-hash candidates by class, no payout/finish criteria",
     "source_commits":{"daily":GH_DAILY,"csv":GH_CSV},
     "requested":LIMIT,"selected":len(selected),"checked":len(records),
     "valid_rows":sum(x["status"]=="valid_reconstructed_cars" for x in records),
     "same_line_members_and_positions":sum(x.get("same_line_members_and_positions") is True for x in records),
     "same_ordered_lines":sum(x.get("same_ordered_lines") is True for x in records),
     "class_sample_counts":dict(collections.Counter(x["class"] for x in selected)),
     "status_counts":dict(collections.Counter(x["status"] for x in records)),
     "races":records,"limits":["Only 8 published archive days and <=16 historical K-Dreams pages, not representative of year",
      "Team predictions from each vendor can legitimately differ; mismatched lines aren't necessarily parser defects",
      "Provider terms must permit any future bulk extraction; this script alone does not authorize it"]}
p=pathlib.Path("reports/year-race-type/line-crossprovider-16-check.json")
p.parent.mkdir(exist_ok=True,parents=True)
p.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n")
print("LINE_CROSSPROVIDER",json.dumps({k:out[k] for k in ("selected","checked","valid_rows","same_line_members_and_positions","same_ordered_lines","class_sample_counts","status_counts")},ensure_ascii=False))
