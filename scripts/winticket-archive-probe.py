#!/usr/bin/env python3
"""Three public historical-card HTML probes; no bulk harvest or HTML redistribution."""
import urllib.request, urllib.parse, re, html, json, time, pathlib, hashlib, urllib.robotparser
BASE="https://www.winticket.jp"
USER_AGENT="TK-Keirin-Lab-Research/1.0 (+https://github.com/takashikamei2504-sys/tk-keirin-lab)"
URLS=[
 "/keirin/odawara/racecard/2025111336/4/12",
 "/keirin/nagoya/racecard/2025111642/1/1",
 "/keirin/odawara/racecard/2025111336/4/7"
]
rp=urllib.robotparser.RobotFileParser()
try:
    req=urllib.request.Request(BASE+"/robots.txt",headers={"User-Agent":USER_AGENT})
    with urllib.request.urlopen(req,timeout=15) as res: txt=res.read(400000).decode("utf-8",errors="replace")
    rp.parse(txt.splitlines());robots_ok=True
except Exception as e:
    robots_ok=False;robots_error=str(e)[:200]
rows=[]
for i,path in enumerate(URLS):
    url=BASE+path
    if robots_ok and not rp.can_fetch(USER_AGENT,url):
        rows.append({"path":path,"robots":"disallowed","status":"skipped"});continue
    if not robots_ok:
        rows.append({"path":path,"robots":"not_verified","status":"skipped","error":robots_error});continue
    try:
        req=urllib.request.Request(url,headers={"User-Agent":USER_AGENT,"Accept-Language":"ja-JP,ja;q=0.9"})
        with urllib.request.urlopen(req,timeout=20) as res:
            body=res.read(1200000).decode("utf-8",errors="replace")
            status=res.status
        title=re.search(r"<title[^>]*>(.*?)</title>",body,re.I|re.S)
        nextd=re.search(r'<script[^>]*id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',body,re.I|re.S)
        row={"path":path,"status":status,"length":len(body),"sha256":hashlib.sha256(body.encode()).hexdigest(),
             "title":html.unescape(re.sub(r"<[^>]+>","",title.group(1))) if title else None,
             "has_lineup_word":"並び予想" in body,"has_grade_word":"S級決勝" in body,
             "has_next_data":bool(nextd),"next_data_size":len(nextd.group(1)) if nextd else 0,
             "counts":{"raceCard":body.count("raceCard"),"lineup":body.count("lineup"),"line":body.count("line"),"round":body.count("round"),"initial_state":body.count("initialState")}}
        if nextd:
            try:
                root=json.loads(html.unescape(nextd.group(1)))
                row["next_keys"]=list(root.keys())
                props=root.get("props",{})
                row["props_keys"]=list(props.keys())
                row["pageProps_keys"]=list((props.get("pageProps") or {}).keys())[:40]
            except Exception as e:row["next_error"]=str(e)[:100]
        rows.append(row)
    except Exception as e:rows.append({"path":path,"status":"error","error":str(e)[:350]})
    if i<len(URLS)-1:time.sleep(3)
out={"schema":"winticket-archive-source-probe/v1","robots_verified":robots_ok,
     "robots_error":locals().get("robots_error"),"urls_checked":rows}
p=pathlib.Path("reports/year-race-type/winticket-archive-probe.json");p.parent.mkdir(exist_ok=True,parents=True)
p.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n")
print(json.dumps(out,ensure_ascii=False))
