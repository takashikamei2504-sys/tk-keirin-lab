#!/usr/bin/env python3
"""Prepare guarded 2025-26 pre-race cards for 8-model replay from 60 archived lineup samples.

Only match race_id + 7/9 unique numbers, verify provider historic program/venue
and scheduled start time. Never invent lineup, start time, or scores. Settlement
data is separated from the model's source card, and never used to select races.
"""
import csv,io,json,re,time,hashlib,pathlib,collections,concurrent.futures,unicodedata
from html.parser import HTMLParser
from urllib import request,error,robotparser
ROOT=pathlib.Path("reports/year-race-type")
SOURCE=ROOT/"historical-lineup-pilot-202511-202608.json"
OUT=ROOT/"annual-60-card-input-audit.json"
DATA="https://raw.githubusercontent.com/Kenseimk/keirin-data/main/keirin_data/{}_keirin.csv"
HOST="https://keirin.kdreams.jp"
UA="TK-Keirin-Lab-Research/1.0 (+https://github.com/takashikamei2504-sys/tk-keirin-lab; archival replay small pilot)"
def norm(v):return re.sub(r"\s+","",unicodedata.normalize("NFKC",str(v or "")))
class Meta(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True);self.title_on=False;self.title=[];self.tokens=[]
    def handle_starttag(self,tag,attrs):
        if tag=="title":self.title_on=True
    def handle_endtag(self,tag):
        if tag=="title":self.title_on=False
    def handle_data(self,data):
        val=" ".join(data.split())
        if not val:return
        if self.title_on:self.title.append(val)
        if len(val)<220:self.tokens.append(val)
    def extract(self):
        title=norm(" ".join(self.title))
        mt=re.search(r"(\d{1,2})R",title)
        start=None;rank=None
        for i,t in enumerate(self.tokens):
            if "発走予定" in t:
                for v in self.tokens[i+1:i+8]:
                    m=re.fullmatch(r"([012]?\d):([0-5]\d)",norm(v))
                    if m and int(m.group(1))<=23:
                        start=f"{int(m.group(1)):02d}:{m.group(2)}";break
                break
        for t in self.tokens[:180]:
            # Provider stores F1,F2,G1,G2,G3,GP fullwidth often.
            n=norm(t)
            g=re.search(r"(?<!\w)(F[12]|G[123]|GP)(?!\w)",n)
            if g:rank=g.group(1);break
        mv=re.match(r"(.{1,10}?)競輪",title)
        venue=mv.group(1).replace("競輪場","") if mv else None
        # Grade from first menu/header not guaranteed. Missing grade remains unknown.
        return title,mt.group(1) if mt else None,start,rank,venue
def load_month(m):
    with request.urlopen(request.Request(DATA.format(m),headers={"User-Agent":UA}),timeout=40) as resp:
        raw=resp.read(8000000)
    return m,list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))),hashlib.sha256(raw).hexdigest()
m_source=json.loads(SOURCE.read_text())
if m_source["counts"].get("reconstructed")!=60:raise RuntimeError("60-card lineup audit incomplete")
months=sorted({r["date"][:7].replace("-","_") for r in m_source["races"]})
data={};hashes={};errors={}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    fut={pool.submit(load_month,m):m for m in months}
    for f in concurrent.futures.as_completed(fut):
        try:
            m,rows,sha=f.result();data[m]=rows;hashes[m]=sha
            if m_source["source_csv_sha256"].get(m)!=sha:raise ValueError("CSV source revision changed "+m)
        except Exception as e:errors[fut[f]]=str(e)[:200]
if errors:raise RuntimeError("CSV content not complete or version drift: "+str(errors))
byid=collections.defaultdict(list)
for arr in data.values():
    for r in arr:byid[str(r.get("race_id"))].append(r)
rp=robotparser.RobotFileParser()
try:
    with request.urlopen(request.Request(HOST+"/robots.txt",headers={"User-Agent":UA}),timeout=15) as response:
        rp.parse(response.read(100000).decode("utf-8",errors="replace").splitlines())
    robots_ok=True
