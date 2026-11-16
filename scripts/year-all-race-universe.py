#!/usr/bin/env python3
"""Reproducible ALL-RACE annual male 7/9 car census, 2025-11-16..2026-11-15.

Uses one immutable public CSV Git commit only. No racecard scraping or model
prediction in this step. Output manifest represents 21k potential race records
rather than completed bets. Reconstruct actual date from ID with consistency
checks, no guessing missing payout, line, title or betting close time.

Payouts/finish are settlement only. Never use them for sampling.
"""
import collections,concurrent.futures,csv,datetime,hashlib,io,json,pathlib,re,urllib.request
START=datetime.date(2025,11,16)
END=datetime.date(2026,11,15)
COMMIT='55c425947770080fe3f3629720cda0f4ede69b9e'
SRC='https://raw.githubusercontent.com/Kenseimk/keirin-data/'+COMMIT+'/keirin_data/{}_keirin.csv'
MONTHS=[f'2025_{m:02d}' for m in (11,12)]+[f'2026_{m:02d}' for m in range(1,12)]
OUT=pathlib.Path('reports/year-race-type')
OUT.mkdir(parents=True,exist_ok=True)
def download(m):
    url=SRC.format(m)
    req=urllib.request.Request(url,headers={'User-Agent':'tk-keirin-lab annual-source-inventory/20261116'})
    with urllib.request.urlopen(req,timeout=50) as response:b=response.read()
    return m,list(csv.DictReader(io.StringIO(b.decode('utf-8-sig')))),hashlib.sha256(b).hexdigest()
def normalize(rid,rows):
    if not re.fullmatch(r'\d{16}',rid):return None,'bad_race_id'
    try:
        d=datetime.date(int(rid[2:6]),int(rid[6:8]),int(rid[8:10]))
        nth=int(rid[10:12]);race_no=int(rid[12:])
        if nth not in range(1,6) or race_no not in range(1,13):return None,'invalid_day_or_race'
        date=d+datetime.timedelta(days=nth-1)
    except Exception:return None,'bad_date'
    if not START<=date<=END:return None,'outside_period'
    source_days={str(r.get('date','')) for r in rows}
    if any(x not in {date.isoformat(),d.isoformat()} for x in source_days):return None,'calendar_conflict'
    bycar={}
    for row in rows:
        car=str(row.get('banum',''))
        if car in bycar and (row.get('player_name')!=bycar[car].get('player_name') or row.get('player_class')!=bycar[car].get('player_class')):
            return None,'rider_conflict'
        bycar[car]=row
    unique=list(bycar.values())
    if len(unique) not in (7,9):return None,'not_7_9'
    if set(bycar)!={str(i) for i in range(1,len(unique)+1)}:return None,'noncontiguous_car_numbers'
    c=[str(r.get('player_class','')).strip().upper() for r in unique]
    if any(x.startswith('L') for x in c):return None,'girls'
    grade='チャレンジ' if all(x=='A3' for x in c) else 'S級' if any(x.startswith('S') for x in c) else 'A級' if all(x.startswith('A') for x in c) else None
    if grade is None:return None,'unknown_grade'
    category=grade+'_'+str(len(unique))
    if category not in ('A級_7','S級_7','S級_9','チャレンジ_7'):
        return None,'other_male_grade'
    amount=None;combo=None
    for r in unique:
        text=str(r.get('san_ren_tan') or '')
        match=re.search(r'([1-9])\s*-\s*([1-9])\s*-\s*([1-9])\s+([\d,]+)\s*円',text)
        if match:
            a,b,c,p=match.groups()
            if len({a,b,c})==3:
                v=int(p.replace(',',''))
                if v>0:combo=f'{a}-{b}-{c}';amount=v;break
    styles=sum(str(x.get('running_style','')).strip() in ('逃','両','追') for x in unique)
    scores=0
    for x in unique:
        try:
            y=float(x.get('race_score',''))
            scores+=int(50<=y<=145)
        except Exception:pass
    venue_slugs={str(x.get('venue_slug','')) for x in unique}
    venue_slug=venue_slugs.pop() if len(venue_slugs)==1 else ''
    return {
      'race_id':rid,'date':date.isoformat(),'meeting_start':d.isoformat(),
      'day_index':nth,'race_no':race_no,'venue_code':rid[:2],
      'venue_slug':venue_slug,'category':category,'cars':len(unique),
      'valid_score_car_count':scores,'valid_style_car_count':styles,
      'payout_available':amount is not None,
      'winning_combo':combo,
      'trifecta_payout_yen':amount,
      'actual_round_name':None,'actual_lineup':None,
      'status':'ANNUAL_UNEVALUATED',
      'source':'Kenseimk/keirin-data immutable monthly CSV'
    },'eligible'
