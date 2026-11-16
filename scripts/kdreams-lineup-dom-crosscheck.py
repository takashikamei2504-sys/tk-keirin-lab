#!/usr/bin/env python3
"""3-page protected K-Dreams lineup DOM structure study; verify against genuine 2026 data."""
from html.parser import HTMLParser
from urllib import request,robotparser,error
import time,json,pathlib,re,collections
BASE="https://keirin.kdreams.jp"
RACES=[
 ("2025-11-02 岸和田8R",BASE+"/kishiwada/racedetail/5620251101020008/",None),
 ("2025-11-29 岸和田5R",BASE+"/kishiwada/racedetail/5620251127030005/",None),
 ("2026-08-18 豊橋1R",BASE+"/toyohashi/racedetail/4520260818010001/","2026-08-18"),
]
UA="TK-Keirin-Lab-Research/1.0 (+https://github.com/takashikamei2504-sys/tk-keirin-lab)"
class Trace(HTMLParser):
 def __init__(self):
  super().__init__(convert_charrefs=True)
  self.depth=0;self.events=[];self.cards=[];self.in_line=False;self.line_depth=0
 def handle_starttag(self,tag,attrs):
  attrs=dict(attrs);name=attrs.get("class","")
  if self.in_line:
   self.line_depth+=1
   if len(self.events)<250:self.events.append({"type":"start","tag":tag,"class":name[:90],"other":{k:v[:80] for k,v in attrs.items() if k in ("style","id")}})
  elif tag=="div" and "line_position" in name.split():
   self.in_line=True;self.line_depth=0
   self.events.append({"type":"line_start","class":name})
 def handle_endtag(self,tag):
  if self.in_line:
   if len(self.events)<250:self.events.append({"type":"end","tag":tag})
   if self.line_depth<=0:self.in_line=False
   else:self.line_depth-=1
 def handle_data(self,x):
  if self.in_line:
   z=x.strip()
   if len(self.events)<250 and z:self.events.append({"type":"data","value":z[:65]})
def fetch(url,robots):
 if not robots.can_fetch(UA,url):return None,"robots_disallow"
 req=request.Request(url,headers={"User-Agent":UA,"Accept-Language":"ja-JP,ja"})
 try:
  with request.urlopen(req,timeout=22) as res:return res.read(1300000).decode("utf-8",errors="replace"),str(res.status)
 except error.HTTPError as e:return None,"http_"+str(e.code)
 except Exception as e:return None,type(e).__name__+":"+str(e)[:120]
robot=robotparser.RobotFileParser()
result={"schema":"tk-kdreams-lineup-structure-crosscheck/v1","source":BASE,"races":[]}
try:
 with request.urlopen(request.Request(BASE+"/robots.txt",headers={"User-Agent":UA}),timeout=15) as res:
  raw=res.read(100000).decode("utf-8",errors="replace")
 robot.parse(raw.splitlines());result["robots"]="verified"
except Exception as e:result["robots"]="unverified:"+str(e)[:100]
baseline={}
if result["robots"]=="verified":
 try:
  with request.urlopen(request.Request("https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/2026-08-18.json",headers={"User-Agent":UA}),timeout=25) as res:
   body=json.load(res)
  for r in body.get("races",[]):
   if r.get("venue")=="豊橋" and r.get("race_number")==1:
    baseline={"published_round":r.get("round_name"),
              "line_position_map":{str(e.get("car_number")):e.get("line_position") for e in r.get("entries",[])}}
    break
 except Exception as e:result["baseline_error"]=str(e)[:150]
for name,url,dt in RACES:
 out={"name":name,"url":url}
 if result["robots"]!="verified":out["status"]="robots_unverified"
 else:
  body,status=fetch(url,robot)
  out["status"]=status
  if body:
   p=Trace();p.feed(body)
   out.update({"line_position_divs":sum(e["type"]=="line_start" for e in p.events),
             "events":p.events[:170],
             "cars":[e["value"] for e in p.events if e["type"]=="data" and re.fullmatch(r"[1-9]",e["value"])]})
 if dt:out["independent_2026_lineup"]=baseline
 result["races"].append(out)
 time.sleep(2)
folder=pathlib.Path("reports/year-race-type");folder.mkdir(parents=True,exist_ok=True)
(folder/"kdreams-lineup-dom-crosscheck.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
print("CROSSCHECK",json.dumps({"robots":result["robots"],"race_results":[{"name":x["name"],"status":x["status"],"cars":x.get("cars"),"baseline":x.get("independent_2026_lineup"),"events":x.get("events",[])[:95]} for x in result["races"]]},ensure_ascii=False)[:14500])
