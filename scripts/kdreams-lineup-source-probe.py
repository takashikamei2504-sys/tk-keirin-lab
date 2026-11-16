#!/usr/bin/env python3
"""Respectful 3-page K-Dreams historical lineup HTML structure probe.
Only derived DOM paths/brief text tags written; no raw HTML or mass scrape.
"""
import urllib.request,urllib.error,urllib.robotparser,datetime,time,json,hashlib,re,pathlib
from html.parser import HTMLParser
BASE="https://keirin.kdreams.jp"
UA="TK-Keirin-Lab/1.0 (+research-only; https://github.com/takashikamei2504-sys/tk-keirin-lab)"
PAGES=[
 {"year":"2025","race":"岸和田2025-11-02 8R","url":BASE+"/kishiwada/racedetail/5620251101020008/"},
 {"year":"2025","race":"岸和田2025-11-29 5R","url":BASE+"/kishiwada/racedetail/5620251127030005/"},
 {"year":"2026","race":"岸和田2026-08-20 8R","url":BASE+"/kishiwada/racedetail/5620260818010008/"}
]
class DOM(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack=[];self.tokens=[];self.markers=[];self.details=[];self.classes={}
        self.next_index=0;self.active=False;self.count=0;self.capture=[]
    def handle_starttag(self,t,attrs):
        a=dict(attrs)
        frag=t
        if a.get("id"):frag+="#"+a["id"][:70]
        if a.get("class"):frag+="."+a["class"][:100].replace(" ",".")
        self.stack.append((t,frag))
        if any(s in (a.get("class") or "").lower() for s in ("line","narabi","prediction","race")):
            key=frag[:120];self.classes[key]=self.classes.get(key,0)+1
    def handle_startendtag(self,t,attrs):pass
    def handle_endtag(self,t):
        if not self.stack:return
        for i in range(len(self.stack)-1,-1,-1):
            if self.stack[i][0]==t:
                self.stack=self.stack[:i];break
    def handle_data(self,data):
        x=" ".join(data.split())
        if not x or len(x)>400:return
        key=" / ".join(f for _,f in self.stack[-6:])
        if "並び予想" in x or "予想・周回・戦法" in x or "選手コメント" in x:
            self.markers.append({"word":x[:80],"path":key[:400],"token_position":self.count})
            if "並び予想" in x:self.active=True;self.next_index=0
        if self.active and self.next_index<90:
            self.capture.append({"t":x[:100],"path":key[:210],"i":self.next_index})
            self.next_index+=1
        self.count+=1
def run():
    rp=urllib.robotparser.RobotFileParser()
    report={"schema":"tk-kdreams-lineup-html-3page-probe/v1",
       "research_only":True,"source":BASE,"tested_pages":[]}
    try:
        req=urllib.request.Request(BASE+"/robots.txt",headers={"User-Agent":UA})
        with urllib.request.urlopen(req,timeout=18) as f:
            rules=f.read(150000).decode("utf-8",errors="replace")
        rp.parse(rules.splitlines());report["robots"]="verified"
    except Exception as e:
        report["robots"]="unverified:"+repr(e)[:220]
    for i,p in enumerate(PAGES):
        row={"race":p["race"],"url":p["url"]}
        if report["robots"]!="verified":
            row["status"]="robots_unverified_skip";report["tested_pages"].append(row);continue
        if not rp.can_fetch(UA,p["url"]):
            row["status"]="robots_disallow_skip";report["tested_pages"].append(row);continue
        try:
            req=urllib.request.Request(p["url"],headers={"User-Agent":UA,"Accept-Language":"ja-JP,ja;q=0.9"})
            with urllib.request.urlopen(req,timeout=30) as f:
                raw=f.read(1300000);status=f.status
            h=raw.decode("utf-8",errors="replace")
            parser=DOM();parser.feed(h)
            row.update({"status":status,"byte_count":len(raw),"sha256":hashlib.sha256(raw).hexdigest(),
                "has_lineup_label":bool(parser.capture),"page_marker_count":len(parser.markers),
                "markers":parser.markers[:12],"around_lineup":parser.capture[:75],
                "line_related_classes":sorted(parser.classes.items(),key=lambda p:-p[1])[:45],
                "text_token_count":parser.count,
                "disclaimer":"DOM path and small original label tokens for parser development, no HTML/raw page stored."})
        except urllib.error.HTTPError as e:
            row.update({"status":"http_error","code":e.code})
            if e.code in (403,429):
                report["tested_pages"].append(row)
                report["stopped_on_access_restriction"]=True
                break
        except Exception as e:row.update({"status":"error","error":repr(e)[:200]})
        report["tested_pages"].append(row)
        if i<len(PAGES)-1:time.sleep(3)
    out=pathlib.Path("reports/year-race-type/kdreams-lineup-source-pilot.json")
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("LINEUP_SOURCE_PILOT",json.dumps({"robots":report["robots"],"pages":[{"race":x["race"],"status":x["status"],"has_lineup_label":x.get("has_lineup_label"),"matches":x.get("markers",[])[:3],"head":x.get("around_lineup",[])[:30],"classes":x.get("line_related_classes",[])[:15]} for x in report["tested_pages"]]},ensure_ascii=False))
if __name__=="__main__":run()
