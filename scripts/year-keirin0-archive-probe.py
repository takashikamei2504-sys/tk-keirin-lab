#!/usr/bin/env python3
"""Public archive availability probe (3 pages), robots/terms aware, no bulk download."""
from html.parser import HTMLParser
from urllib import request,robotparser,error
import re,json,hashlib,time,pathlib
BASE="https://keirin0.com"
URLS=[
    "/detail/20251213/20251215/22/01",
    "/detail/20260131/20260201/23/01",
    "/detail/20261105/20261105/48/12"
]
UA="TK-Keirin-Lab-Research/1.0 (private-use no bulk redistribution)"
class Extract(HTMLParser):
    def __init__(self):super().__init__();self.texts=[];self.title=False;self.titles=[]
    def handle_starttag(self,t,a):
        if t=="title":self.title=True
    def handle_endtag(self,t):
        if t=="title":self.title=False
    def handle_data(self,d):
        s=" ".join(d.strip().split())
        if not s:return
        if self.title:self.titles.append(s)
        self.texts.append(s)
out={"source":"keirin0.com","status":"probe only","rules":None,"pages":[]}
rp=robotparser.RobotFileParser()
try:
    with request.urlopen(request.Request(BASE+"/robots.txt",headers={"User-Agent":UA}),timeout=15) as r:rules=r.read(100000).decode("utf-8",errors="replace")
    rp.parse(rules.splitlines())
    out["rules"]="read"
except Exception as e:out["rules"]="unverified:"+str(e)[:150]
for path in URLS:
    url=BASE+path;row={"path":path}
    if out["rules"]!="read":
        row["status"]="skipped_rule_not_verified";out["pages"].append(row);continue
    if not rp.can_fetch(UA,url):
        row["status"]="skipped_robots_denied";out["pages"].append(row);continue
    try:
        with request.urlopen(request.Request(url,headers={"User-Agent":UA}),timeout=15) as r:
            raw=r.read(900000);row["http_status"]=r.status
        txt=raw.decode("utf-8",errors="replace");p=Extract();p.feed(txt)
        flat=" ".join(p.texts)
        row.update({"status":"fetched","sha256":hashlib.sha256(raw).hexdigest(),
             "bytes":len(raw),"title":" ".join(p.titles)[:130],
             "mentions_lineup":any(word in flat for word in ("並び予想","周回予想","並び","ライン")),
             "mentions_round":any(word in flat for word in ("初特選","決勝","準決勝","一般","予選")),
             "line_words":{w:flat.count(w) for w in ("並び予想","周回予想","並び","ライン","初特選")},
             "has_structured_json":("__NEXT_DATA__" in txt or "application/ld+json" in txt),
             "candidate_marker_count":len(re.findall(r'\d[=-]\d[=-]\d',flat)),
             "source_note":"HTML body not saved; user-generated/copyright data are not rehosted."})
    except Exception as e:row.update({"status":"http_error","error":str(e)[:250]})
    out["pages"].append(row)
    time.sleep(3)
p=pathlib.Path("reports/year-race-type/keirin0-archive-probe.json");p.parent.mkdir(parents=True,exist_ok=True)
p.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n")
print(json.dumps(out,ensure_ascii=False))
