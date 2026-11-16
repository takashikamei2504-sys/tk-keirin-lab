#!/usr/bin/env python3
"""Outcome-blind annual stage classification, with out-of-time verification.

Source 1: publicly archived historical monthly rider records (race IDs, class, payout).
Source 2: daily race cards with *published* program round names, Aug-Nov 2026.
Only verified high-precision (class,day-of-meeting,race-no) stage proxies are considered.
No historical engine predictions or private-API scraping. Estimated stages stay distinct
from exact published stage labels. Payout is NEVER used to train or select stage proxies.
"""
import csv,datetime,io,json,math,collections,concurrent.futures,pathlib,re,unicodedata,urllib.request,statistics,hashlib
START=datetime.date(2025,11,16)
END=datetime.date(2026,11,15)
DATA_START=datetime.date(2026,8,18)
TRAIN_END=datetime.date(2026,10,15)
MONTHS=[f"2025_{m:02d}" for m in (11,12)]+[f"2026_{m:02d}" for m in range(1,12)]
CSV_BASE="https://raw.githubusercontent.com/Kenseimk/keirin-data/main/keirin_data/{}_keirin.csv"
JSON_BASE="https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/{}.json"
HEADERS={"User-Agent":"tk-keirin-lab annual research (+https://github.com/takashikamei2504-sys/tk-keirin-lab)"}
CATS=("A級_7","S級_7","S級_9","チャレンジ_7")
STAGES=("勝ち上がり戦","決勝","敗者戦","初日特選","特選等","その他")
def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers=HEADERS),timeout=45) as r:return r.read()
def fetch_csv(month):
    raw=fetch(CSV_BASE.format(month))
    return month,list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))),hashlib.sha256(raw).hexdigest()
def fetch_json(day):
    raw=fetch(JSON_BASE.format(day))
    o=json.loads(raw)
    if o.get("date")!=day or not isinstance(o.get("races"),list):raise ValueError("Wrong day json")
    return day,o
def norm(text):
    return re.sub(r"\s+","",unicodedata.normalize("NFKC",str(text or "")))
def class_of(rows):
    rs=[norm(x.get("player_class")) for x in rows]
    nums={str(r.get("banum")) for r in rows}
    if len(nums)!=len(rows):return None
    if any(x.startswith("L") for x in rs):return None
    if all(x=="A3" for x in rs):return "チャレンジ_"+str(len(rs))
    if any(x.startswith("S") for x in rs):return "S級_"+str(len(rs))
    if all(x.startswith("A") for x in rs):return "A級_"+str(len(rs))
    return None
def actual_date(rid):
    try:
        if len(rid)!=16 or not rid.isdigit():return None
        s=datetime.date(int(rid[2:6]),int(rid[6:8]),int(rid[8:10]))
        day=int(rid[10:12]);no=int(rid[12:])
        if day not in range(1,6) or no not in range(1,13):return None
        return s+datetime.timedelta(days=day-1),day,no,rid[:2]
    except (ValueError,OverflowError):return None
def payout_from(rows):
    for r in rows:
        text=r.get("san_ren_tan") or ""
        m=re.search(r"([1-9])\s*-\s*([1-9])\s*-\s*([1-9])\s+([\d,]+)\s*円",text)
        if m and len(set(m.group(1,2,3)))==3:
            p=int(m.group(4).replace(",",""))
            if p>0:return p
    return None
def stage_of(round_name,meeting_day):
    name=norm(round_name)
    if not name:return "その他"
    if "決勝" in name:return "決勝"
    if meeting_day=="初日" and re.search(r"初日特選|特別選抜|特選",name):return "初日特選"
    if re.search(r"準決|準々決|予選|勝ち上がり",name):return "勝ち上がり戦"
    if re.search(r"特別選抜|特選|特秀|特優",name):return "特選等"
    if re.search(r"一般|特一般|選抜|敗者|順位",name):return "敗者戦"
    return "その他"
def is_same_riders(rows,entries):
    if len(rows)!=len(entries):return False
    names={str(r.get("banum")):norm(r.get("player_name")) for r in rows}
    if len(names)!=len(rows):return False
    hits=0
    for e in entries:
        a=norm(e.get("rider_full_name") or e.get("rider_name"))
        b=names.get(str(e.get("car_number")),"")
        if a and b and (a.startswith(b) or b.startswith(a)) and min(len(a),len(b))>=3:hits+=1
    return hits>=max(5,len(entries)-1)
def keys(row):
    c,di,no,venue,maxno=row["class"],row["day_index"],row["race_no"],row["venue_code"],row["max_race"]
    # A racing "final" can be non-last when different grades share a meeting.
    from_end=maxno-no
    return [
      ("specific",c,di,no,maxno),
      ("relative",c,di,from_end),
      ("race_no",c,di,no),
      ("day",c,di)
    ]
def wilson_lower(w,n,z=1.645):
    if not n:return 0
    p=w/n;d=1+z*z/n
    return (p+z*z/(2*n)-z*math.sqrt((p*(1-p)+z*z/(4*n))/n))/d
