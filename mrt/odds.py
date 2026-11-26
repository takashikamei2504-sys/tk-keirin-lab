"""Periodic public trifecta observations and an independent MICRO price-aware plan.

No login, betting, model fitting or changes to original MICRO forecasts.
"""
import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_CEILING
from hashlib import sha256
from itertools import permutations
import json
from pathlib import Path
import re
from time import monotonic, sleep
from urllib.error import HTTPError

from two_t.kdreams_results import clean, key_for, links_for, name, one, read_page

ROOT=Path(__file__).resolve().parents[1]
JST=timezone(timedelta(hours=9))
POLICY={'id':'micro-odds-cover-v1','interval_minutes':10,'max_age_minutes':20,
        'lookahead_minutes':180,'close_buffer_seconds':120,
        'odds_haircut':'0.80','minimum_return_ratio':'1.10',
        'original_method':'D_hybrid','automatic_promotion':False}
QUERY='?pageType=odds&kakeshikiType=3rentan'
RID=re.compile(r'\d{12}')

def now():return datetime.now(timezone.utc)
def stamp(s):
    t=datetime.fromisoformat(s)
    if t.utcoffset() is None:raise ValueError('timestamp_timezone')
    return t
def digest(x):return sha256(json.dumps(x,sort_keys=True,ensure_ascii=False,allow_nan=False).encode()).hexdigest()
def read(p):return json.loads(p.read_text())
def write(p,x,immutable=False):
    p.parent.mkdir(parents=True,exist_ok=True)
    data=json.dumps(x,ensure_ascii=False,sort_keys=True,allow_nan=False,separators=(',',':'))+'\n'
    if immutable:
        with p.open('x') as f:f.write(data)
    else:
        temp=p.with_suffix('.tmp');temp.write_text(data);temp.replace(p)

def validate_original(p):
    rid=p['race_id'];r=p['input'];players=r['entry']['players']
    if not RID.fullmatch(rid) or r['race_id']!=rid or r['date']!=rid[:8] or p.get('pre_race') is not True:raise ValueError('original_identity')
    roster={str(c):str(v['rider_id']) for c,v in players.items()}
    if len(roster) not in (7,9) or len(set(roster.values()))!=len(roster):raise ValueError('original_roster')
    if set(r['roster'])!=set(map(int,roster)):raise ValueError('original_roster')
    if not stamp(p['entry_observed_at'])<=stamp(p['generated_at'])<stamp(p['sales_close_at'])<stamp(p['start_at']):raise ValueError('original_time')
    expected=sha256(json.dumps({'race_id':rid,'roster':{c:v['rider_id'] for c,v in players.items()},'lines':r['lines'],
        'start':p['start_at'],'close':p['sales_close_at']},sort_keys=True).encode()).hexdigest()
    if expected!=p['identity_sha256']:raise ValueError('original_hash')
    return roster

def verified_names(p,feed,at):
    """Recover legacy mark-filled name cells through an ID-matched day card.

    The original immutable payload is never edited. This view is used only
    to validate the public odds table's car/name pairs.
    """
    day=stamp(p['start_at']).astimezone(JST).date().isoformat()
    if feed.get('date')!=day or not stamp(feed['generated_at'])<=at<stamp(p['sales_close_at']):raise ValueError('name_feed_time')
    matches=[r for r in feed.get('races',[]) if str(r.get('race_id'))==p['race_id']]
    if len(matches)!=1:raise ValueError('name_feed_race')
    raw=matches[0]
    if raw.get('venue')!=p['venue_name'] or raw.get('start_time')!=stamp(p['start_at']).astimezone(JST).strftime('%H:%M'):raise ValueError('name_feed_schedule')
    entries=raw.get('entries',[]);roster=validate_original(p)
    if len(entries)!=len(roster):raise ValueError('name_feed_roster')
    found={};names={}
    for r in entries:
        car=str(r.get('car_number',''));rid=str(r.get('rider_id',''))
        if car in found or roster.get(car)!=rid or not isinstance(r.get('rider_full_name'),str) or not name(r['rider_full_name']):raise ValueError('name_feed_roster')
        found[car]=rid;names[car]=r['rider_full_name']
    if found!=roster or len(set(map(name,names.values())))!=len(roster):raise ValueError('name_feed_roster')
    evidence={'source_url':'https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/'+day+'.json',
              'published_at':feed['generated_at'],'checked_at':at.isoformat(),'feed_sha256':digest(feed)}
    return {**p,'input':{**p['input'],'names':names},'_name_evidence':evidence}

