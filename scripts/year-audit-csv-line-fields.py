#!/usr/bin/env python3
"""Inspect all twelve immutable public monthly CSV files for ACTUAL pre-race lineup
values, despite README claiming a lineup field. No private/bulk publisher scraping.
Only field names, counts, sample format hashes and limited example strings saved.
"""
import collections,concurrent.futures,csv,io,json,hashlib,urllib.request,pathlib,re
COMMIT="55c425947770080fe3f3629720cda0f4ede69b9e"
BASE=f"https://raw.githubusercontent.com/Kenseimk/keirin-data/{COMMIT}/keirin_data/{{}}_keirin.csv"
MONTHS=["2025_11","2025_12"]+[f"2026_{m:02d}" for m in range(1,12)]
def fetch(month):
 req=urllib.request.Request(BASE.format(month),headers={'User-Agent':'tk-keirin-lab/20261116-public-data-schema-check'})
 with urllib.request.urlopen(req,timeout=45) as r:raw=r.read(9000000)
 c=csv.DictReader(io.StringIO(raw.decode('utf-8-sig',errors='replace')))
 fields=c.fieldnames or [];keys=[x for x in fields if any(w in x.lower() for w in ('line','narabi','formation','order','position','並び','ライン'))]
 stats={k:{"nonempty_rows":0,"distinct_sample":[],"total_rows":0} for k in keys}
 totals=0;seen=set()
 for row in c:
  totals+=1;seen.add(str(row.get('race_id','')))
  for k in keys:
   v=str(row.get(k) or '').strip()
   o=stats[k];o["total_rows"]+=1
   if v and v.lower() not in ('null','none','nan','-','[]','{}'):
    o['nonempty_rows']+=1
    if v not in o['distinct_sample'] and len(o['distinct_sample'])<5:o['distinct_sample'].append(v[:80])
 return {"month":month,"source_sha256":hashlib.sha256(raw).hexdigest(),"rows":totals,"distinct_race_ids":len(seen),
         "all_fields":fields,"line_candidate_columns":stats}
results=[];errs={}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 futures={pool.submit(fetch,m):m for m in MONTHS}
 for f in concurrent.futures.as_completed(futures):
  try:results.append(f.result())
  except Exception as e:errs[futures[f]]=str(e)[:190]
if errs or len(results)!=len(MONTHS):raise RuntimeError("Incomplete source or changed schema "+str(errs))
results.sort(key=lambda o:o['month'])
out={"schema":"tk-keirin-annual-monthly-line-schema-audit/v1",
 "date_range":"2025-11-16..2026-11-15","source_commit":COMMIT,
 "interpretation":"No lineup can be inferred from README alone; only nonempty actual CSV fields count.",
 "months":results,"issues":errs}
root=pathlib.Path("reports/year-race-type");root.mkdir(parents=True,exist_ok=True)
(root/"annual-monthly-lineup-column-audit.json").write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding='utf8')
print("ANNUAL_CSV_LINEUP_SCHEMA",json.dumps([{"month":x["month"],"races":x["distinct_race_ids"],"lines":x["line_candidate_columns"],"fields":x["all_fields"]} for x in results],ensure_ascii=False)[:16000],flush=True)
