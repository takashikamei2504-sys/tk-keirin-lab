#!/usr/bin/env python3
"""Fast fully auditable rational+irrational third-place free research.
Historical source SHA256 checked; use saved B-AXIS projected head, NOT current results.
Rational pairs: predicted B head / line follower, plus reverse order.
Rational third: top-rated remaining rider. Add or swap third digit #1..#9,
date-derived, lowest-score, outside-line, and deterministic placebo.
Predictions are CURRENT NOVEMBER replay and not contemporaneous frozen tickets.
"""
import datetime as dt,hashlib,json,os,pathlib,time,urllib.request
R=pathlib.Path("reports/year-race-type")
i=int(os.environ.get("FUN_SHARD","-1"))
if i not in range(18):raise RuntimeError("Invalid FUN_SHARD")
source=json.loads((R/"complete90-eight-engine-audit.json").read_text())
original={x["race_id"]:x for x in source["races"]}
assert len(original)==5745 and source["source"]["pinned_commit"]=="4588ec938a2fec9e81216d3fd3423329805aa3d5"
f=json.loads((R/"baxis90-shards"/f"part-{i}.json").read_text())
assert f["schema"]=="tk-keirin-90day-baxis-v06-shard/v1" and f["completed"]==f["expected"] and f["incomplete"]==0 and f["shard"]==i
baxis={x["id"]:x for x in f["rows"]}
dates=[(dt.date(2026,8,18)+dt.timedelta(days=5*i+k)).isoformat() for k in range(5)]
def fetch(date):
 url=f"https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/4588ec938a2fec9e81216d3fd3423329805aa3d5/{date}.json"
 for attempt in range(3):
  try:
   req=urllib.request.Request(url,headers={"User-Agent":"tk-keirin-lab-research-numerical-free-study"})
   with urllib.request.urlopen(req,timeout=40) as response:raw=response.read()
   sha=hashlib.sha256(raw).hexdigest()
   if sha!=source["source"]["day_sha256"][date] or sha!=f["source_day_sha256"][date]:raise ValueError("Source SHA256 mismatch")
   day=json.loads(raw)
   if day["date"]!=date:raise ValueError("Date mismatch")
   return day
  except Exception:
   if attempt==2:raise
   time.sleep(attempt+1)
def get_results(card):
 rows=card.get("result_combos") or card.get("payouts",{}).get("trifecta") or []
 if not rows and card.get("result_top3") and card.get("payout_trifecta"):
  rows=[{"combo":card["result_top3"],"payout":card["payout_trifecta"]}]
 results={}
 for z in rows:
  trio=z["combo"];k="-".join(map(str,trio));p=int(z["payout"])
  if len(trio)!=3 or len(set(trio))!=3 or p<=0 or k in results:raise ValueError("Payout invalid")
  results[k]=p
 if not results:raise ValueError("No result")
 return results
def pay(keys,winners):
 if len(keys)!=len(set(keys)):raise ValueError("Duplicated selected ticket")
 return {"n":len(keys),"s":100*len(keys),"p":sum(winners.get(k,0) for k in keys)}
def hh(text):
 return int(hashlib.sha256(text.encode()).hexdigest()[:12],16)
def prep(card,b):
 e=card["entries"];nums=sorted(int(x["car_number"]) for x in e)
 if len(nums) not in (7,9) or nums!=list(range(1,len(nums)+1)):raise ValueError("Car numbers")
 ranks={int(x["car_number"]):float(x["competition_score"]) for x in e}
 lines={}
 for x in e:
  line,pos=map(int,str(x["line_position"]).split("-"))
  lines.setdefault(line,[]).append((pos,int(x["car_number"])))
 lineups=[list(n for pos,n in sorted(l)) for _,l in sorted(lines.items())]
 if sorted(n for l in lineups for n in l)!=nums:raise ValueError("Not all riders in lineup")
 for l in lines.values():
  if [n for n,x in sorted(l)]!=list(range(1,len(l)+1)):raise ValueError("Line gaps")
 head=int(b["b_axis_head"])
 if head not in nums:raise ValueError("Predicted head not starter")
 group=next(l for l in lineups if head in l)
 # Predict first/second from B winner + planned lineup follower, then reverse order.
 follow=group[1] if group[0]==head and len(group)>1 else None
 if follow is None:
  follow=max((n for n in nums if n!=head),key=lambda n:(ranks[n],-n))
 pairs=[[head,follow],[follow,head]]
 if not (pairs[0][0]!=pairs[0][1] and pairs[1][0]!=pairs[1][1]):raise ValueError("Invalid first/second")
 return nums,ranks,lineups,pairs