def main():
    data={};errors={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures={pool.submit(download,m):m for m in MONTHS}
        for f in concurrent.futures.as_completed(futures):
            try:
                m,rows,sha=f.result();data[m]=(rows,sha)
                print('SOURCE_MONTH',m,'rows',len(rows),flush=True)
            except Exception as e:errors[futures[f]]=str(e)
    if errors:raise RuntimeError('Incomplete source: '+json.dumps(errors))
    groups=collections.defaultdict(list)
    for m,(rows,_) in sorted(data.items()):
        for r in rows:groups[str(r.get('race_id'))].append(r)
    included=[];exclusions=collections.Counter()
    by_month=collections.defaultdict(collections.Counter)
    by_grade=collections.defaultdict(collections.Counter)
    for rid,rows in sorted(groups.items()):
        record,status=normalize(rid,rows)
        if record is None:
            exclusions[status]+=1;continue
        included.append(record)
        by_month[record['date'][:7]][record['category']]+=1
        by_grade[record['category']]['races']+=1
        if record['payout_available']:by_grade[record['category']]['payout_available']+=1
        if record['valid_score_car_count']==record['cars'] and record['valid_style_car_count']==record['cars']:by_grade[record['category']]['complete_score_and_style']+=1
    included.sort(key=lambda r:(r['date'],r['venue_code'],r['race_no'],r['race_id']))
    ids=[r['race_id'] for r in included]
    if len(ids)!=len(set(ids)):raise RuntimeError('Duplicate race ID')
    if len(ids)!=21695:raise RuntimeError('Annual census drift: expected 21695, got '+str(len(ids)))
    lines=OUT/'annual-all-race-manifest-20251116-20261115.jsonl'
    with lines.open('w',encoding='utf8') as f:
        for r in included:f.write(json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n')
    report={
      'schema':'tk-keirin-one-year-complete-universe-v1',
      'period':{'start':START.isoformat(),'end':END.isoformat()},
      'source':{'repo':'Kenseimk/keirin-data','commit':COMMIT,'files':{m:{'sha256':sha,'csv_rows':len(rr)} for m,(rr,sha) in sorted(data.items())}},
      'meaning':'Full annual candidate inventory, NOT completed predictions nor settled bets.',
      'total_eligible_census':len(included),
      'total_races_with_public_3rentan':sum(r['payout_available'] for r in included),
      'all_riders_have_score_style':sum(r['valid_score_car_count']==r['cars'] and r['valid_style_car_count']==r['cars'] for r in included),
      'by_grade':{k:dict(v) for k,v in sorted(by_grade.items())},
      'by_month':{k:dict(v) for k,v in sorted(by_month.items())},
      'excluded':dict(exclusions),
      'manifest_filename':str(lines),'manifest_sha256':hashlib.sha256(lines.read_bytes()).hexdigest(),
      'missing_inputs':['authentic published round for all pre-Aug-18 dates','verified full team line for all pre-Aug-18 dates','independently audited official payout where CSV is empty'],
      'no_result_selection':True,
      'daily_source_replay_period':'2026-08-18 through 2026-11-15 separately verified with eight-engine exhaustive 90-day workflow',
      'legacy_historical_sample':'2025-11 through 2026-08, 50 source-complete races only; not a representative sample',
      'completeness_note':'The complete year is 365 calendar days; historical 90-day period is a separate archived source, not year-wide model evidence.'}
    (OUT/'annual-all-race-inventory-summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print('YEAR_ALL_RACE_CENSUS',json.dumps({k:report[k] for k in ('total_eligible_census','total_races_with_public_3rentan','all_riders_have_score_style','by_grade','excluded')},ensure_ascii=False))
if __name__=='__main__':main()