def matrix(markup,p):
    content=one(r'id="JS_ODDSCONTENTS_3rentan"[^>]*>(.*?)<!-- 3連単 End -->',markup,'missing_trifecta_table')
    tables=re.findall(r'<table class="odds_table(?: [^"]+)?">(.*?)</table>',content,re.S)
    expected={int(c):name(v) for c,v in p['input']['names'].items()}
    if set(expected)!=set(p['input']['roster']) or len(set(expected.values()))!=len(expected):raise ValueError('ambiguous_names')
    odds={};firsts=set()
    for table in tables:
        first_text,rider=one(r'<th class="n[1-9]"[^>]*>\s*<span class="number">([1-9])</span>\s*<span class="name">(.*?)</span>',table,'first_header')
        first=int(first_text)
        if first in firsts or name(rider)!=expected.get(first):raise ValueError('first_roster')
        firsts.add(first)
        columns=[(int(c),name(n)) for c,n in re.findall(r'<td class="rider n([1-9])">(.*?)<br\b[^>]*>',table,re.S)]
        if len(columns)!=len(expected)-1 or dict(columns)!={c:n for c,n in expected.items() if c!=first}:raise ValueError('odds_roster')
        order=[c for c,_ in columns];thirds=set()
        for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>',table,re.S):
            cells=re.findall(r'<td\b[^>]*>(.*?)</td>',row,re.S)
            if not cells:continue
            heads=re.findall(r'<th class="n([1-9])">\s*[1-9]\s*</th>',row)
            if not heads:continue
            if len(heads)!=2 or heads[0]!=heads[1]:raise ValueError('third_header')
            third=int(heads[0])
            if third not in order or third in thirds or len(cells)!=len(order):raise ValueError('matrix_shape')
            thirds.add(third)
            for second,cell in zip(order,cells):
                value=clean(cell)
                if second==third:
                    if value:raise ValueError('nonempty_diagonal')
                    continue
                if not re.fullmatch(r'\d[\d,]*(?:\.\d+)?',value):raise ValueError('unavailable_odds')
                v=float(value.replace(',',''));key=f'{first}-{second}-{third}'
                if not 1<=v<=1e8 or key in odds:raise ValueError('invalid_odds')
                odds[key]=v
        if thirds!=set(order):raise ValueError('missing_third')
    keys={'-'.join(map(str,t)) for t in permutations(sorted(expected),3)}
    if firsts!=set(expected) or set(odds)!=keys:raise ValueError('incomplete_market')
    # Independent explicit combinations disambiguate second-column/third-row.
    checks=re.findall(r'<span class="num">\s*([1-9]-[1-9]-[1-9])\s*</span>\s*<span class="odds">\s*([\d,]+(?:\.\d+)?)\s*</span>',content)
    if not checks:raise ValueError('missing_explicit_combinations')
    if any(k not in odds or Decimal(str(odds[k]))!=Decimal(v.replace(',','')) for k,v in checks):raise ValueError('matrix_order_disagrees')
    return odds

def parse(markup,url,p,captured):
    roster=validate_original(p)
    if not url.endswith(QUERY) or key_for(url.removesuffix(QUERY)+'?pageType=showResult')!=p['race_id']:raise ValueError('source_race')
    start=stamp(p['start_at']).astimezone(JST)
    title=clean(one(r'<title>(.*?)</title>',markup,'missing_title'))
    if not title.startswith(p['venue_name']+'競輪 ') or start.strftime('%Y年%m月%d日') not in title or not re.search(r'(?<!\d)'+str(p['race_no'])+r'R(?!\w)',title):raise ValueError('source_title')
    st,cl=one(r'<dt class="start">\s*発走予定\s*</dt>\s*<dd>(\d{2}:\d{2})</dd>\s*<dt class="bet">\s*投票締切\s*</dt>\s*<dd>(\d{2}:\d{2})</dd>',markup,'missing_schedule')
    if st!=start.strftime('%H:%M'):raise ValueError('source_start')
    provider_close=stamp(start.date().isoformat()+'T'+cl+':00+09:00')
    close=min(provider_close,stamp(p['sales_close_at']))
    status=one(r'id="JS_ODDSSTATUS_3rentan"[^>]*>(.*?)</div>',markup,'missing_publication')
    updated=one(r'<p class="time">\s*(\d{4}/\d{2}/\d{2} \d{2}:\d{2})現在\s*</p>',status,'missing_publication')
    published=datetime.strptime(updated,'%Y/%m/%d %H:%M').replace(tzinfo=JST)
    if not published<=captured<close<start or captured-published>timedelta(minutes=POLICY['max_age_minutes']):raise ValueError('stale_or_closed')
    if re.search(r'class="icon_confirmed"',markup):raise ValueError('final_odds')
    full_from=start.replace(hour=8 if 'icon_status morning' in markup else 9,minute=0 if 'icon_status morning' in markup else 30,second=0,microsecond=0)
    odds=matrix(markup,p)
    return {'schema':'tk-mrt-trifecta-quote/v1','race_id':p['race_id'],'market':'trifecta','state':'live','provider':'Kdreams',
        'identity_sha256':p['identity_sha256'],'roster':roster,'source_roster_check':'car_number_and_name',
        'source_names':{c:name(n) for c,n in p['input']['names'].items()},
        'source_url':url,'page_sha256':sha256(markup.encode()).hexdigest(),'published_at':published.isoformat(),
        'captured_at':captured.isoformat(),'sales_close_at':close.isoformat(),'provider_sales_close_at':provider_close.isoformat(),
        'pool':'all' if published>=full_from else 'provider','odds':odds,
        'name_evidence':p.get('_name_evidence',{'source':'original_pre_close_snapshot'})}

