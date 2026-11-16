#!/usr/bin/env python3
"""Reproducible annual GP/G1/G2/G3 123579 trifecta box ROI audit (2025-11-17..2026-11-16).
Schedule: KDreams grade & highgrade 2025/26. Results: monthly public KDreams CSV mirror.
Every valid race one row, one 100 yen per distinct trio, no outcomes used in ticket creation.
Research-only branch. No real bets or production system changes.
"""
import csv,datetime as dt,hashlib,io,itertools,json,math,re,statistics,sys,time,unicodedata,urllib.request,concurrent.futures
from collections import defaultdict,Counter
from pathlib import Path
from bs4 import BeautifulSoup

ROOT=Path("reports/year-race-type")
ROOT.mkdir(parents=True,exist_ok=True)
START=dt.date(2025,11,17);END=dt.date(2026,11,16);EVAL_START=dt.date(2026,8,1)
SET=(1,2,3,5,7,9)
# 2-digit rider-race venue code in KDreams race_id, used instead of unreliable romanization
VENUE={
"函館":11,"青森":12,"いわき平":13,"弥彦":21,"前橋":22,"取手":23,"宇都宮":24,"大宮":25,"西武園":26,
"京王閣":27,"立川":28,"松戸":31,"千葉":32,"川崎":34,"平塚":35,"小田原":36,"伊東":37,"伊東温泉":37,
"静岡":38,"名古屋":42,"岐阜":43,"大垣":44,"豊橋":45,"富山":46,"松阪":47,"四日市":48,"福井":51,"奈良":53,
"向日町":54,"和歌山":55,"岸和田":56,"玉野":61,"広島":62,"防府":63,"高松":71,"小松島":73,
"高知":74,"松山":75,"小倉":81,"久留米":83,"武雄":84,"佐世保":85,"別府":86,"熊本":87
}
SOURCE_REPO="Kenseimk/keirin-data"
SCHEDULE_BASE="https://keirin.kdreams.jp/schedule"
USER_AGENT="Mozilla/5.0 (Keirin historical ROI research, no wagering)"
def load(url,attempts=3):
 for attempt in range(attempts):
  try:
   req=urllib.request.Request(url,headers={"User-Agent":USER_AGENT})
   with urllib.request.urlopen(req,timeout=80) as f: return f.read()
  except Exception:
   if attempt==attempts-1:raise
   time.sleep(1+2*attempt)
def normalize(s):
 return unicodedata.normalize("NFKC",str(s or "")).replace("\u3000"," ").strip()
def parse_date(s,year):
 v=re.findall(r"(\d{1,2})月\s*(\d{1,2})日",normalize(s))
 if len(v)!=2:raise ValueError("Schedule dates unreadable "+repr(s))
 (m1,d1),(m2,d2)=map(lambda x:tuple(map(int,x)),v)
 a=dt.date(year,m1,d1)
 b=dt.date(year+(m2<m1),m2,d2)
 if (b-a).days not in range(1,10):raise ValueError("Too many/few days "+repr(s))
 return a,b
def classify_high(name,kind):
 x=normalize(name)
 if any(z in x for z in ["全プロ記念","女子オールスター","オールガールズクラシック"]):
  return None
 if "グランプリ" in x and "和歌山" not in x:return "GP"
 if any(z in x for z in ["ウィナーズカップ","サマーナイトフェスティバル","共同通信社杯"]):
  return "GII"
 return "GI"
