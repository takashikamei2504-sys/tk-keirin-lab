#!/usr/bin/env python3
"""Normalize one year of K-Dreams archive dates using independently validated race-ID meeting-day encoding.

This is source-data quality work, NOT historic pre-race engine replay.
For IDs with inconsistent calendar evidence, drop the race rather than guess.
"""
import csv,io,json,re,datetime,collections,concurrent.futures,pathlib,urllib.request,hashlib
START=datetime.date(2025,11,16);END=datetime.date(2026,11,15)
MONTHS=[f"2025_{n:02d}" for n in [11,12]]+[f"2026_{n:02d}" for n in range(1,12)]
BASE="https://raw.githubusercontent.com/Kenseimk/keirin-data/main/keirin_data/{}_keirin.csv"
def get(month):
    with urllib.request.urlopen(urllib.request.Request(BASE.format(month),headers={"User-Agent":"tk-keirin-lab/year-data-integrity"}),timeout=45) as r: b=r.read()
    return month,list(csv.DictReader(io.StringIO(b.decode("utf-8-sig")))),hashlib.sha256(b).hexdigest()
def normalize(r):
    rid=str(r.get("race_id") or "")
    if len(rid)!=16 or not rid.isdigit():return None,"invalid_id"
    try:
        meeting_start=datetime.date(int(rid[2:6]),int(rid[6:8]),int(rid[8:10]))
        day_number=int(rid[10:12])
        race_number=int(rid[12:16])
        source_date=datetime.date.fromisoformat(str(r.get("date")))
    except Exception:return None,"invalid_calendar"
    if not (1<=day_number<=5 and 1<=race_number<=12):return None,"invalid_day_or_race_number"
    actual_date=meeting_start+datetime.timedelta(days=day_number-1)
    if source_date==actual_date:return (actual_date,day_number,meeting_start),"direct_match"
    if source_date==meeting_start:return (actual_date,day_number,meeting_start),"source_misdated_meeting_start"
    return None,"calendar_conflict"
def classify(rs):
    ranks=[str(r.get("player_class","")).strip().upper() for r in rs]
    cards={str(r.get("banum","")) for r in rs}
    if any(x.startswith("L") for x in ranks):return "女子_"+str(len(cards))
    if ranks and all(x=="A3" for x in ranks):return "チャレンジ_"+str(len(cards))
    if any(x.startswith("S") for x in ranks):return "S級_"+str(len(cards))
    if ranks and all(x.startswith("A") for x in ranks):return "A級_"+str(len(cards))
    return "不明_"+str(len(cards))
def valid_payout(rs):
    txt=next((r.get("san_ren_tan","") for r in rs if r.get("san_ren_tan")),"")
    m=re.search(r"([1-9])-([1-9])-([1-9])\s+([\d,]+)\s*円",txt)
    return bool(m and len(set(m.group(1,2,3)))==3 and int(m.group(4).replace(",",""))>0)
monthly={};errors={}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    fts={pool.submit(get,m):m for m in MONTHS}
    for f in concurrent.futures.as_completed(fts):
        try: m,rows,sha=f.result();monthly[m]=(rows,sha)
        except Exception as e:errors[fts[f]]=str(e)
if errors:raise RuntimeError("Not all monthly files were accessible: "+str(errors))
groups=collections.defaultdict(list);from_files=collections.defaultdict(set)
for month,(rows,sha) in monthly.items():
    for r in rows:
        rid=str(r.get("race_id") or "")
        groups[rid].append(r)
        from_files[rid].add(month)