def quote_ready(q,s,at):
    if q.get('schema')!='tk-mrt-trifecta-quote/v1' or q.get('state')!='live' or q.get('market')!='trifecta' or q.get('pool')!='all':raise ValueError('quote_not_live_full_pool')
    if q['race_id']!=s['race_id'] or q['identity_sha256']!=s['identity_sha256'] or q['roster']!=s['roster']:raise ValueError('micro_identity_changed')
    if not s.get('frozen') or not s.get('pre_race'):raise ValueError('micro_not_frozen')
    times=[stamp(s['original_generated_at']),stamp(s['generated_at']),stamp(q['captured_at']),at]
    if times!=sorted(times) or not stamp(q['published_at'])<=times[2]:raise ValueError('quote_chronology')
    if at-min(stamp(q['published_at']),times[2])>timedelta(minutes=POLICY['max_age_minutes']):raise ValueError('quote_stale')
    if not at<min(stamp(q['sales_close_at']),stamp(s['sales_close_at']))-timedelta(seconds=POLICY['close_buffer_seconds']):raise ValueError('sales_close_near')
    expected={'-'.join(map(str,t)) for t in permutations(sorted(map(int,s['roster'])),3)}
    if set(q['odds'])!=expected or any(type(v) not in (float,int) or not 1<=v<=1e8 for v in q['odds'].values()):raise ValueError('incomplete_market')

def plan(q,s,at):
    quote_ready(q,s,at)
    original=s['methods']['D_hybrid']
    if sum(t['yen'] for t in original)!=10000 or len({tuple(t['cars']) for t in original})!=len(original):raise ValueError('micro_budget')
    if any(type(t['yen']) is not int or t['yen']<100 or t['yen']%100 for t in original):raise ValueError('micro_units')
    rows=[]
    for i,t in enumerate(original):
        key='-'.join(map(str,t['cars']));odds=Decimal(str(q['odds'][key]));cash=int(odds*t['yen'])
        rows.append({'cars':t['cars'],'yen':t['yen'],'odds':float(odds),'quoted_return_yen':cash,
                     'protected_return_yen':int(Decimal(cash)*Decimal(POLICY['odds_haircut'])),'original_rank':i})
    kept=rows[:];removed=[]
    while kept:
        stake=sum(t['yen'] for t in kept)
        target=int((Decimal(stake)*Decimal(POLICY['minimum_return_ratio'])).to_integral_value(rounding=ROUND_CEILING))
        worst=min(kept,key=lambda t:(t['protected_return_yen'],-t['original_rank']))
        if worst['protected_return_yen']>=target:break
        kept.remove(worst);removed.append(worst)
    stake=sum(t['yen'] for t in kept)
    return {'schema':'tk-mrt-odds-plan/v1','race_id':s['race_id'],'identity_sha256':s['identity_sha256'],
        'micro_protocol_id':s['protocol_id'],'micro_generated_at':s['generated_at'],'policy':POLICY,
        'quote_sha256':digest(q),'generated_at':at.isoformat(),'sales_close_at':q['sales_close_at'],
        'status':'ready' if kept else 'skip','tickets':kept,'removed':removed,'original_stake_yen':10000,
        'stake_yen':stake,'minimum_protected_return_yen':min((t['protected_return_yen'] for t in kept),default=None),
        'safety':{'paper_only':True,'automatic_promotion':False,'expected_value_estimated':False},
        'meaning':'At captured odds, after a 20% haircut, each retained hit returns at least 110% of this plan stake. This is not a final-odds guarantee or a calibrated EV policy.'}