def build_counts(train):
    counts=collections.defaultdict(collections.Counter)
    for row in train:
        for key in keys(row):counts[key][row["stage"]]+=1
    return counts
MIN_SUPPORT={"specific":12,"relative":25,"race_no":25,"day":50}
def classify(row,counts):
    for k in keys(row):
        kinds=counts.get(k)
        if not kinds:continue
        total=sum(kinds.values())
        if total<MIN_SUPPORT[k[0]]:continue
        stage,winner=kinds.most_common(1)[0]
        if winner/total>=0.95 and wilson_lower(winner,total)>=0.83:
            return stage,{"basis":k[0],"n_train":total,"train_purity":round(winner/total,4)}
    return None,None
def summarize(rows):
    counts=collections.Counter()
    for r in rows:counts[r["stage"]]+=1
    return dict(counts)
def summarize_pred(rows,model,known=True):
    verdict=[]
    for r in rows:
        stage,confidence=classify(r,model)
        verdict.append({"stage":r["stage"],"predicted":stage,"category":r["class"],"meta":confidence})
    matches=[x for x in verdict if x["predicted"]]
    matches_by=collections.defaultdict(list)
    for r in matches:matches_by[r["predicted"]].append(r)
    stage_eval={}
    for stage in STAGES:
        predicted=matches_by[stage]
        hits=sum(x["stage"]==stage for x in predicted)
        n_real=sum(x["stage"]==stage for x in verdict)
        covered=sum(x["predicted"]==stage and x["stage"]==stage for x in predicted)
        stage_eval[stage]={"predicted":len(predicted),"correct":hits,
         "precision":round(hits/len(predicted),4) if predicted else None,
         "recall":round(covered/n_real,4) if n_real else None}
    return {"n":len(rows),"predicted":len(matches),"correct":sum(x["stage"]==x["predicted"] for x in matches),
      "precision":round(sum(x["stage"]==x["predicted"] for x in matches)/len(matches),4) if matches else None,
      "coverage":round(len(matches)/len(rows),4) if rows else None,
      "by_stage":stage_eval,
      "by_category":{c:{"evaluated":sum(x["category"]==c for x in verdict),
                        "predicted":sum(x["category"]==c and x["predicted"] for x in matches),
                        "correct":sum(x["category"]==c and x["predicted"]==x["stage"] for x in matches)} for c in CATS}}
# fetch 13 calendar-month archives and 90 daily racecard JSONs, only raw.githubusercontent.com
months={};daily={};errors={};source_hashes={}
dates=[DATA_START+datetime.timedelta(days=i) for i in range((END-DATA_START).days+1)]
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    tasks={}
    for m in MONTHS:tasks[pool.submit(fetch_csv,m)]=("csv",m)
    for d in dates:tasks[pool.submit(fetch_json,d.isoformat())]=("json",str(d))
    for f in concurrent.futures.as_completed(tasks):
        try:
            kind,key=tasks[f]
            if kind=="csv":
                m,rr,sha=f.result();months[m]=rr;source_hashes[m]=sha
            else:
                d,raw=f.result();daily[d]=raw
        except Exception as e:
            errors["/".join(tasks[f])]=str(e)
if errors:raise RuntimeError("Incomplete historical source:"+str(errors)[:1000])
by_id=collections.defaultdict(list)
for arr in months.values():
    for r in arr:by_id[str(r.get("race_id",""))].append(r)
inventory=[];rejected=collections.Counter()
by_date_no=collections.defaultdict(list)
for rid,rs in by_id.items():
    data=actual_date(rid)
    if data is None:rejected["invalid_race_id"]+=1;continue
    d,idx,rno,venue_code=data
    if not START<=d<=END:rejected["out_of_year"]+=1;continue
    if any(not (str(r.get("date"))==str(d) or str(r.get("date"))==rid[2:6]+"-"+rid[6:8]+"-"+rid[8:10]) for r in rs):
        rejected["bad_date"]+=1;continue
    # Preserve one copy per car if files overlap without suppressing genuine duplicates.
    by_car={}
    for r in rs:
        c=str(r.get("banum"))
        if c in by_car and (norm(r.get("player_name"))!=norm(by_car[c].get("player_name")) or r.get("player_class")!=by_car[c].get("player_class")):
            rejected["conflicting_duplicate"]+=1;by_car={};break
        by_car[c]=r
    riders=list(by_car.values());class_name=class_of(riders)
    if class_name not in CATS:continue
    row={"race_id":rid,"date":d.isoformat(),"class":class_name,"day_index":idx,
      "race_no":rno,"venue_code":venue_code,"payout":payout_from(riders),"riders":riders}
    inventory.append(row);by_date_no[(str(d),rno)].append(row)
# Infer last race number by the same venue / day, never from the outcome.
max_race=collections.defaultdict(int)
for r in inventory:
    key=(r["date"],r["venue_code"])
    max_race[key]=max(max_race[key],r["race_no"])