def predict(card,b,rid,winners):
 nums,score,lineup,pairs=prep(card,b)
 result={}
 for depth in (1,2):
  active=pairs[:depth]
  base=[],[]
  base=[]
  eligible_by_pair=[]
  for a,c in active:
   remaining=[n for n in nums if n not in (a,c)]
   logical=max(remaining,key=lambda n:(score[n],-n))
   key=f"{a}-{c}-{logical}"
   base.append(key)
   eligible_by_pair.append((a,c,[n for n in remaining if f"{a}-{c}-{n}"!=key]))
  if len(set(base))!=len(base):raise ValueError("Duplicate baseline")
  extras={}
  for fixed in range(1,10):
   extras[f"digit_{fixed}"]=[f"{a}-{c}-{fixed}" for a,c,eligible in eligible_by_pair if fixed in eligible]
  date_keys=[];random_keys=[];weak_keys=[];outside_keys=[]
  six_keys=[];control_keys=[]
  for a,c,eligible in eligible_by_pair:
   if not eligible:continue
   num=(int(card["start_time"][:2])+int(rid.split(":")[0][-2:])+int(card["race_number"]))%len(nums)
   rotate=nums[num:]+nums[:num]
   choice=next((n for n in rotate if n in eligible),None)
   if choice is not None:date_keys.append(f"{a}-{c}-{choice}")
   rnd=eligible[hh(f"{rid}|{a}-{c}|random:v1")%len(eligible)]
   random_keys.append(f"{a}-{c}-{rnd}")
   weak=min(eligible,key=lambda n:(score[n],n))
   weak_keys.append(f"{a}-{c}-{weak}")
   others=[n for n in eligible if not any(a in l and n in l for l in lineup) and not any(c in l and n in l for l in lineup)]
   if others:outside_keys.append(f"{a}-{c}-{min(others,key=lambda n:(score[n],n))}")
   possible=[n for n in eligible if n!=6]
   if 6 in eligible and possible:
    six_keys.append(f"{a}-{c}-6")
    ctrl=possible[hh(f"{rid}|{a}-{c}|control:v1")%len(possible)]
    control_keys.append(f"{a}-{c}-{ctrl}")
  extras.update({"date_digit":date_keys,"random":random_keys,"lowest_score":weak_keys,
                 "outside_line":outside_keys,"matched6":six_keys,"matched_random6":control_keys})
  if len(six_keys)!=len(control_keys):raise ValueError("Matched placebo sizes differ")
  calculations={"base":pay(base,winners),"extra":{k:pay(v,winners) for k,v in extras.items()}}
  if depth==1:
   swaps={}
   for k in ("digit_6","digit_7","random","date_digit","lowest_score","matched_random6"):
    vals=extras[k]
    if len(vals)==1 and vals[0]!=base[0]:
     swaps[k]={"before":pay(base,winners),"after":pay([vals[0]],winners)}
   calculations["swaps"]=swaps
  result[str(depth)]=calculations
 return result
days=[fetch(d) for d in dates]
cards={}
for day in days:
 for card in day["races"]:
  rid=day["date"]+":"+str(card["venue"])+":"+str(card["race_number"])
  if rid in cards:raise ValueError("Duplicate source race")
  cards[rid]=card
rows=[];failed={}
for rid,b in sorted(baxis.items()):
 try:
  o=original[rid];card=cards[rid]
  if o["date"] not in dates or card["is_girls"] or len(card["entries"])!=o["cars"] or o["round"]!=card["round_name"]:
   raise ValueError("Race mismatch")
  observed=get_results(card)
  row={"id":rid,"date":o["date"],"cars":o["cars"],"category":o["category"],
   "stage":o["stage"],"meeting":o["meeting_day"],"agreement":b["agreement"],
   "nonfavorite":b["proxy_nonfavorite"],"observed_winning_keys":len(observed),
   "depth":predict(card,b,rid,observed)}
  rows.append(row)
 except Exception as exc:
  reason=type(exc).__name__+": "+str(exc)
  failed[reason]=failed.get(reason,0)+1
out={"schema":"tk-keirin-fun-third-score-and-b-head-replay/v1","shard":i,"source_sha":source["source"]["pinned_commit"],
     "dates":dates,"expected":len(baxis),"completed":len(rows),"failures":failed,"rows":rows,
     "method":"BAXIS saved projected head, pre-result lineup and scores; new rational 1-2/3 ticket, not original AUTO/B-UPSET ticket set."}
outdir=R/"fun-lite-shards";outdir.mkdir(parents=True,exist_ok=True)
(outdir/f"part-{i}.json").write_text(json.dumps(out,ensure_ascii=False)+"\n")
print("FUN_LITE_SHARD",json.dumps({"shard":i,"expected":len(baxis),"completed":len(rows),"failures":failed},ensure_ascii=False))
if failed or len(rows)!=len(baxis):raise RuntimeError("Source-complete cohort failed")
