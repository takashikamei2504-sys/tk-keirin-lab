#!/usr/bin/env python3
"""Reconcile 90 archived daily sources to annual CSV with car-specific rider identity.

Payout restoration is accepted only if race id/date/class and >=n-1 rider
names match a UNIQUE candidate, with no contradictory independently recorded
trifecta. No ungrounded result/odds inference, no race sample selection.
Sources pinned to specific public GitHub immutable commits.
"""
import collections,concurrent.futures,csv,datetime,hashlib,io,json,pathlib,re,unicodedata,urllib.request
START=datetime.date(2026,8,18);END=datetime.date(2026,11,15)
CSV_COMMIT='55c425947770080fe3f3629720cda0f4ede69b9e'
DAILY_COMMIT='4588ec938a2fec9e81216d3fd3423329805aa3d5'
CSV_BASE=f'https://raw.githubusercontent.com/Kenseimk/keirin-data/{CSV_COMMIT}/keirin_data/{{}}_keirin.csv'
DAILY_BASE=f'https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/{DAILY_COMMIT}/{{}}.json'
OUT=pathlib.Path('reports/year-race-type');OUT.mkdir(exist_ok=True,parents=True)
UA={'User-Agent':'TK-Keirin-Lab/annual-payout-source-reconciliation'}
def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=45) as r:return r.read()
def load_csv(month):
    raw=fetch(CSV_BASE.format(month))
    return month,list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))),hashlib.sha256(raw).hexdigest()
def load_day(date):
    raw=fetch(DAILY_BASE.format(date));doc=json.loads(raw)
    if doc.get('date')!=date or not isinstance(doc.get('races'),list):raise ValueError('Bad daily source '+date)
    return date,doc,hashlib.sha256(raw).hexdigest()
def normal(s):
    return re.sub(r'\s+','',unicodedata.normalize('NFKC',str(s or '')))
def normalized_date(rid):
    try:
        d=datetime.date(int(rid[2:6]),int(rid[6:8]),int(rid[8:10]))
        idx=int(rid[10:12]);no=int(rid[12:])
        if idx not in range(1,6) or no not in range(1,13):return None
        return (d+datetime.timedelta(days=idx-1)).isoformat(),no
    except (ValueError,OverflowError):return None
def legacy_payout(rows):
    for r in rows:
        t=r.get('san_ren_tan') or ''
        m=re.search(r'([1-9])\s*-\s*([1-9])\s*-\s*([1-9])\s+([\d,]+)\s*円',t)
        if m and len(set(m.group(1,2,3)))==3:
            n=int(m.group(4).replace(',',''))
            if n>0:return (m.group(1)+'-'+m.group(2)+'-'+m.group(3),n)
    return None
def published_payout(src):
    results=src.get('result_combos')
    if not isinstance(results,list) or not results:
        results=(src.get('payouts') or {}).get('trifecta')
    if not isinstance(results,list) or not results:
        results=[{'combo':src.get('result_top3'),'payout':src.get('payout_trifecta')}]
    valid=[]
    for r in results:
        combo=r.get('combo');amount=r.get('payout')
        if not isinstance(combo,list) or len(combo)!=3:continue
        if not all(isinstance(x,int) for x in combo) or len(set(combo))!=3:continue
        if not isinstance(amount,int) or amount<=0:continue
        valid.append(('-'.join(map(str,combo)),amount))
    return sorted(set(valid))
def score(rows,entries):
    if len(rows)!=len(entries):return -1
    roster={str(r.get('banum')):normal(r.get('player_name')) for r in rows}
    if len(roster)!=len(entries):return -1
    good=0
    for e in entries:
        name=normal(e.get('rider_full_name') or e.get('rider_name'))
        a=roster.get(str(e.get('car_number')),'')
        if name and a and min(len(name),len(a))>=3 and (name.startswith(a) or a.startswith(name)):good+=1
    return good
