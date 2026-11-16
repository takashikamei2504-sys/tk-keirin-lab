#!/usr/bin/env python3
"""Bounded 2025-26 K-Dreams lineup pilot; published lineup hypothesis, NOT actual on-track formation.

Parses precisely span.icon_p.space as a separator and span.p00[1-9] as car number.
All requests must pass robots.txt. The annual study manifest was selected without payout/results.
One extra S9 race per historical calendar month chosen by hash to verify 9-car handling.
No HTML or participant full tables are written.
"""
import csv,json,pathlib,re,collections,datetime,hashlib,concurrent.futures,time,io
from html.parser import HTMLParser
from urllib import request,error,robotparser
ROOT=pathlib.Path("reports/year-race-type")
MANIFEST=ROOT/"crossyear-stage-sample.json"
OUTPUT=ROOT/"historical-lineup-pilot-202511-202608.json"
ARCHIVE="https://raw.githubusercontent.com/Kenseimk/keirin-data/main/keirin_data/{}_keirin.csv"
DOMAIN="https://keirin.kdreams.jp"
UA="TK-Keirin-Lab-Research/1.0 (+https://github.com/takashikamei2504-sys/tk-keirin-lab; bounded academic QA)"
MONTHS=[f"{y}_{m:02d}" for y,m in [(2025,11),(2025,12)]+[(2026,m) for m in range(1,9)]]
def download(url,limit=1500000):
    with request.urlopen(request.Request(url,headers={"User-Agent":UA,"Accept-Language":"ja-JP,ja;q=0.9"}),timeout=25) as res:
        return res.read(limit),res.status
def fetch_csv(month):
    raw,_=download(ARCHIVE.format(month),8000000)
    return month,list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))),hashlib.sha256(raw).hexdigest()
def normalized_date(rid):
    try:
        d=datetime.date(int(rid[2:6]),int(rid[6:8]),int(rid[8:10]))
        day=int(rid[10:12])
        if day<1 or day>5:return None
        return (d+datetime.timedelta(days=day-1)).isoformat()
    except Exception:return None
