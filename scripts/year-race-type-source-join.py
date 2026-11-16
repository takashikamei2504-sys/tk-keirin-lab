#!/usr/bin/env python3
"""Validate and join two publicly available archival sources, without guessing team order.

Kenseimk CSV supplies race ID, riders, results; kurinaka12-afk daily JSON supplies
verified field presence for round label, meeting day, and declared LINE order.
No raw third-party lineups or full racecards are persisted in the public research repo.
"""
import collections,concurrent.futures,csv,datetime,hashlib,io,json,re,sys,unicodedata,urllib.request,pathlib
START=datetime.date(2025,11,16);END=datetime.date(2026,11,15)
COVER_FROM=datetime.date(2026,8,18)
MONTHS=[f"2026_{m:02d}" for m in range(8,12)]
CSV_BASE="https://raw.githubusercontent.com/Kenseimk/keirin-data/main/keirin_data/{}_keirin.csv"
DAILY_BASE="https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/{}.json"
HEADERS={"User-Agent":"tk-keirin-lab noncommercial historical source reconciliation research"}
def get(url):
    req=urllib.request.Request(url,headers=HEADERS)
    with urllib.request.urlopen(req,timeout=40) as r:return r.read()
def normal(v):
    return re.sub(r"[\s\u3000]",'',unicodedata.normalize("NFKC",str(v or "")))
def csv_month(m):
    raw=get(CSV_BASE.format(m));records=list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    return m,records,hashlib.sha256(raw).hexdigest()
def day_file(d):
    b=json.loads(get(DAILY_BASE.format(d)))
    if b.get("date")!=d or not isinstance(b.get("races"),list):raise ValueError("Incorrect JSON date / races")
    return d,b
def stage(round_name,day):
    t=normal(round_name)
    if "決勝" in t:return "決勝"
    if day=="初日" and (re.search(r"初日特選|特選|特別選抜|特別優秀",t)):return "初日特選"
    if re.search(r"準決|予選|特予選|勝上",t):return "勝ち上がり戦"
    if re.search(r"一般|特一般|選抜|特選|特秀|特優|敗者|順位決定",t):return "敗者戦"
    return "その他"
def lineup_ok(entries):
    groups=collections.defaultdict(list)
    try:
        used=set()
        for e in entries:
            car=int(e["car_number"]);match=re.fullmatch(r"(\d{1,2})-(\d{1,2})",str(e.get("line_position","")))
            if not match or car in used:return False
            used.add(car);groups[int(match.group(1))].append((int(match.group(2)),car))
        return all(sorted(x[0] for x in v)==list(range(1,len(v)+1)) for v in groups.values())
    except (ValueError,KeyError,TypeError):return False
def grade(rs):
    classes=[normal(x.get("player_class","")) for x in rs]
    if any(x.startswith("L") for x in classes):return "女子"
    if classes and all(x=="A3" for x in classes):return "チャレンジ"
    if any(x.startswith("S") for x in classes):return "S級"
    if classes and all(x.startswith("A") for x in classes):return "A級"
    return "不明"
def score_match(entries,rows):
    csv_map={str(r.get("banum")):normal(r.get("player_name")) for r in rows}
    if len(csv_map)!=len(rows) or len(rows)!=len(entries):return None
    good=0
    for e in entries:
        n=str(e.get("car_number"))
        a=normal(e.get("rider_full_name") or e.get("rider_name"))
        b=csv_map.get(n,"")
        if len(a)>=3 and b.startswith(a):good+=1
        elif len(a)>=4 and a.startswith(b) and len(b)>=3:good+=1
    return good
def matches(combo_csv,source):
    # optional payout cross-check; missing payout is not a reason to fabricate a match
    m=re.search(r"([1-9])\s*-\s*([1-9])\s*-\s*([1-9])\s+([\d,]+)\s*円",combo_csv)
    if not m:return None
    a,b,c,value=m.groups();top=source.get("result_top3") or []
    combo=[int(a),int(b),int(c)]
    if len(top)!=3:return None
    return combo==[int(x) for x in top] and int(value.replace(",",""))==source.get("payout_trifecta")
outdir=pathlib.Path("reports/year-race-type");outdir.mkdir(parents=True,exist_ok=True)
monthdata={}; errors={}; raw_days={}; months_meta={}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    tasks={pool.submit(csv_month,m):m for m in MONTHS}
    for f in concurrent.futures.as_completed(tasks):
        try:
            m,rows,sha=f.result();monthdata[m]=rows;months_meta[m]={"rows":len(rows),"sha256":sha}
        except Exception as e:errors[tasks[f]]="CSV:"+str(e)
by_day_no=collections.defaultdict(dict)
for m,rows in monthdata.items():
    groups=collections.defaultdict(list)
    for r in rows:
        d=r.get("date","")
        if str(COVER_FROM)<=d<=str(END):groups[(d,str(r.get("race_no")),str(r.get("race_id")))].append(r)
    for (d,no,rid),rs in groups.items():
        if rid not in by_day_no[(d,no)]:by_day_no[(d,no)][rid]=rs
dates=[COVER_FROM+datetime.timedelta(days=i) for i in range((END-COVER_FROM).days+1)]
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    tasks={pool.submit(day_file,d.isoformat()):d.isoformat() for d in dates}
    for f in concurrent.futures.as_completed(tasks):
        try:
            d,day=f.result();raw_days[d]=day
        except Exception as e:errors[tasks[f]]="JSON:"+str(e)
