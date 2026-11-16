#!/usr/bin/env python3
"""Audit publicly archived 2025-11-16..2026-11-15 race CSVs for suitability; no betting predictions.
Never pass annotation marks as lineup or label round from race number.
"""
import csv,io,json,re,collections,concurrent.futures,urllib.request,datetime,os,hashlib
START,END="2025-11-16","2026-11-15"
MONTHS=[f"{year}_{month:02d}" for year,month in [(2025,11),(2025,12)]+[(2026,i) for i in range(1,12)]]
URL="https://raw.githubusercontent.com/Kenseimk/keirin-data/main/keirin_data/{}_keirin.csv"
def get(month):
    req=urllib.request.Request(URL.format(month),headers={"User-Agent":"tk-keirin-lab research historical source audit"})
    with urllib.request.urlopen(req,timeout=60) as resp: raw=resp.read()
    t=raw.decode("utf-8-sig")
    return month,list(csv.DictReader(io.StringIO(t))),len(raw),hashlib.sha256(raw).hexdigest()
def parse_payout(s):
    if not s:return None
    m=re.search(r"([1-9])\s*-\s*([1-9])\s*-\s*([1-9])\s+([\d,]+)\s*円",s)
    if not m:return None
    a,b,c,p=m.groups()
    if len({a,b,c})!=3:return None
    return dict(combo=f"{a}-{b}-{c}",payout=int(p.replace(",","")))
def grade(rows):
    ranks=[(r.get("player_class") or "").strip() for r in rows]
    if any(r.startswith("L") for r in ranks):return "girls"
    if all(r=="A3" for r in ranks):return "チャレンジ"
    if any(r.startswith("S") for r in ranks):return "S級"
    if ranks and all(r.startswith("A") for r in ranks):return "A級"
    return "unknown"
items={}
failures={}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    futures={pool.submit(get,m):m for m in MONTHS}
    for fut in concurrent.futures.as_completed(futures):
        try:
            m,rows,n,sha=fut.result();items[m]=(rows,n,sha)
            print("SOURCE",m,"rows",len(rows),"bytes",n,flush=True)
        except Exception as e:
            failures[futures[fut]]=str(e)
seen_races={}
duplicates=collections.Counter()
file_coverage={}
for month,(rows,n,sha) in sorted(items.items()):
    groups=collections.defaultdict(list)
    for r in rows:
        if START <= (r.get("date") or "") <= END:
            groups[(r.get("race_id"),r.get("date"),r.get("venue_slug"),r.get("race_no"))].append(r)
    file_coverage[month]={"sha256":sha,"bytes":n,"rows_all":len(rows),"races_in_date":len(groups)}
    for k,rs in groups.items():
        if k in seen_races:duplicates[month]+=1;continue
        seen_races[k]=rs
out=collections.Counter()
months=collections.defaultdict(lambda:collections.Counter())
grades=collections.defaultdict(lambda:collections.Counter())
examples=[]
for (rid,date,venue,no),rs in sorted(seen_races.items(),key=lambda x:(x[0][1],x[0][2],x[0][3])):
    counts={str(r.get("banum")) for r in rs if r.get("banum") is not None}
    kind=grade(rs)
    key=f"{kind}_{len(counts)}"
    payout=parse_payout(next((r.get("san_ren_tan") or "" for r in rs if r.get("san_ren_tan")), ""))
    rank=[r.get("rank","").strip() for r in rs]
    flags={"7or9":len(counts) in [7,9],"has_payout":bool(payout),"has_rank":any(x in ["1","2","3"] for x in rank)}
    out["all_races"]+=1;out["car_rows"]+=len(rs)
    for name,value in flags.items():
        if value:out[name]+=1
    if flags["7or9"] and kind not in ("girls","unknown"):
        out["eligible_male"]+=1
        if flags["has_payout"]:out["eligible_with_trifecta"]+=1
    if kind=="girls":out["girls"]+=1
    if len(counts) not in (7,9):out["other_car_count"]+=1
    cc=months[date[:7]]; cc["all"]+=1;cc[key]+=1
    gc=grades[key];gc["n"]+=1
    if payout:gc["trifecta_settled"]+=1
    if len(examples)<8 and flags["7or9"] and kind!="girls":
        examples.append({"id":rid,"date":date,"venue":venue,"grade":key,"round":None,"lineup":None,
            "csv_lineup_is_predictions":rs[0].get("lineup"),"payout":payout})
report={"schema":"tk-keirin-year-race-type-source-audit/v1","period":{"start":START,"end":END},
    "source":{"repository":"Kenseimk/keirin-data","monthly_files":file_coverage,
              "source_data_disclaimer":"Third-party scraped K-Dreams CSV, not independently official verified"},
    "fetch_errors":failures,"duplicates_across_month_files":dict(duplicates),
    "counts":dict(out),"months":{m:dict(c) for m,c in sorted(months.items())},
    "grades":{k:dict(c) for k,c in sorted(grades.items())},
    "sample":examples,
    "critical_missing_fields":["race_round_name (初日特選/予選/準決/決勝/敗者区分)","true_lineup_and_line_position","meeting_day","start_time"],
    "misleading_field":{"lineup":"Contains ◎○▲△×注 predictions rather than ordered team line, cannot feed directly to current engines"},
    "decision":"NOT_VALID_FOR_EXISTING_ENGINE_REPLAY",
    "reason":"Existing LAB engines require accurate lineup and round_name; do not fabricate from prediction marks/race numbers.",
    "next":"Seek a source with complete historic program labels and real line formations, then rerun all 8 engines and temporally validate."}
os.makedirs("reports/year-race-type",exist_ok=True)
with open("reports/year-race-type/year-source-audit-20251116-20261115.json","w") as f:
    json.dump(report,f,indent=2,ensure_ascii=False)
print("YEAR_AUDIT",json.dumps({"counts":report["counts"],"grades":report["grades"],"missing_fields":report["critical_missing_fields"],"files":len(file_coverage),"file_errors":failures},ensure_ascii=False),flush=True)