src_diagnostics=collections.Counter()
status_by_month=collections.defaultdict(collections.Counter)
counts=collections.Counter();by_grade=collections.defaultdict(collections.Counter)
by_day_index=collections.Counter();by_month=collections.defaultdict(collections.Counter)
misdated_examples=[]; conflict_examples=[]
seen=set()
for rid,rs in groups.items():
    # Duplicate rows for a race are expected (one row per rider), but a single
    # race can be present in multiple scraped month files.
    if rid in seen:raise RuntimeError("Duplicate unique race id encountered")
    seen.add(rid)
    decoded=[]
    for r in rs:
        result,status=normalize(r)
        decoded.append((result,status))
    possible={item[0] for item in decoded if item[0] is not None}
    if len(possible)!=1:
        stat="race_id_calendar_conflict"
        src_diagnostics[stat]+=1
        if len(conflict_examples)<12:conflict_examples.append({"race_id":rid,"sources":sorted(from_files[rid]),"statuses":dict(collections.Counter(s for _,s in decoded))})
        continue
    (date,index,meeting_start),=possible
    statuses=collections.Counter(s for _,s in decoded)
    if any(s not in ("direct_match","source_misdated_meeting_start") for s in statuses):
        src_diagnostics["some_rows_inconsistent"]+=1
        if len(conflict_examples)<12:conflict_examples.append({"race_id":rid,"statuses":dict(statuses)})
        continue
    if not (START<=date<=END):
        src_diagnostics["outside_requested_year"]+=1
        continue
    if any(str(r.get("banum","")) not in [str(i) for i in range(1,10)] for r in rs) or len({str(r.get("banum")) for r in rs})!=len(rs):
        src_diagnostics["invalid_car_rows"]+=1;continue
    if len(from_files[rid])>1:src_diagnostics["race_in_multiple_month_files"]+=1
    if "source_misdated_meeting_start" in statuses:
        src_diagnostics["corrected_from_meeting_start"]+=1
        if len(misdated_examples)<12:misdated_examples.append({"race_id":rid,"original":str(rs[0].get("date")),"normalized":str(date),"day_index":index})
    grade=classify(rs)
    counts["all"]+=1;by_grade[grade]["all"]+=1
    by_month[str(date)[:7]][grade]+=1
    by_day_index[str(index)]+=1
    if grade in ("A級_7","S級_7","S級_9","チャレンジ_7"):
        counts["main_male_classes"]+=1
        by_grade[grade]["male_eligible"]+=1
        if valid_payout(rs):
            counts["eligible_with_trifecta"]+=1;by_grade[grade]["with_trifecta"]+=1
    if grade.startswith("女子"):counts["women"]+=1
    for status in statuses:
        src_diagnostics[status+"_per_row"]+=statuses[status]
report={
 "schema":"tk-keirin-year-date-normalized-inventory/v1",
 "period":{"start":str(START),"end":str(END)},
 "source":"Kenseimk/keirin-data 13 monthly CSVs (nonofficial third-party archive)",
 "method":"16-digit race ID: venue2 + startYYYYMMDD + meeting_day2 + race_no4. Actual date = start + day_index-1, confirmed against 2026 Aug-Nov independent daily race feed.",
 "note":"Original CSV source date was sometimes meeting_start, not actual race date. Overlapping and abnormal days are not inferred.",
 "status":"annual normalized calendar and class inventory only; genuine lineup and program round still unavailable for earlier days",
 "total_unique_ids_seen":len(groups),
 "counts":dict(counts),"grade_counts":{k:dict(v) for k,v in sorted(by_grade.items())},
 "meeting_day_index_counts":dict(by_day_index),
 "by_actual_month":{k:dict(v) for k,v in sorted(by_month.items())},
 "diagnostics":dict(src_diagnostics),
 "corrected_examples":misdated_examples,
 "conflict_examples":conflict_examples,
 "source_files":{m:{"rows":len(rr),"sha256":sha} for m,(rr,sha) in sorted(monthly.items())},
 "limitations":[
    "A missing proper lineup is never replaced with prediction marks",
    "A meeting-day index is not a program round (決勝/勝ち上がり/敗者/初日特選)",
    "Cancelled or postponed meeting days may not satisfy simple contiguous date arithmetic; conflicting cases excluded",
    "This 1-year inventory cannot establish current engine's 1-year historical ROI",
    "Payouts are unverified scraped data, not official evidence"
 ]}
p=pathlib.Path("reports/year-race-type/annual-normalized-inventory.json");p.parent.mkdir(parents=True,exist_ok=True)
p.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("ANNUAL_NORMALIZED",json.dumps({"counts":report["counts"],"grades":report["grade_counts"],"diagnostics":report["diagnostics"],"month_counts":{k:sum(v.values()) for k,v in report["by_actual_month"].items()}},ensure_ascii=False))