class Lineup(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.on=False;self.depth=0;self.spans=[];self.levels=[];self.pending_car=None
    def handle_starttag(self,tag,attrs):
        c=dict(attrs).get("class","").split()
        if not self.on:
            if tag=="div" and "line_position" in c:self.on=True;self.depth=0
            return
        self.depth+=1
        if tag!="span":return
        if "icon_p" in c and "space" in c:
            self.spans.append({"kind":"space"})
        if len(c)==1 and re.fullmatch(r"p00[1-9]",c[0]):
            self.pending_car=int(c[0][-1])
            self.spans.append({"kind":"car","no":self.pending_car})
    def handle_endtag(self,tag):
        if self.on:
            self.depth-=1
            if self.depth<0:self.on=False
def parse(html):
    p=Lineup();p.feed(html)
    groups=[];group=[]
    for item in p.spans:
        if item["kind"]=="space":
            if group:groups.append(group);group=[]
        elif item["kind"]=="car":group.append(item["no"])
    if group:groups.append(group)
    return groups,p.spans
def shape_check(groups,cars):
    flat=[c for g in groups for c in g]
    return bool(groups) and len(flat)==len(cars) and len(set(flat))==len(flat) and set(flat)==set(cars) and all(len(g)>=1 for g in groups)
source_hashes={};by_id=collections.defaultdict(list);errors={}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    futures={pool.submit(fetch_csv,m):m for m in MONTHS}
    for f in concurrent.futures.as_completed(futures):
        try:
            month,arr,sha=f.result()
            source_hashes[month]=sha
            for r in arr:by_id[str(r.get("race_id"))].append(r)
        except Exception as e:errors[futures[f]]="CSV "+str(e)[:160]
if errors:raise RuntimeError("Missing monthly CSV sources: "+str(errors))
manifest=json.loads(MANIFEST.read_text())
if manifest.get("sample_n")!=50:raise RuntimeError("Unexpected stage manifest")
samples=[{"id":r["race_id"],"date":r["date"],"stage":r["predicted_stage"],"category":r["category"],"source":"stratified_stage_50"} for r in manifest["races"]]
for month in MONTHS:
    avail=[]
    for rid,rows in by_id.items():
        if normalized_date(rid) is None:continue
        if normalized_date(rid)[:7].replace("-","_")!=month:continue
        cars={r.get("banum") for r in rows}
        if len(cars)!=9:continue
        if not any(str(r.get("player_class","")).startswith("S") for r in rows):continue
        if len(cars)!=len(rows):continue
        avail.append(rid)
    if not avail:continue
    rid=min(avail,key=lambda x:hashlib.sha256((x+"|s9-line-validation-v1").encode()).hexdigest())
    samples.append({"id":rid,"date":normalized_date(rid),"stage":"未確定","category":"S級_9","source":"yearly_9car_10"})
robots=robotparser.RobotFileParser()
try:
    b,_=download(DOMAIN+"/robots.txt",100000)
    robots.parse(b.decode("utf-8",errors="replace").splitlines())
    robots_verified=True
except Exception as e:
    robots_verified=False;errors["robots"]=str(e)[:200]
summary={"schema":"tk-keirin-historical-kdreams-lineup-pilot/v1",
  "dates":"2025-11-16 to 2026-08-17","robots_verified":robots_verified,"source_csv_sha256":source_hashes,
  "sample_definition":"50 outcome-independent class-stage stratified plus 10 9-car checksum candidates, one per historical month",
  "source":"K-Dreams archived pre-race lineup predictions; NOT objectively known actual lineups",
  "races":[],"errors":errors}
if robots_verified:
    for i,ex in enumerate(samples):
        rid=ex["id"];rr=by_id.get(rid,[])
        distinct={}
        for r in rr:
            key=r.get("banum")
            if key in distinct and distinct[key].get("player_name")!=r.get("player_name"):
                distinct={};break
            distinct[key]=r
        row={"race_id":rid,"date":ex["date"],"inferred_stage":ex["stage"],
             "category":ex["category"],"source_selection":ex["source"]}
        if not distinct or len(distinct) not in (7,9):
            row["status"]="invalid_csv_riders";summary["races"].append(row);continue
        slug=next((r.get("venue_slug") for r in rr if r.get("venue_slug")),"")
        url=f"{DOMAIN}/{slug}/racedetail/{rid}/"
        row.update({"source_url":url,"cars":len(distinct)})
        if not re.fullmatch("[a-z-]{3,30}",slug) or not robots.can_fetch(UA,url):
            row["status"]="source_url_invalid_or_robots_denied"
            summary["races"].append(row);continue
        try:
            raw,status=download(url)
            if status!=200:raise ValueError(f"HTTP status {status}")
            group,spans=parse(raw.decode("utf-8",errors="replace"))
            valid=shape_check(group,{int(k) for k in distinct})
            if valid:
                row["status"]="reconstructed"
                row["line_groups"]=group
                row["line_position"]={str(no):f"{li}-{pos}" for li,g in enumerate(group,1) for pos,no in enumerate(g,1)}
            else:
                row["status"]="unresolved"
                row["no_car_icons"]=sum(x["kind"]=="car" for x in spans)
                row["separator_icons"]=sum(x["kind"]=="space" for x in spans)
        except error.HTTPError as e:
            row.update({"status":"http_"+str(e.code)})
            if e.code in (403,429):
                summary["races"].append(row);summary["access_blocker"]=e.code
                break
        except Exception as e:
            row.update({"status":"error","error":str(e)[:140]})
        summary["races"].append(row)
        if i<len(samples)-1:time.sleep(1.5)
summary["counts"]=dict(collections.Counter(x["status"] for x in summary["races"]))
summary["by_category"]=dict(collections.Counter(x["category"] for x in summary["races"] if x["status"]=="reconstructed"))
summary["by_stage"]=dict(collections.Counter(x["inferred_stage"] for x in summary["races"] if x["status"]=="reconstructed"))
summary["sample_n"]=len(samples)
OUTPUT.write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n")
print("ANNUAL_LINEUP_PILOT",json.dumps({"sample_n":summary["sample_n"],"counts":summary["counts"],
    "by_category":summary["by_category"],"by_stage":summary["by_stage"],
    "errors":summary["errors"],"samples":summary["races"][:7]},ensure_ascii=False)[:12500],flush=True)