for r in inventory:r["max_race"]=max_race[r["date"],r["venue_code"]]
exact=[];used=set()
joining=collections.Counter()
for d,body in sorted(daily.items()):
    venue_info=body.get("venue_info") or {}
    for rr in body.get("races",[]):
        es=rr.get("entries") or []
        if len(es) not in (7,9) or rr.get("is_girls") or any(norm(e.get("class_rank")).startswith("L") for e in es):continue
        no=int(rr.get("race_number") or 0)
        match=[r for r in by_date_no.get((d,no),[]) if is_same_riders(r["riders"],es)]
        if not match:joining["no_match"]+=1;continue
        if len(match)!=1:joining["ambiguous"]+=1;continue
        base=match[0]
        if base["race_id"] in used:joining["duplicate"]+=1;continue
        used.add(base["race_id"])
        meeting=venue_info.get(rr.get("venue"),{}).get("meeting_day","")
        stage=stage_of(rr.get("round_name"),meeting)
        if stage=="その他":joining["round_unknown"]+=1;continue
        exact.append({k:v for k,v in base.items() if k!="riders"} | {"stage":stage,"round_name":rr.get("round_name"),"meeting_day":meeting})
train=[x for x in exact if x["date"]<=str(TRAIN_END)]
hold=[x for x in exact if x["date"]>str(TRAIN_END)]
model=build_counts(train)
validation=summarize_pred(hold,model)
# Freeze quality gate: absent or sub-95%-precision stage is UNRESOLVED.
eligible_stages=[k for k,v in validation["by_stage"].items() if v["predicted"]>=20 and v["precision"] is not None and v["precision"]>=0.95]
# No holdout outcome was used. Only the known program labels were used for quality assurance.
annual=[]
by_grade_day=collections.defaultdict(list)
category=collections.defaultdict(list)
for r in inventory:
    key=r["class"]+"|day"+str(r["day_index"])
    by_grade_day[key].append(r["payout"])
    if r["race_id"] in used:continue
    stage,extra=classify(r,model)
    if stage not in eligible_stages:continue
    annual.append({"class":r["class"],"date":r["date"],"stage":stage,"payout":r["payout"],
       "basis":extra["basis"]})
for row in annual:category[row["class"]+"|"+row["stage"]].append(row)
def payout_stats(rows):
    if rows and isinstance(rows[0],dict):
        nums=[r["payout"] for r in rows if r["payout"] is not None]
    else:nums=[x for x in rows if x is not None]
    return {"n":len(rows),"n_with_payout":len(nums),
      "median_payout_yen":int(statistics.median(nums)) if nums else None,
      "average_payout_yen":round(statistics.mean(nums)) if nums else None,
      "payout_50to100x":sum(5000<=p<10000 for p in nums),
      "payout_100x_plus":sum(p>=10000 for p in nums),
      "payout_100x_share":round(sum(p>=10000 for p in nums)/len(nums),4) if nums else None}
report={"schema":"tk-keirin-annual-stage-inference-oot-v1",
  "period":{"start":str(START),"end":str(END),
    "available_exact_source_from":str(DATA_START),"train_end":str(TRAIN_END),"test_from":str(TRAIN_END+datetime.timedelta(days=1))},
  "meaning":"High-precision proxy PROGRAM CLASSIFICATION ONLY; it is not 8-engine annual backtest.",
  "source_hashes":source_hashes,"counts":{"annual_male_7_9":len(inventory),
    "exact_program_joined":len(exact),"train":len(train),"out_of_time_test":len(hold),
    "high_confidence_annual_without_true_labels":len(annual)},
  "rejected":dict(rejected),"joins":dict(joining),"true_stage_distribution":summarize(exact),
  "train_stage_distribution":summarize(train),"holdout_stage_distribution":summarize(hold),
  "classifier":{"method":"Hierarchical program-stage majority for graded meeting day index + race number; 90% Wilson lower bound >= .83; >=95% training purity. No winner/payout features.",
     "support":MIN_SUPPORT,"validation":validation,"eligible_stages":eligible_stages},
  "exact_annual_by_grade_day_index":{k:payout_stats(v) for k,v in sorted(by_grade_day.items())},
  "estimated_annual_by_stage":{k:payout_stats(v) for k,v in sorted(category.items())},
  "limitations":["Exact public round labels and line positions still unavailable before 2026-08-18.",
    "High-confidence inferred stage labels are not verified actual program labels; should not be used as if known.",
    "Source CSV payout fields are unverified; their distribution does not represent a betting ROI.",
    "Existing lineup-based engines cannot be faithfully replayed on historic records with no actual lineup.",
    "Classifier training, selection and validation do not use payouts/finishing order.",
    "Do not choose real-money betting strategy based on estimated stage results." ]}
path=pathlib.Path("reports/year-race-type/annual-stage-validation.json")
path.parent.mkdir(parents=True,exist_ok=True)
path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("YEAR_STAGE_VALIDATION",json.dumps({"counts":report["counts"],"holdout":validation,
     "eligible_stages":eligible_stages,"estimated_categories":report["estimated_annual_by_stage"],
     "rejected":dict(rejected),"joining":dict(joining)},ensure_ascii=False),flush=True)