def main():
    months=['2026_08','2026_09','2026_10','2026_11']
    dates=[(START+datetime.timedelta(days=i)).isoformat() for i in range((END-START).days+1)]
    records={};docs={};errors={};hashes={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        futures={pool.submit(load_csv,m):('csv',m) for m in months}
        futures.update({pool.submit(load_day,d):('day',d) for d in dates})
        for f in concurrent.futures.as_completed(futures):
            kind,key=futures[f]
            try:
                if kind=='csv':
                    m,rows,sha=f.result();records[m]=rows;hashes[m]=sha
                else:
                    d,day,sha=f.result();docs[d]=day;hashes[d]=sha
            except Exception as e:errors[kind+':'+key]=str(e)
    if errors:raise RuntimeError('Pinned source availability incomplete: '+str(errors)[:900])
    byid=collections.defaultdict(list)
    for arr in records.values():
        for r in arr:byid[str(r.get('race_id'))].append(r)
    indexed=collections.defaultdict(list)
    for rid,rows in byid.items():
        parts=normalized_date(rid)
        if parts and START.isoformat()<=parts[0]<=END.isoformat():
            # Source duplicate in multiple months is allowed only when car names are same.
            carmap={}
            for r in rows:
                car=str(r.get('banum',''))
                if car in carmap and normal(r.get('player_name'))!=normal(carmap[car].get('player_name')):
                    carmap={};break
                carmap[car]=r
            if len(carmap) in (7,9):
                indexed[parts].append((rid,list(carmap.values())))
    tally=collections.Counter()
    results=[];mismatches=[];ids=set()
    for day,source in sorted(docs.items()):
        for race in source['races']:
            entrants=race.get('entries') or []
            if race.get('is_girls') or len(entrants) not in (7,9):continue
            no=race.get('race_number')
            if not isinstance(no,int):continue
            tally['daily_male_7_9']+=1
            cases=[]
            for rid,rows in indexed.get((day,no),[]):
                if len(rows)!=len(entrants):continue
                n=score(rows,entrants)
                if n>=len(entrants)-1:cases.append((n,rid,rows))
            cases.sort(reverse=True,key=lambda x:x[0])
            if not cases:tally['no_verified_identity']+=1;continue
            if len(cases)>1 and cases[0][0]==cases[1][0]:tally['ambiguous_identity']+=1;continue
            n,rid,rows=cases[0]
            if rid in ids:tally['duplicate_race_id']+=1;continue
            ids.add(rid)
            tally['unique_verified_identity']+=1
            previous=legacy_payout(rows);extra=published_payout(race)
            if not extra:
                tally['daily_no_valid_payout']+=1
                continue
            if previous is not None:
                if previous not in extra:
                    tally['payout_conflict']+=1
                    if len(mismatches)<20:mismatches.append({'id':rid,'date':day,'old':previous,'new':extra})
                    continue
                tally['already_recorded_matches']+=1
            else:
                tally['newly_restored_payouts']+=1
                results.append({'race_id':rid,'date':day,'category':('S級' if any(str(x.get('player_class','')).startswith('S') for x in rows) else 'A級')+'_'+str(len(rows)),
                    'payouts':[{'key':key,'payout':amount} for key,amount in extra],
                    'source_date_sha256':hashes[day],'rider_name_matches':n,
                    'origin':'archived_daily_json', 'source_date':day})
    f=OUT/'annual-2026-90day-restored-trifecta.jsonl'
    with f.open('w',encoding='utf8') as h:
        for row in sorted(results,key=lambda r:r['race_id']):h.write(json.dumps(row,ensure_ascii=False)+'\n')
    report={'schema':'tk-keirin-annual-payout-complement-v1',
      'run_source':'pinned public 2026-08-18 through 2026-11-15 daily JSON + monthly CSV',
      'commits':{'csv':CSV_COMMIT,'daily':DAILY_COMMIT},
      'counts':dict(tally),'conflicts':mismatches,'days':len(docs),
      'restoration_file':str(f),'restoration_sha256':hashlib.sha256(f.read_bytes()).hexdigest(),
      'meaning':'Restores only exact identity matched archived 3連単 payout rows; not 8-model ROI or genuine race-day forecasting.',
      'notes':['No outcome-dependent race selection','No guessed results','Any conflict excluded','No external provider websites scraped'] }
    (OUT/'annual-90day-payout-restoration-summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('ANNUAL_PAYOUT_RESTORATION',json.dumps(report['counts'],ensure_ascii=False),flush=True)
if __name__=='__main__':main()