def schedule():
 events=[];snapshots={}
 for year in [2025,2026]:
  for kind in ["grade","highgrade"]:
   url=f"{SCHEDULE_BASE}/{kind}/search/{year}/"
   raw=load(url)
   snapshots[f"{year}_{kind}"]={"url":url,"sha256":hashlib.sha256(raw).hexdigest(),"bytes":len(raw)}
   soup=BeautifulSoup(raw,"html.parser")
   tables=[t for t in soup.find_all("table") if "開催日程" in t.get_text(" ",strip=True) and "優勝者" in t.get_text(" ",strip=True)]
   if len(tables)!=1:raise ValueError(f"Cannot identify schedule table {year} {kind}: {len(tables)}")
   for tr in tables[0].find_all("tr"):
    fields={}
    for td in tr.find_all(["td"],recursive=False):
     for cls in td.get("class",[]): fields[cls]=td.get_text(" ",strip=True)
    if not fields.get("velodrome") or not fields.get("schedule"):continue
    venue=normalize(fields["velodrome"])
    if venue not in VENUE:raise ValueError("Unmapped official event venue "+venue)
    begin,end=parse_date(fields["schedule"],year)
    if end<START or begin>END:continue
    grade="GIII" if kind=="grade" else classify_high(fields.get("name",""),fields.get("type",""))
    if grade is None:continue
    ev={"year":year,"venue":venue,"venue_code":VENUE[venue],
        "start":str(begin),"end":str(end),"grade":grade,"name":normalize(fields.get("name","")),
        "url":url}
    if not ev["name"]:raise ValueError("No graded event name")
    events.append(ev)
 if not events:raise ValueError("No verified schedule fixtures")
 # Each venue/date should be assigned exactly one grade fixture
 indexed={}
 for event in events:
  start=dt.date.fromisoformat(event["start"]);end=dt.date.fromisoformat(event["end"])
  for i in range((end-start).days+1):
   day=start+dt.timedelta(days=i)
   if not START<=day<=END:continue
   key=(str(day),event["venue_code"])
   if key in indexed:raise ValueError("Overlapping graded meeting "+str(key))
   indexed[key]=event
 return indexed,events,snapshots
def fetch_month(pair):
 yr,mo=pair
 uri=f"https://raw.githubusercontent.com/{SOURCE_REPO}/main/keirin_data/{yr}_{mo:02d}_keirin.csv"
 raw=load(uri)
 sha=hashlib.sha256(raw).hexdigest()
 f=io.StringIO(raw.decode("utf-8-sig",errors="strict"))
 reader=csv.DictReader(f)
 fields=set(reader.fieldnames or [])
 if not {"race_id","venue_slug","date","race_no","banum","player_class","san_ren_tan","rank"}.issubset(fields):
  raise ValueError("Missing required data columns "+repr(reader.fieldnames))
 rows=list(reader)
 print("SOURCE_MONTH",yr,mo,"rows",len(rows),"sha256",sha,"bytes",len(raw),flush=True)
 return (yr,mo),rows,{"url":uri,"sha256":sha,"row_count":len(rows),"bytes":len(raw)}
def parse_result(s):
 s=normalize(s)
 if not s:return []
 # Allows multiple dead-heat result combos (never assume the three entered first are unique)
 out={}
 for m in re.finditer(r"(?<!\d)([1-9])\s*[-=]\s*([1-9])\s*[-=]\s*([1-9])\s+([\d,]+)\s*円",s):
  trio=tuple(int(m.group(j)) for j in (1,2,3))
  if len(set(trio))<3:continue
  yen=int(m.group(4).replace(",",""))
  if yen<=0:continue
  if trio in out and out[trio]!=yen:raise ValueError("Conflicting same-race payout "+s)
  out[trio]=yen
 return list(out.items())
def all_tickets(numbers):
 return tuple(itertools.permutations(sorted(set(numbers)),3))
def grade_count(r):
 grade=r["grade"]
 if grade=="GP":return 0
 return {"GI":1,"GII":2,"GIII":3}[grade]
def race_day(r):
 return (dt.date.fromisoformat(r["date"])-dt.date.fromisoformat(r["event"]["start"])).days+1
def perf(rows, ticket_keys, attr=None):
 stake=pay=0;wins=0; hitpayouts=[]; bets=0;sum_n=0
 details=[]
 for r in rows:
  keys=ticket_keys if attr is None else ticket_keys(r)
  keys=[x for x in keys if set(x).issubset(r["cars_set"])]
  amount=len(keys)*100
  payout=sum(v for trio,v in r["results"] if trio in keys)
  bets+=int(amount>0);stake+=amount;pay+=payout;wins+=int(payout>0);sum_n+=len(keys)
  details.append((r["id"],amount,payout))
  if payout>0:hitpayouts.append((r["id"],payout,amount))
 details.sort(key=lambda x:(-x[2],x[0]))
 def trimmed(n):
  remove={x[0] for x in details[:n]}
  s=sum(x[1] for x in details if x[0] not in remove)
  p=sum(x[2] for x in details if x[0] not in remove)
  return round(100*p/s,2) if s else None
 return {
 "races":len(rows),"purchased_races":bets,"tickets":sum_n,"stake_yen":stake,
 "payout_yen":pay,"net_yen":pay-stake,"hits":wins,"hit_rate_pct":round(100*wins/len(rows),2) if rows else None,
 "roi_pct":round(100*pay/stake,2) if stake else None,
 "trim1_pct":trimmed(1),"trim5_pct":trimmed(5),"trim10_pct":trimmed(10),
 "highest_hit_yen":details[0][2] if details else 0,
 "high_12000_hits":sum(v>=12000 for _,v,_ in hitpayouts),
 "wins_over100x":sum(v>=10000 for _,v,_ in hitpayouts),
 "wins_5000_9999":sum(5000<=v<10000 for _,v,_ in hitpayouts)}
