#!/usr/bin/env python3
"""Bounded independent historical program-name validation (<=50 pages, 1.6s interval).
Do not scrape unbounded pages; obey robots.txt and stop on access restriction.
This verifies stage LABELS only. Never infer missing racing lineups from title.
"""
import datetime,html,json,pathlib,re,collections,time,unicodedata
from urllib import request,error,robotparser
from html.parser import HTMLParser
ROOT="https://keirin0.com"
UA="TK-Keirin-Lab-Research/1.0 (+https://github.com/takashikamei2504-sys/tk-keirin-lab; bounded archive QA)"
IN=pathlib.Path("reports/year-race-type/crossyear-stage-sample.json")
OUT=pathlib.Path("reports/year-race-type/crossyear-stage-title-validation.json")
out={"schema":"tk-keirin-crossyear-stage-independent-title-qa/v1",
     "source":ROOT,"sample":str(IN),"rules_status":None,
     "count":None,"results":[],"limitations":["This confirms only program labels, never lineup, betting model performance or ROI.","Published third-party title metadata may have errors."]}
class GetTitle(HTMLParser):
    def __init__(self):
        super().__init__();self.active=False;self.title=[]
    def handle_starttag(self,tag,attrs):
        if tag.lower()=="title":self.active=True
    def handle_endtag(self,tag):
        if tag.lower()=="title":self.active=False
    def handle_data(self,data):
        if self.active:self.title.append(data)
def normalize(text):
    return unicodedata.normalize("NFKC",html.unescape(text or ""))
def title_stage(title):
    name=normalize(title).split(" - ")[0]
    # Order is critical: 準決勝 contains 決勝, 初特選 contains 特選.
    if re.search(r"初特選|初日特選",name):return "初日特選"
    if re.search(r"準決|準々決|二次予選|一予|予選|勝上",name):return "勝ち上がり戦"
    if re.search(r"決勝",name):return "決勝"
    if re.search(r"特選|特秀|特優|特別選抜",name):return "特選等"
    if re.search(r"一般|特般|選抜|順位決定|敗者",name):return "敗者戦"
    return "不明"
assert title_stage("2026年11月5日 四日市 第12R Ｓ級初特選 - 競輪新聞")=="初日特選"
assert title_stage("2026年11月6日 四日市 第12R Ｓ級準決勝 - 競輪新聞")=="勝ち上がり戦"
assert title_stage("2026年11月8日 四日市 第12R Ｓ級決勝 - 競輪新聞")=="決勝"
try:
    manifest=json.loads(IN.read_text())
    rows=manifest.get("races",[])
    if manifest.get("schema")!="tk-keirin-crossyear-stage-audit-sample/v1" or not(1<=len(rows)<=50):
        raise ValueError("Manifest missing or too many pages")
except Exception as e:
    raise RuntimeError("No audited manifest: "+str(e))
out["count"]=len(rows)
rp=robotparser.RobotFileParser()
try:
    with request.urlopen(request.Request(ROOT+"/robots.txt",headers={"User-Agent":UA}),timeout=20) as response:
        robots=response.read(100000).decode("utf-8",errors="replace")
    rp.parse(robots.splitlines())
    out["rules_status"]="verified"
except Exception as e:
    out["rules_status"]="unverified:"+str(e)[:180]
for i,row in enumerate(rows):
    url=row["source_url"]
    item={"race_id":row["race_id"],"month":row["month"],"category":row["category"],
          "expected_stage":row["predicted_stage"],"date":row["date"],"url":url}
    if out["rules_status"]!="verified" or not url.startswith(ROOT+"/detail/"):
        item["status"]="skipped_rules_unverified_or_path";out["results"].append(item);continue
    if not rp.can_fetch(UA,url):
        item["status"]="skipped_robots_disallow";out["results"].append(item);continue
    try:
        with request.urlopen(request.Request(url,headers={"User-Agent":UA,"Accept-Language":"ja-JP,ja"}),timeout=20) as response:
            raw=response.read(150000)
            if response.status!=200:raise ValueError("Unsuccessful HTTP status")
        parser=GetTitle()
        parser.feed(raw.decode("utf-8",errors="replace"))
        title=normalize("".join(parser.title))
        year,month,day=map(int,row["date"].split("-"))
        match_date=f"{year}年{month}月{day}日" in title
        match_round=(re.search(rf"第0?{row['race_no']}R",title) is not None)
        detected=title_stage(title)
        item.update({"status":"ok" if match_date and match_round and detected!="不明" else "identity_or_round_invalid",
                     "title_stage":detected,"title_date_match":match_date,"title_round_match":match_round,
                     "title_excerpt":title[:125],
                     "correct":detected==row["predicted_stage"] if match_date and match_round and detected!="不明" else None})
    except error.HTTPError as e:
        item.update({"status":"http_error","error":"HTTP "+str(e.code)})
        if e.code in (403,429):
            out["results"].append(item)
            out["limits_blocker"]="Provider rate/access restriction; stopped further requests"
            break
    except Exception as e:
        item.update({"status":"error","error":str(e)[:160]})
    out["results"].append(item)
    if i<len(rows)-1:time.sleep(1.6)
evaluated=[r for r in out["results"] if r.get("status")=="ok"]
correct=sum(r["correct"] is True for r in evaluated)
out["overall"]={"requested":len(rows),"attempted":len(out["results"]),
    "evaluated":len(evaluated),"correct":correct,
    "precision":round(correct/len(evaluated),4) if evaluated else None,
    "status_counts":dict(collections.Counter(r["status"] for r in out["results"]))}
out["by_stage"]={}
for name in sorted({r["expected_stage"] for r in out["results"]}):
    rs=[r for r in evaluated if r["expected_stage"]==name]
    n=len(rs);hits=sum(x["correct"] is True for x in rs)
    out["by_stage"][name]={"evaluated":n,"correct":hits,
                          "precision":round(hits/n,4) if n else None}
out["by_class"]={}
for name in sorted({r["category"] for r in out["results"]}):
    rs=[r for r in evaluated if r["category"]==name]
    n=len(rs);hits=sum(x["correct"] is True for x in rs)
    out["by_class"][name]={"evaluated":n,"correct":hits,
                          "precision":round(hits/n,4) if n else None}
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("CROSSYEAR_SOURCE_LABEL_QA",json.dumps({"overall":out["overall"],"stages":out["by_stage"],"class":out["by_class"],"limits_blocker":out.get("limits_blocker")},ensure_ascii=False))