counts=collections.Counter();reasons=collections.Counter();stages=collections.Counter();grades=collections.Counter()
by_month=collections.defaultdict(collections.Counter);lookup_examples=[];hall_votes=collections.defaultdict(collections.Counter)
matched_ids=set();daily_eligible=0
for d,day in sorted(raw_days.items()):
    for s in day.get("races",[]):
        es=s.get("entries") or []
        if s.get("is_girls") or len(es) not in (7,9) or any(str(x.get("class_rank","")).startswith("L") for x in es):continue
        daily_eligible+=1;counts["public_daily_eligible"]+=1
        no=str(s.get("race_number"))
        candidates=by_day_no.get((d,no),{})
        if not candidates:reasons["no_matching_csv_race_number"]+=1;continue
        options=[]
        for rid,rs in candidates.items():
            if len(rs)!=len(es) or len({r.get("banum") for r in rs})!=len(es):continue
            n=score_match(es,rs)
            if n is not None and n>=max(5,len(es)-1):
                options.append((n,rid,rs))
        options.sort(key=lambda x:x[0],reverse=True)
        if not options:
            reasons["rider_id_name_mismatch"]+=1
            if len(lookup_examples)<5 and candidates:
                for r_id,c_rs in list(candidates.items())[:1]:
                    lookup_examples.append({"date":d,"diagnostic":"candidate_no_identity_match",
                      "csv_race_id":r_id,"csv_rider_count":len(c_rs),
                      "public_rider_count":len(es),
                      "csv_names":[(x.get("banum"),normal(x.get("player_name"))) for x in c_rs[:4]],
                      "public_names":[(x.get("car_number"),normal(x.get("rider_full_name") or x.get("rider_name"))) for x in es[:4]]})
            continue
        if len(options)>1 and options[0][0]==options[1][0]:reasons["ambiguous_name_join"]+=1;continue
        n,rid,rs=options[0]
        if rid in matched_ids:reasons["duplicate_matched_source_race"]+=1;continue
        matched_ids.add(rid);counts["identity_matched"]+=1
        line=lineup_ok(es);meeting=day.get("venue_info",{}).get(s.get("venue"),{}).get("meeting_day")
        title=normal(s.get("round_name"))
        payout_consistency=matches(next((r.get("san_ren_tan") or "" for r in rs if r.get("san_ren_tan")),""),s)
        if not line:reasons["lineup_incomplete_or_invalid"]+=1
        if meeting not in ("初日","二日目","三日目","四日目","最終日"):reasons["meeting_day_missing"]+=1
        if not title:reasons["race_round_missing"]+=1
        if payout_consistency is False:reasons["payout_mismatch"]+=1
        complete=line and bool(title) and meeting in ("初日","二日目","三日目","四日目","最終日")
        if complete:
            counts["complete_line_and_program"]+=1
            g=grade(rs)+"_"+str(len(es));st=stage(title,meeting)
            stages[st]+=1;grades[g]+=1;by_month[d[:7]][g+"|"+st]+=1
            hall_votes[str(rs[0].get("venue_slug"))][str(s.get("venue"))]+=1
        if payout_consistency is True:counts["payout_crosschecked_equal"]+=1
        elif payout_consistency is None:counts["payout_crosscheck_unavailable"]+=1
        if len(lookup_examples)<12:lookup_examples.append({"date":d,"csv_race_id":rid,"public_venue":s.get("venue"),
                   "venue_slug":rs[0].get("venue_slug"),"race_no":no,"rider_matches":n,
                   "lineup_ok":bool(line),"round_name":title,"meeting_day":meeting,
                   "payout_consistency":payout_consistency})
scope_days=(END-START).days+1
report={"schema":"tk-keirin-year-coverage-reconciliation/v1","period":{"from":str(START),"to":str(END),"calendar_days":scope_days},
        "secondary_source_available_from":str(COVER_FROM),"source_days_expected":len(dates),
        "secondary_source_days_loaded":len(raw_days),"source_files":months_meta,"errors":errors,
        "counts":dict(counts),"missing_reasons":dict(reasons),"stages":dict(stages),"grades":dict(grades),
        "stage_grade_by_month":{m:dict(v) for m,v in sorted(by_month.items())},
        "venue_slug_mappings_checked":{s:dict(v) for s,v in sorted(hall_votes.items())},
        "identity_sample":lookup_examples,
        "data_integrity":{"source1":"Kenseimk/keirin-data monthly CSV","source2":"kurinaka12-afk/keirin-app-data daily JSON",
            "join":"date + race number + >= max(5,ncars-1) independent same-car rider name prefixes; reject ambiguous candidates",
            "line":"exact numeric line_position strings and contiguous position indexes, no inferred lineups",
            "round":"exact published round_name; meeting_day from venue_info",
            "payout":"optional independently matched three-car winning order plus payout, mismatch tracked",
            "privacy":"only audit metrics and ≤12 illustrative race metadata retained, no third-party raw archive republished"},
        "limitations":["2025-11-16 to 2026-08-17 still has no public verified full lineup source",
                       "Source records may not represent precisely what was known at betting cutoff",
                       "No first-day feature may be inferred from race number",
                       "Current engine 12-month ROI cannot be calculated from incomplete source"],
        "year_full_cards_recovered":False}
out=outdir/"source-join-20260818-20261115.json"
out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("RECONCILED",json.dumps({"counts":report["counts"],"stages":report["stages"],"missing_reasons":report["missing_reasons"],
  "errors":report["errors"],"source_days":len(raw_days),"mappings":len(hall_votes)},ensure_ascii=False),flush=True)
