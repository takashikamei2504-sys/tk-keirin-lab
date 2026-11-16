#!/usr/bin/env python3
"""Audit K-Dreams race ID encoded meeting start/date vs CSV date; never assume they agree."""
import csv,concurrent.futures,collections,datetime,io,json,pathlib,urllib.request
MONTHS=[f"2025_{m:02d}" for m in (11,12)]+[f"2026_{m:02d}" for m in range(1,12)]
URL="https://raw.githubusercontent.com/Kenseimk/keirin-data/main/keirin_data/{}_keirin.csv"
def load(m):
    with urllib.request.urlopen(urllib.request.Request(URL.format(m),headers={"User-Agent":"tk-keirin-lab-date-validation"}),timeout=45) as r: b=r.read()
    return m,list(csv.DictReader(io.StringIO(b.decode("utf-8-sig"))))
def classify(r):
    rid=str(r.get("race_id",""))
    if len(rid)!=16 or not rid.isdigit():return "invalid_race_id",None
    try:
        start=datetime.datetime.strptime(rid[2:10],"%Y%m%d").date()
        ordinal=int(rid[10:12])
        d=datetime.date.fromisoformat(str(r.get("date","")))
        if ordinal<1 or ordinal>5:return "ordinal_out_of_range",None
        race_date=start+datetime.timedelta(days=ordinal-1)
        kind="matches_inferred" if d==race_date else "matches_start" if d==start else "other_day"
        return kind,{"id":rid,"csv_date":str(d),"inferred_date":str(race_date),"meeting_start":str(start),"ordinal":ordinal,"difference":(d-race_date).days}
    except Exception:return "invalid_date",None
rows={};errors={}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    futures={pool.submit(load,m):m for m in MONTHS}
    for future in concurrent.futures.as_completed(futures):
        try:
            m,records=future.result();rows[m]=records
        except Exception as e:errors[futures[future]]=str(e)
monthly={};detailed={};totals=collections.Counter()
examples=collections.defaultdict(list)
for month,arr in sorted(rows.items()):
    seen={}
    for r in arr:seen[r.get("race_id")]=r
    stat=collections.Counter()
    byordinal=collections.defaultdict(collections.Counter)
    for r in seen.values():
        kind,detail=classify(r);stat[kind]+=1;totals[kind]+=1
        if detail:
            byordinal[detail["ordinal"]][kind]+=1
            if len(examples[kind])<7:examples[kind].append(detail)
    monthly[month]=dict(stat)
    detailed[month]={str(k):dict(v) for k,v in byordinal.items()}
p=pathlib.Path("reports/year-race-type/race-id-date-integrity.json");p.parent.mkdir(parents=True,exist_ok=True)
report={"schema":"tk-keirin-historical-identifier-calendar-audit/v1",
        "sources":"Kenseimk/keirin-data 13 monthly CSVs 2025-11 through 2026-11",
        "meaning":"Compares supplied CSV date against date decoded as start date + (identifier day-index-1), without assuming universal identifier semantics",
        "totals":dict(totals),"by_month":monthly,"by_month_ordinal":detailed,"examples":dict(examples),"errors":errors,
        "policy":"Do not correct dates without independent crosscheck. Reject race-day inference wherever source semantics conflict."}
p.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("DATE_AUDIT",json.dumps({"totals":report["totals"],"monthly":monthly,"errors":errors,"examples":dict(examples)},ensure_ascii=False)[:16000])
