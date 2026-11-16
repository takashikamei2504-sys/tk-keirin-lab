#!/usr/bin/env python3
"""Read-only source quality probe for 1-year race-type replay (no model evaluation)."""
import csv, json, urllib.request, io, collections
months=["2025_11","2026_01","2026_06","2026_10","2026_11"]
results={}
for month in months:
    url=f"https://raw.githubusercontent.com/Kenseimk/keirin-data/main/keirin_data/{month}_keirin.csv"
    with urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"TK-Keirin-research"}),timeout=45) as res:
        txt=res.read().decode("utf-8-sig",errors="replace")
    rows=list(csv.DictReader(io.StringIO(txt)))
    keys=list(rows[0]) if rows else []
    sample=rows[:2]
    by_race=collections.defaultdict(list)
    for r in rows: by_race[str(r.get("race_id",""))].append(r)
    same_sample=list(by_race.items())[:3]
    results[month]={"bytes":len(txt.encode()),"header":keys,"rows":len(rows),"races":len(by_race),"sample":sample,
                    "race_sample":[{"id":k,"rows":v[:2],"row_count":len(v)} for k,v in same_sample],
                    "dates":dict(collections.Counter(r.get("date","") for r in rows).most_common(3)),
                    "payout_samples":list(dict.fromkeys(str(r.get("payout","")) for r in rows))[:25],
                    "grade_samples":list(dict.fromkeys(str(r.get("player_class","")) for r in rows))[:15],
                    "line_samples":list(dict.fromkeys(str(r.get("lineup","")) for r in rows))[:15]}
print(json.dumps({k:{kk:(v[:2] if kk in ["race_sample"] else v) for kk,v in d.items()} for k,d in results.items()},ensure_ascii=False,indent=2)[:24000])
with open("reports/year-race-type/probe.json","w") as f: json.dump(results,f,ensure_ascii=False,indent=2)

# Check actual meeting_day values and raw round names on 4 archived dates.
for date in ("2026-08-20","2026-09-10","2026-10-15","2026-11-05"):
    try:
        u=f"https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/{date}.json"
        with urllib.request.urlopen(u,timeout=30) as resp: b=json.load(resp)
        venues=b.get("venue_info",{})
        print("RACE_META",date, json.dumps({
             "venue_info":{v:{"meeting_day":d.get("meeting_day"),"keys":list(d.keys())[:8]} for v,d in list(venues.items())[:12]},
             "round_counts":dict(collections.Counter(str(x.get("round_name","")) for x in b.get("races",[])))},
             ensure_ascii=False))
    except Exception as e: print("META_ERROR",date,str(e))