def active_originals(root,at):
    day=at.astimezone(JST).date().isoformat();folder=root/'data/mrt'/day
    index=folder/'index.json'
    if not index.exists():return []
    candidates=[]
    for entry in read(index).get('races',[]):
        rid=entry.get('race_id','');file=entry.get('file','')
        if not RID.fullmatch(rid) or not rid.startswith(day.replace('-','')) or not file.startswith(rid+'-') or Path(file).name!=file or entry.get('status')!='ready':continue
        p=read(folder/file);validate_original(p)
        if p['identity_sha256']!=entry.get('identity_sha256') or p['race_id']!=rid:raise ValueError('current_index_identity')
        delta=stamp(p['sales_close_at'])-at
        if timedelta(seconds=POLICY['close_buffer_seconds'])<delta<=timedelta(minutes=POLICY['lookahead_minutes']):candidates.append(p)
    return sorted(candidates,key=lambda p:(p['sales_close_at'],p['race_id']))

class Fetcher:
    def __init__(self):self.last=0
    def get(self,url):
        sleep(max(0,1-(monotonic()-self.last)));self.last=monotonic()
        try:return read_page(url)
        except HTTPError as e:
            if e.code in (401,403,429):raise PermissionError('source_access_blocked_'+str(e.code)) from e
            raise

def run(root=ROOT,clock=now,get=None,discover=None,max_races=40,budget_seconds=240,name_feed=None):
    root=Path(root);started=clock();day=started.astimezone(JST).date().isoformat();dest=root/'data/mrt_odds'
    counts=Counter();errors=[];links=None;feed=None;fetcher=Fetcher();getter=get or fetcher.get
    # Discovery reuses the existing reviewed Kdreams date-to-race mapping.
    def default_discovery():
        from two_t import kdreams_results as k
        original=k.read_page
        try:k.read_page=getter;return links_for(day)
        finally:k.read_page=original
    stop=None;monotone=monotonic()
    try:
        for p in active_originals(root,started):
            rid=p['race_id'];latest=dest/'latest'/(rid+'.json');current=clock()
            if counts['requested']>=max_races or monotonic()-monotone>budget_seconds:counts['bounded_remaining']+=1;break
            if current>=stamp(p['sales_close_at'])-timedelta(seconds=POLICY['close_buffer_seconds']):counts['closed']+=1;continue
            if latest.exists():
                prior=read(latest)
                if prior.get('identity_sha256')==p['identity_sha256'] and current-stamp(prior['quote']['captured_at'])<timedelta(minutes=POLICY['interval_minutes']):counts['recently_captured']+=1;continue
            try:
                names=p['input'].get('names',{})
                if set(names)!=set(p['input']['entry']['players']) or len(set(map(name,names.values())))!=len(names):
                    if feed is None:
                        feed=(name_feed or (lambda:json.loads(getter('https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/'+day+'.json'))))()
                    p=verified_names(p,feed,clock())
                if links is None:links=(discover or default_discovery)()
                source=links.get(rid)
                if not source:raise ValueError('source_link_missing')
                url=source.removesuffix('?pageType=showResult')+QUERY
                if key_for(source)!=rid:raise ValueError('source_link_identity')
                counts['requested']+=1;markup=getter(url);q=parse(markup,url,p,clock())
                token=stamp(q['captured_at']).strftime('%H%M%S%f')+'-'+digest(q)[:12]
                path=dest/'snapshots'/day/rid/(token+'.json');write(path,q,True)
                decision=None;reason=None;micro_file=root/'data/mrt_research/micro_forward/snapshots'/(rid+'.json')
                if micro_file.exists():
                    try:decision=plan(q,read(micro_file),clock())
                    except (ValueError,KeyError,TypeError) as e:reason=str(e)
                else:reason='micro_not_yet_frozen'
                item={'schema':'tk-mrt-odds-latest/v1','race_id':rid,'identity_sha256':p['identity_sha256'],
                    'quote_path':str(path.relative_to(root)),'quote':q,'plan':decision,'unavailable_reason':reason}
                if decision:write(dest/'plans'/day/rid/(token+'.json'),decision,True);counts['plans_saved']+=1
                write(latest,item);counts['quotes_saved']+=1
            except PermissionError as e:stop=str(e);break
            except (OSError,ValueError,KeyError,TypeError) as e:
                counts['failed']+=1
                if len(errors)<40:errors.append({'race_id':rid,'reason':str(e)[:240]})
    except PermissionError as e:stop=str(e)
    except (OSError,ValueError,KeyError,TypeError) as e:stop=str(e)
    status={'schema':'tk-mrt-odds-status/v1','checked_at':clock().isoformat(),'date':day,'policy':POLICY,
        'state':'source_access_blocked' if stop and 'source_access_blocked' in stop else 'error' if stop else 'partial' if errors else 'ok',
        'counts':dict(counts),'errors':errors,'stop_reason':stop}
    write(dest/'status.json',status);return status

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=ROOT)
    args=parser.parse_args();status=run(args.root);print(json.dumps(status,ensure_ascii=False))
    if status['state'] in ('source_access_blocked','error'):raise SystemExit(1)

if __name__=='__main__':main()