def main():
 indexed,events,schedule_digests=schedule()
 months=[(2025,11),(2025,12)]+[(2026,m) for m in range(1,12)]
 raw_results={}
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
  for key,content,info in executor.map(fetch_month,months):
   raw_results[key]={"rows":content,"info":info}
 all_by_id={};source_summary={};skipped=Counter()
 for key,month in sorted(raw_results.items()):
  source_summary[f"{key[0]}-{key[1]:02d}"]=month["info"]
  for row in month["rows"]:
   reported_date=row.get("date","").strip()
   rid=row.get("race_id","").strip()
   try:
    if not re.fullmatch(r"\d{16}",rid):raise ValueError("bad race_id format")
    code=int(rid[:2]);race_no=int(row.get("race_no","0"));car_no=int(row.get("banum","0"))
    meeting_start=dt.date(int(rid[2:6]),int(rid[6:8]),int(rid[8:10]))
    meeting_sequence=int(rid[10:12]);encoded_race_no=int(rid[12:16])
    if not 1<=meeting_sequence<=7 or encoded_race_no!=race_no:
     raise ValueError("encoded meeting day or race number mismatch")
    day=str(meeting_start+dt.timedelta(days=meeting_sequence-1))
    if reported_date not in (day,str(meeting_start)):
     skipped["reported_date_inconsistent"]+=1
     continue
    if reported_date!=day:
     skipped["reported_start_date_not_race_day"]+=1
   except (ValueError,TypeError):skipped["bad_identity"]+=1;continue
   if not (str(START)<=day<=str(END)):continue
   event=indexed.get((day,code))
   if not event:continue
   if car_no<1 or car_no>9:skipped["bad_car_number"]+=1;continue
   # Dates are determined by result's actual calendar date, not filename
   ent=all_by_id.setdefault(rid,{"id":rid,"date":day,"race_no":race_no,"venue_code":code,
     "venue_slug":row.get("venue_slug",""),"event":event,"grade":event["grade"],"rows":{},
     "payouts":set()})
   if ent["date"]!=day or ent["venue_code"]!=code or ent["race_no"]!=race_no:raise ValueError("Contradictory race ID "+rid)
   fingerprint=tuple(sorted((k,str(v)) for k,v in row.items()))
   if car_no in ent["rows"]:
    old=ent["rows"][car_no]
    # Files often have overlapping spillover dates; prefer the row containing completed result
    if old==fingerprint:continue
    older={k:v for k,v in old}
    if older.get("san_ren_tan","") and not row.get("san_ren_tan",""):continue
    if row.get("san_ren_tan","") and not older.get("san_ren_tan",""):
     ent["rows"][car_no]=fingerprint
    elif fingerprint!=old:
     skipped["duplicate_source_conflict"]+=1
     # Keep the latest chronological month but record conflict
     ent["rows"][car_no]=fingerprint
   else:ent["rows"][car_no]=fingerprint
 # Reconcile the 2026-08-18 through 2026-11-15 pinned daily archive with CSV.
 # In the later months the public monthly CSV mirror has many blank payouts; never
 # report those gaps as settled losses or pretend the original source is annual-complete.
 ARCHIVE_SHA="4588ec938a2fec9e81216d3fd3423329805aa3d5"
 archive_dates=sorted({day for (day,venue) in indexed
   if "2026-08-18"<=day<="2026-11-15"})
 daily_sources={}
 def daily_fetch(date):
  uri=f"https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/{ARCHIVE_SHA}/{date}.json"
  raw=load(uri)
  doc=json.loads(raw)
  if doc.get("date")!=date or not isinstance(doc.get("races"),list):
   raise ValueError("Daily archive schema/date invalid "+date)
  return date,doc,{"url":uri,"sha256":hashlib.sha256(raw).hexdigest(),"bytes":len(raw)}
 archive_results,archive_matched,archive_replaced,archive_dual_conflict=0,0,0,0
 by_calendar={(r["date"],r["venue_code"],r["race_no"]):rid for rid,r in all_by_id.items()}
 with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
  for date,day,info in pool.map(daily_fetch,archive_dates):
   daily_sources[date]=info
   for card in day["races"]:
    venue=normalize(card.get("venue",""))
    if venue not in VENUE:continue
    code=VENUE[venue];k=(date,code,int(card.get("race_number",0)))
    event=indexed.get((date,code))
    if not event:continue
    if not isinstance(card.get("entries"),list) or not card["entries"]:continue
    if card.get("is_girls") or card.get("cancelled") or card.get("is_cancelled"):
     continue
    payout_entries=card.get("result_combos") or (card.get("payouts") or {}).get("trifecta") or []
    if not payout_entries and card.get("result_top3") and card.get("payout_trifecta"):
     payout_entries=[{"combo":card["result_top3"],"payout":card["payout_trifecta"]}]
    results=[]
    for x in payout_entries:
     try:
      combo=tuple(map(int,x["combo"]));yen=int(x["payout"])
      if len(combo)==3 and len(set(combo))==3 and yen>0:results.append((combo,yen))
     except (ValueError,KeyError,TypeError):continue
    if not results:continue
    rows={}
    for e in card["entries"]:
     try:n=int(e["car_number"])
     except (ValueError,KeyError,TypeError):continue
     player={"banum":str(n),"player_class":str(e.get("class_rank","")),"san_ren_tan":""}
     rows[n]=tuple(sorted(player.items()))
    if len(rows) not in (7,9):continue
    rid="archive:"+date+":"+str(code)+":"+str(k[2])
    rr={"id":rid,"date":date,"race_no":k[2],"venue_code":code,
        "venue_slug":venue,"event":event,"grade":event["grade"],
        "rows":rows,"archive_results":results}
    oldrid=by_calendar.get(k)
    if oldrid:
     old=all_by_id[oldrid]
     archive_replaced+=1
     old_text=set(normalize(dict(row).get("san_ren_tan",""))
                  for row in old["rows"].values()
                  if normalize(dict(row).get("san_ren_tan","")))
     if len(old_text)==1:
      prev=parse_result(next(iter(old_text)))
      if prev and sorted(prev)!=sorted(results):
       archive_dual_conflict+=1
       # Prioritise the immutable archival result while retaining conflict counter.
     del all_by_id[oldrid]
    all_by_id[rid]=rr
    by_calendar[k]=rid
    archive_matched+=1
 print("DAILY_ARCHIVE_RECONCILED",json.dumps({"dates":len(daily_sources),"settled_grade_races":archive_matched,
  "replaced_csv":archive_replaced,"payout_conflict":archive_dual_conflict},ensure_ascii=False),flush=True)
 # inspect each event race that exists, and whether settled
 valid=[];coverage=Counter();excluded=Counter()
 for rid,r in sorted(all_by_id.items()):
  rows=[dict(x) for x in r["rows"].values()]
  if len(rows) not in (7,9):excluded["race_not_7_or_9"]+=1;continue
  numbers={int(x["banum"]) for x in rows}
  if len(numbers)!=len(rows):excluded["rider_duplicate"]+=1;continue
  if numbers!=set(range(1,len(rows)+1)):excluded["noncontiguous_numbers"]+=1;continue
  ranks=[normalize(x.get("player_class","")) for x in rows]
  if all(x.startswith("L") for x in ranks):excluded["girls"]+=1;continue
  if any(x.startswith("L") for x in ranks) or not any(x.startswith("S") for x in ranks):
   excluded["not_male_grade"]+=1;continue
  if "archive_results" in r:
   results=r["archive_results"]
  else:
   payout_strings=set(normalize(x.get("san_ren_tan","")) for x in rows if normalize(x.get("san_ren_tan","")))
   if not payout_strings:excluded["no_trifecta_payout"]+=1;continue
   if len(payout_strings)>1:
    excluded["inconsistent_trifecta_payout"]+=1;continue
   try:results=parse_result(next(iter(payout_strings)))
   except Exception:excluded["payout_parse_conflict"]+=1;continue
   if not results:excluded["trifecta_parse_missing"]+=1;continue
  if any(any(n not in numbers for n in trio) for trio,_ in results):
   excluded["winning_car_not_starter"]+=1;continue
  r["cars_set"]=numbers;r["results"]=results;r["cars"]=len(numbers)
  r["meeting_day"]=race_day(r);r.pop("rows",None);r.pop("payouts",None)
  valid.append(r)
  coverage[(r["grade"],r["date"][:7])]+=1
 if not valid:raise ValueError("No joined graded race records; investigate venue IDs and schedules")
 nine=[r for r in valid if r["cars"]==9];seven=[r for r in valid if r["cars"]==7]
 BASE=all_tickets(SET)
 assert len(BASE)==120
 def full_stat(rows):
  return perf(rows,BASE)
 full=full_stat(nine)
 # For 7 cars, explicitly different purchasable 60 point ticket, not same 120-point bet.
 sample7=perf(seven,BASE)
 # Predeclared subset families for 9 car: 6 box; all 5-of-6 and 4-of-6 boxes,
 # three fixed rider sets in 1st, 2nd and 3rd positions.
 def combos_config():
  r={"BOX6_123579":BASE}
  for drop in SET:
   k=tuple(x for x in SET if x!=drop)
   r[f"BOX5_minus_{drop}"]=all_tickets(k)
  for sub in itertools.combinations(SET,4):
   r["BOX4_"+"".join(map(str,sub))]=all_tickets(sub)
  for axis in (0,1,2):
   for subset in itertools.combinations(SET,3):
    r[f"POSITION{axis+1}_top3_"+"".join(map(str,subset))]=tuple(x for x in BASE if x[axis] in subset)
  r["FIRST123_SECOND123_OTHERS"]=tuple(x for x in BASE if x[0] in (1,2,3) and x[1] in (1,2,3))
  r["FIRST123_SECOND579_OTHERS"]=tuple(x for x in BASE if x[0] in (1,2,3) and x[1] in (5,7,9))
  r["FIRST579_SECOND123_OTHERS"]=tuple(x for x in BASE if x[0] in (5,7,9) and x[1] in (1,2,3))
  r["THIRD579_FIRST123_SECOND_ANY"]=tuple(x for x in BASE if x[0] in (1,2,3) and x[2] in (5,7,9))
  return r
 strategies=combos_config()
 totals={key:perf(nine,tickets) for key,tickets in strategies.items()}
 def by(keys):
  return {k:full_stat([r for r in nine if fn(r)==k]) for k in sorted({fn(x) for x in nine})}
 groupers={
 "grade":lambda r:r["grade"],
 "month":lambda r:r["date"][:7],
 "meeting_day":lambda r:str(r["meeting_day"]),
 "race_no_group":lambda r:"1〜4R" if r["race_no"]<=4 else "5〜8R" if r["race_no"]<=8 else "9〜12R",
 "venue":lambda r:r["event"]["venue"],
 "race_no":lambda r:str(r["race_no"])
 }
 breakdown={label:{k:full_stat([r for r in nine if f(r)==k]) for k in sorted({f(r) for r in nine})} for label,f in groupers.items()}
 train=[r for r in nine if dt.date.fromisoformat(r["date"])<EVAL_START]
 holdout=[r for r in nine if dt.date.fromisoformat(r["date"])>=EVAL_START]
 if len(train)<100 or len(holdout)<30:raise ValueError("Insufficient chronological evaluation length")
 train_perf={key:perf(train,tickets) for key,tickets in strategies.items()}
 hold_perf={key:perf(holdout,tickets) for key,tickets in strategies.items()}
 # Train ranking predeclared with high-hit removal and minimum 3 hit events / at least 100 bets
 eligible=[k for k,m in train_perf.items() if k!="BOX6_123579" and m["hits"]>=3 and m["tickets"]>=100]
 ranked=sorted(eligible,key=lambda k:(train_perf[k]["trim5_pct"] or 0,train_perf[k]["roi_pct"] or 0),reverse=True)
 chosen=ranked[0] if ranked else None
 # monthly training >= 90d and test next month, candidate selection only on prior completed race dates
 months9=sorted({r["date"][:7] for r in nine})
 folds=[]
 for month in months9:
  start=dt.date.fromisoformat(month+"-01")
  tested=[r for r in nine if r["date"][:7]==month]
  if start<dt.date(2026,3,1):continue
  past=[r for r in nine if dt.date.fromisoformat(r["date"])<start]
  if len(past)<100:continue
  rankings=[]
  for name,tickets in strategies.items():
   if name=="BOX6_123579":continue
   p=perf(past,tickets)
   if p["hits"]>=4 and p["tickets"]>=150 and p["trim5_pct"] is not None:
    rankings.append((p["trim5_pct"],p["roi_pct"],name))
  rankings.sort(reverse=True)
  if not rankings:continue
  pick=rankings[0][2]
  folds.append({"month":month,"train_n":len(past),"test_n":len(tested),"selected":pick,
   "selected_test":perf(tested,strategies[pick]),
   "box6_test":full_stat(tested)})
 # all flat monthly folds vs box base same period, selection already trained all prior
 overall_fold={"races":sum(f["test_n"] for f in folds),
               "stake_yen":sum(f["selected_test"]["stake_yen"] for f in folds),
               "payout_yen":sum(f["selected_test"]["payout_yen"] for f in folds),
               "baseline_stake_yen":sum(f["box6_test"]["stake_yen"] for f in folds),
               "baseline_payout_yen":sum(f["box6_test"]["payout_yen"] for f in folds)}
 overall_fold["roi_pct"]=round(100*overall_fold["payout_yen"]/overall_fold["stake_yen"],2) if overall_fold["stake_yen"] else None
 overall_fold["baseline_roi_pct"]=round(100*overall_fold["baseline_payout_yen"]/overall_fold["baseline_stake_yen"],2) if overall_fold["baseline_stake_yen"] else None
 # race level payout field with no bettor-specific odds, filtered only on winners after race for diagnostic, not selection
 full_per_race=[{"date":r["date"],"venue":r["event"]["venue"],"race_no":r["race_no"],"grade":r["grade"],
  "meeting":r["event"]["name"],"day":r["meeting_day"],"cars":r["cars"],
  "winners":[{"trio":"-".join(map(str,t)),"yen":p} for t,p in r["results"]],
  "box6_hit":any(set(t).issubset(SET) for t,p in r["results"]),
  "box6_return_yen":sum(p for t,p in r["results"] if set(t).issubset(SET))} for r in nine]
 info={
 "schema":"tk-keirin-graded-123579-year-audit/v1","created_at":str(dt.datetime.now(dt.timezone.utc)),
 "period":{"first":str(START),"last":str(END),"days":365},
 "buy":{"digits":SET,"all_9car_bets":120,"stake_per_ticket_yen":100,"cost_9car_per_race_yen":12000,
  "seven_car_valid_tickets":len(all_tickets((1,2,3,5,7)))},
 "sources":{"schedule":schedule_digests,"monthly_csv":source_summary,
  "monthly_source_repository":SOURCE_REPO,"graded_schedule_provider":"楽天Kドリームス",
  "pinned_recent_daily_archive":{"commit":ARCHIVE_SHA,"days":daily_sources,
    "csv_races_replaced":archive_replaced,"overlapping_payout_conflicts":archive_dual_conflict},
  "provenance_warning":"Third-party scraped CSV may omit result/payout on many scheduled graded fixtures. Coverage is not official exhaustive."},
 "coverage":{"schedule_fixtures":len(events),"scheduled_grade_venue_days":len(indexed),
  "csv_matched_unique_races":len(all_by_id),"eligible_9car_with_payout":len(nine),"archive_new_or_updated_grade_races":archive_matched,
  "eligible_7car_with_payout":len(seven),"excluded":dict(excluded),"ingest_notes":dict(skipped),
  "eligible_by_grade":dict(Counter(r["grade"] for r in nine)),
  "results_per_month":dict(Counter(r["date"][:7] for r in nine)),
  "fixture_day_coverage":len({(r["date"],r["venue_code"]) for r in valid}),
  "missing_scheduled_days":[{"date":d,"venue_code":c,"fixture":e["name"]} for (d,c),e in sorted(indexed.items()) if (d,c) not in {(r["date"],r["venue_code"]) for r in valid}]},
 "main":{"all_9car":full,"seven_car_60point_reference":sample7},
 "by_grade":breakdown["grade"],"by_month":breakdown["month"],
 "by_meeting_day":breakdown["meeting_day"],"by_race_no_group":breakdown["race_no_group"],
 "by_venue":breakdown["venue"],"by_race_no":breakdown["race_no"],
 "strategies":{"total_candidates":len(strategies),"total":totals,
  "ticket_counts":{k:len(v) for k,v in strategies.items()}},
 "historical_selection":{"train_before":str(EVAL_START),"train_races":len(train),"holdout_races":len(holdout),
  "best_train_trim5":chosen,"train_top10":[{"name":k,"train":train_perf[k],"holdout":hold_perf[k]} for k in ranked[:10]],
  "box_train":full_stat(train),"box_holdout":full_stat(holdout),
  "walk_forward_folds":folds,"walk_forward_overall":overall_fold,
  "note":"Numerous strategies on same year; monthly pre-month selection avoids same-race lookahead but feature families designed retrospectively."},
 "individual_9car_races":full_per_race,
 "method_warnings":[
  "This is a combined schedule/third-party monthly CSV/pinned daily archive, not proof all official grade events covered.",
  "Most recent 2026-08-18..2026-11-15 races use immutable commit-pinned daily archive results and were de-duplicated against monthly CSV by actual date, velodrome code and race number.",
  "A full six-car box costs 12000 yen per 9-car race; only exactly 9-cars are comparable.",
  "GIII includes occasional 7-car races: a 60-point five-number box is separately shown, NOT counted as 9-car 120-point bet.",
  "Male grade selection requires at least 1 S-class starter and excludes L-class athletes; GP/GI womens-only rounds not in male scope.",
  "Grade classified by KDreams official meeting schedule venue and date, not inferred from S-class riders.",
  "Winners and winning payouts are outcomes, and DO NOT inform simulated ticket selection in the same race.",
  "Monthly CSV date can mean either actual race date or original meeting start: canonical actual date is decoded from 16-digit race_id (venue + YYYYMMDD meeting start + 2-digit meeting day + 4-digit race no); reported date must match actual or start.",
  "The per-race result payout is for a 100 yen unit. Refunds, scratch-driven ticket cancellations, and irregular equal-ranking combinations need further official reconciliation.",
  "Trying 6 boxes + 15 small boxes + position families creates multiple comparison effects; the best ex-post ROI is NOT a validated edge.",
  "No betting executed. Research branch only; no Railway, main, or production changes."
 ]}
 (ROOT/"grade-123579-one-year-20261117.json").write_text(json.dumps(info,ensure_ascii=False,indent=2)+"\n")
 def fmt(x):return "—" if x is None else f"{x:.1f}%"
 report=["# グレードレース・三連単123579 BOX：過去1年の収支と点数削減研究",
  "",
  f"対象：{START}〜{END}。GIII、GII、GI、GPの開催日を公式日程（KDreams）から抽出し、公開月次KDreamsスクレイピングCSVの結果と照合。",
  "**注意：取得・照合できたレースの集計であり、公式の過去一年全開催を網羅できたとは断定しない。**",
  "",
  "## 120点BOX：1・2・3・5・7・9",
  "",
  "| 9車レース | 的中 | 投資 | 払戻 | 回収率 | 最大5件除外 |",
  "|---:|---:|---:|---:|---:|---:|",
  f"| {full['races']}R | {full['hits']}R | {full['stake_yen']:,}円 | {full['payout_yen']:,}円 | {fmt(full['roi_pct'])} | {fmt(full['trim5_pct'])} |",
  "",
  "## グレード別（9車のみ）",
  "",
  "| グレード | 対象R | 的中R | 回収率 | 最大5件除外 |",
  "|---|---:|---:|---:|---:|"]
 for k,r in sorted(breakdown["grade"].items()):report.append(f"| {k} | {r['races']} | {r['hits']} | {fmt(r['roi_pct'])} | {fmt(r['trim5_pct'])} |")
 report+=["","## 年内時系列（9車のみ）","","| 月 | R | 回収率 | 最大5件除外 |","|---|---:|---:|---:|"]
 for k,r in sorted(breakdown["month"].items()):report.append(f"| {k} | {r['races']} | {fmt(r['roi_pct'])} | {fmt(r['trim5_pct'])} |")
 report+=["","## 点数削減ルールを全期間で比較（9車、事後探索）",
 "","| 方式 | 点数 | R | 的中 | 全期間回収率 | 最大5件除外 |",
 "|---|---:|---:|---:|---:|---:|"]
 for name in [k for k in strategies if k.startswith(("BOX6","BOX5","BOX4"))]:
  r=totals[name]
  report.append(f"| {name} | {len(strategies[name])} | {r['races']} | {r['hits']} | {fmt(r['roi_pct'])} | {fmt(r['trim5_pct'])} |")
 report+=["","## 期間を分けて削減の再現性を検証",
  f"学習期間：{START}〜2026年7月31日（{len(train)}R）、評価期間：2026年8月1日〜{END}（{len(holdout)}R）。",
  "","| 戦略 | 点数 | 学習ROI | 後半ROI | 後半最大5件除外 |",
  "|---|---:|---:|---:|---:|"]
 for name in ["BOX6_123579"]+ranked[:12]:
  trainp=train_perf[name];ho=hold_perf[name]
  report.append(f"| {name} | {len(strategies[name])} | {fmt(trainp['roi_pct'])} | {fmt(ho['roi_pct'])} | {fmt(ho['trim5_pct'])} |")
 report+=["",f"学習最大5件除外の首位：**{chosen}**。この成績は同じ期間の多数試行からの選別なので、**独立した将来データでの再検証が必須**。",
   f"月別前向き型（同じ対象期間内・毎月直前までで方式を選ぶ）回収率：{fmt(overall_fold['roi_pct'])}、同一月BOX120点：{fmt(overall_fold['baseline_roi_pct'])}。",
   "","## 取得範囲・欠損の監査",f"公式日程のG開催イベント {len(events)}件、G開催の場所×日付 {len(indexed)}件、CSV内の該当レース {len(all_by_id)}件、",
   f"払戻確認済み9車 {len(nine)}R、7車 {len(seven)}R。G開催の場所×日付で結果を1Rも確認できなかった日 {len(info['coverage']['missing_scheduled_days'])}件。",
   "","欠損の内訳："+json.dumps(dict(excluded),ensure_ascii=False),
   "","## 結論上の留意点",
   "- 9車120点BOXと7車60点BOXは別計算。",
   "- グレード判定は開催日程の会場・日付で照合。GIII開催の初日から最終日まで全レースを対象。",
   "- 的中したレースだけを残す、事後払戻を使って買い目を選ぶ、といった結果漏洩は禁止。",
   "- 公式払戻との独立照合が必要で、特に2026年CSV欠損や月を跨ぐ開催は不足情報の可能性がある。",
   "- 多数の絞り込み候補の最高値は多重比較の後知恵が含まれる。",
   "- 本番main・Railway・自動通知は変更していない。",
   "",
   "検証に使った月次CSVのURL・SHA256、開催日程ページのSHA256、全レース別BOX払戻、各方式全件結果は同名JSONに保存。"]
 (ROOT/"grade-123579-one-year-20261117-ja.md").write_text("\n".join(report)+"\n")
 print("GRADE_123579_AUDIT_COMPLETE",json.dumps({"n9":len(nine),"n7":len(seven),"fixtures":len(events),
  "unmatched_days":len(info["coverage"]["missing_scheduled_days"]),
  "roi9":full["roi_pct"],"hits":full["hits"],"stake":full["stake_yen"],"payout":full["payout_yen"],
  "trim5":full["trim5_pct"],"train":len(train),"hold":len(holdout),"selected":chosen,
  "selection_hold_roi":hold_perf[chosen]["roi_pct"] if chosen else None,"wf":overall_fold,
  "excluded":dict(excluded)},ensure_ascii=False).strip(),flush=True)
if __name__=="__main__":main()