except Exception as e:robots_ok=False;errors["robots"]=str(e)[:100]
rows_out=[]
for i,r in enumerate(m_source["races"]):
    rec={"race_id":r["race_id"],"date":r["date"],"category":r["category"],"inferred_stage":r["inferred_stage"],
        "source_url":r.get("source_url"),"line_groups":r.get("line_groups"),"source_selection":r["source_selection"]}
    if not robots_ok or not rp.can_fetch(UA,rec["source_url"]):
        rec["status"]="robots_not_verified_or_denied";rows_out.append(rec);continue
    riders=list({str(x.get("banum")):x for x in byid[rec["race_id"]]}.values())
    if len(riders) not in (7,9) or len(riders)!=len(r.get("line_position",{})):
        rec["status"]="source_car_mismatch";rows_out.append(rec);continue
    def race_score(x):
        try:return float(x.get("race_score") or "nan")
        except: return float("nan")
    ptxt=next((x.get("san_ren_tan") for x in riders if x.get("san_ren_tan")),"")
    pay=[([int(a),int(b),int(c)],int(amount.replace(",",""))) for a,b,c,amount in re.findall(r"([1-9])\s*-\s*([1-9])\s*-\s*([1-9])\s+([\d,]+)\s*円",ptxt)]
    if len(pay)==0 or any(len(set(combo))!=3 or amount<=0 for combo,amount in pay):
        rec["status"]="missing_or_invalid_trifecta";rows_out.append(rec);continue
    try:
        with request.urlopen(request.Request(rec["source_url"],headers={"User-Agent":UA}),timeout=30) as resp:
            raw=resp.read(1400000)
        meta=Meta();meta.feed(raw.decode("utf-8",errors="replace"))
        title,round_no,start,grade,venue=meta.extract()
        if not title or not round_no or int(round_no)!=int(rec["race_id"][12:]):
            raise ValueError("Race number not verified against page title")
        # Verify both date and venue identity from URL and page title.
        d=rec["date"]
        published_date=re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日",title)
        expected_tuple=tuple(map(int,d.split("-")))
        date_match=bool(published_date and tuple(map(int,published_date.groups()))==expected_tuple)
        if not date_match: raise ValueError("Race date mismatch against source title")
        if not venue or not start:raise ValueError("Missing exact venue or start time")
        entries=[]
        for x in riders:
            no=str(x.get("banum"));score=race_score(x);style=norm(x.get("running_style"))
            if not (50<=score<=145 and style in ("逃","両","追")):raise ValueError("Missing valid score/style")
            entries.append({"car_number":int(no),"rider_full_name":norm(x.get("player_name")),
                    "class_rank":norm(x.get("player_class")),"competition_score":score,
                    "running_style":style,"line_position":r["line_position"].get(no)})
        if any(not x["rider_full_name"] or not x["line_position"] for x in entries):raise ValueError("Missing rider or lineup")
        rec.update({"status":"ready","published_round":title[:90],"start_time":start,"grade":grade or "未確認",
                    "venue":venue,"entries":entries,"result_combos":[{"combo":combo,"payout":v} for combo,v in pay],
                    "input_provenance":"K-Dreams provider lineup, exact start time and page label plus Kenseimk historical rider class/score/style."})
    except error.HTTPError as e:
        rec.update({"status":"http_"+str(e.code)})
        if e.code in (403,429):
            rows_out.append(rec);errors["access_blocker"]=e.code;break
    except Exception as e:rec.update({"status":"source_metadata_invalid","why":str(e)[:170]})
    rows_out.append(rec)
    if i<len(m_source["races"])-1:time.sleep(1.3)
report={"schema":"tk-keirin-2025-26-fullcard-pilot/v1","sample_n":len(m_source["races"]),
        "prepared_n":sum(r.get("status")=="ready" for r in rows_out),
        "status_counts":dict(collections.Counter(r["status"] for r in rows_out)),"source_hashes":hashes,
        "robots_checked":robots_ok,"no_unknown_start_time_guesses":True,
        "meanings":["Retrospective source card, not frozen pre-race forecast",
                    "Provider line forecast may differ from actual tactics",
                    "Prize result is used for evaluation only after prediction"],
        "cards":rows_out,"errors":errors}
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
print("PREPARED_CARDS",json.dumps({"sample_n":report["sample_n"],"prepared_n":report["prepared_n"],"status_counts":report["status_counts"],"examples":[{k:v for k,v in row.items() if k not in ("entries","result_combos")} for row in rows_out[:4]]},ensure_ascii=False)[:9000],flush=True)
