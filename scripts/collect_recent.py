#!/usr/bin/env python3
"""Collect public KEIRIN.JP recent form for today's/tomorrow's entrants.
No paid service, login, browser or predictions. Snapshots preserve acquisition time.
"""
import argparse, concurrent.futures, datetime as dt, hashlib, html, json, re, threading, time, urllib.request, urllib.error, urllib.parse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
JST=dt.timezone(dt.timedelta(hours=9)); UTC=dt.timezone.utc
ORIGIN='https://www.keirin.jp'
AGENT='TKKeirinLab/1.4 (bounded public recent-form collection)'
FIELDS=['wins','seconds','thirds','unplaced','withdrawals','disqualifications','total','win_rate','top2_rate','top3_rate','h','b','score']
def key(s):return re.sub(r'[\s\u3000]','',str(s))
def plain(s):return re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]*>','',s))).strip()
def stamp(s):return dt.datetime.fromisoformat(s.replace('Z','+00:00'))
def robots_allowed(text,url):
 # RFC-style longest matching directive. urllib.robotparser's first-match rule
 # incorrectly rejects this site's Disallow:/ followed by Allow:/pc/racerprofile.
 groups=[];agents=[];rules=[]
 for line in text.splitlines()+['User-agent: __end__']:
  line=line.split('#',1)[0].strip()
  if ':' not in line:continue
  k,v=line.split(':',1);k=k.strip().lower();v=v.strip()
  if k=='user-agent':
   if rules:groups.append((agents,rules));agents=[];rules=[]
   agents.append(v.lower())
  elif k in ('allow','disallow') and agents and v:rules.append((k,v))
 matched=[(a,r) for a,r in groups if any(x=='*' or x in AGENT.lower() for x in a)]
 specific=[g for g in matched if any(a!='*' and a in AGENT.lower() for a in g[0])]
 path=urllib.parse.urlsplit(url).path;hits=[]
 for _,rs in specific or matched:
  for k,v in rs:
   pattern='^'+re.escape(v).replace(r'\*','.*').replace(r'\$','$')
   if re.search(pattern,path):hits.append((len(v.replace('*','').rstrip('$')),k=='allow'))
 return max(hits)[1] if hits else True

def parse_profile(source,rider_id,expected_name,collected_at):
 # Only the identity and recent section are parsed; career statistics are excluded.
 match=re.search(r'<td\b[^>]*id=[\"\']PlayerNo[\"\'][^>]*>\s*(\d+)\s*</td>',source,re.I)
 if not match or match.group(1).zfill(6)!=str(rider_id).zfill(6):raise ValueError('rider ID mismatch')
 row_start=source.rfind('<tr',0,match.start());row=source[row_start:match.end()]
 cells=re.findall(r'<td\b[^>]*>(.*?)</td>',row,re.S|re.I)
 if not cells or key(plain(cells[0]))!=key(expected_name):raise ValueError('rider name mismatch')
 marker=source.find('■直近4ヶ月成績')
 if marker<0:raise ValueError('recent four-month table missing')
 recent_start=source.rfind('近況成績',0,marker)
 update=re.findall(r'(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2})(?:&nbsp;|\s)*更新',source[recent_start:marker])
 if not update:raise ValueError('source update time missing')
 updated=dt.datetime.strptime(update[-1],'%Y/%m/%d %H:%M').replace(tzinfo=JST)
 if updated>collected_at:raise ValueError('source updated in future')
 table=re.search(r'<table\b[^>]*>(.*?)</table>',source[marker:],re.S|re.I)
 if not table:raise ValueError('statistics table missing')
 rows=re.findall(r'<tr\b[^>]*>(.*?)</tr>',table.group(1),re.S|re.I)
 if len(rows)!=2:raise ValueError('unexpected statistics layout')
 labels=[key(plain(v)) for v in re.findall(r'<td\b[^>]*>(.*?)</td>',rows[0],re.S|re.I)]
 expected=['1着','2着','3着','着外','棄権','失格','総出走回数','勝率','2連対率','3連対率','ホーム回数','バック回数','競走得点']
 if labels!=expected:raise ValueError('statistics headers changed')
 raw=[plain(v) for v in re.findall(r'<td\b[^>]*>(.*?)</td>',rows[1],re.S|re.I)]
 if len(raw)!=len(FIELDS):raise ValueError('statistics columns missing')
 stats={}
 for field,value in zip(FIELDS,raw):
  m=re.fullmatch(r'(\d+(?:\.\d+)?)(回|%)?',value)
  if not m:raise ValueError('missing numeric value: '+field)
  stats[field]=float(m.group(1)) if field in ('win_rate','top2_rate','top3_rate','score') else int(m.group(1))
 if stats['total']<stats['wins']+stats['seconds']+stats['thirds']:raise ValueError('invalid finish counts')
 if not 0<=stats['win_rate']<=stats['top2_rate']<=stats['top3_rate']<=100:raise ValueError('invalid finish rates')
 for count,rate in [(stats['wins'],stats['win_rate']),(stats['wins']+stats['seconds'],stats['top2_rate']),(stats['wins']+stats['seconds']+stats['thirds'],stats['top3_rate'])]:
  if stats['total'] and abs(count/stats['total']*100-rate)>.21:raise ValueError('counts and percentages disagree')
 meetings=[]
 end=source.find('■出場予定',marker)
 section=source[marker:end if end>=0 else len(source)]
 for block in re.findall(r'<table\b[^>]*class=[\"\']seiseki_kobetsu[\"\'][^>]*>(.*?)</table>',section,re.S|re.I):
  md=re.search(r'>(\d{2}/\d{2})<',block)
  if not md:continue
  year=updated.year;date=dt.datetime.strptime(f'{year}/{md.group(1)}','%Y/%m/%d').date()
  if date>updated.date():date=date.replace(year=year-1)
  label=re.search(r'<a\b[^>]*>(.*?)</a>',block,re.S|re.I)
  finishes=[html.unescape(v) for v in re.findall(r'<p\b[^>]*title=[\"\']([^\"\']+)[\"\'][^>]*>',block,re.I)]
  # Withdrawal text may be plain text instead of an image title.
  if not finishes:
   text=plain(block)
   finishes=[x for x in ['負傷欠場','途中欠場','欠場'] if x in text][:1]
  meetings.append({'date':date.isoformat(),'date_precision':'meeting_start','venue_grade':plain(label.group(1)) if label else '', 'finishes':finishes})
 record={'rider_id':str(rider_id).zfill(6),'name':key(expected_name),'period':'直近4ヶ月','stats':stats,'recent_meetings':meetings[:20],
  'source_url':ORIGIN+'/pc/racerprofile?snum='+str(rider_id).zfill(6),'source_updated_at':updated.isoformat(),'collected_at':collected_at.isoformat(),'verified_identity':True}
 record['id']=hashlib.sha256((record['rider_id']+'|'+record['source_updated_at']+'|'+json.dumps(stats,sort_keys=True)+'|'+json.dumps(meetings,ensure_ascii=False)).encode()).hexdigest()[:24]
 return record

class Fetcher:
 def __init__(self,delay=1.05):self.lock=threading.Lock();self.next_start=0.;self.delay=delay
 def raw(self,url):
  req=urllib.request.Request(url,headers={'User-Agent':AGENT})
  with urllib.request.urlopen(req,timeout=12) as res:
   if urllib.parse.urlparse(res.url).hostname!=urllib.parse.urlparse(url).hostname:raise ValueError('cross-host redirect')
   body=res.read(2_000_001)
   if len(body)>2_000_000:raise ValueError('response too large')
   return body.decode(res.headers.get_content_charset() or 'utf-8',errors='replace')
 def initialize(self):
  self.robots=self.raw(ORIGIN+'/robots.txt')
  if '<html' in self.robots.lower():raise ValueError('robots response invalid')
  if not robots_allowed(self.robots,ORIGIN+'/pc/racerprofile?snum=015035'):raise ValueError('robots disallows profile collection')
 def profile(self,rider):
  url=ORIGIN+'/pc/racerprofile?snum='+rider['rider_id']
  if not robots_allowed(self.robots,url):raise ValueError('robots disallows URL')
  with self.lock:
   wait=max(0,self.next_start-time.monotonic());self.next_start=max(self.next_start,time.monotonic())+self.delay
  if wait:time.sleep(wait)
  body=self.raw(url)
  return parse_profile(body,rider['rider_id'],rider['name'],dt.datetime.now(UTC))

def load_roster(now,venue=None,race_number=None):
 riders={};errors=[];dates=[]
 for offset in (0,1):
  day=(now.astimezone(JST)+dt.timedelta(days=offset)).date().isoformat()
  try:
   req=urllib.request.Request('https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/'+day+'.json',headers={'User-Agent':AGENT})
   with urllib.request.urlopen(req,timeout=12) as res:payload=json.load(res)
   if payload.get('date')!=day:raise ValueError('roster date mismatch')
   dates.append(day)
   for race in payload.get('races',[]):
    if race.get('is_girls') or len(race.get('entries',[])) not in (7,9) or (venue and race.get('venue')!=venue) or (race_number and int(race.get('race_number',0))!=race_number):continue
    for e in race['entries']:
     rid=str(e.get('rider_id','')).zfill(6);name=key(e.get('rider_full_name',''))
     if not re.fullmatch(r'\d{6}',rid) or not name:continue
     item={'rider_id':rid,'name':name,'date':day,'start':race.get('start_time','23:59'),'race_no':int(race.get('race_number',0)),'venue':race.get('venue','')}
     if rid in riders and riders[rid]['name']!=name:raise ValueError('conflicting roster identity')
     riders.setdefault(rid,item)
  except urllib.error.HTTPError as exc:
   errors.append({'stage':'roster','date':day,'error':'HTTP '+str(exc.code)})
  except Exception as exc:errors.append({'stage':'roster','date':day,'error':str(exc)[:160]})
 return list(riders.values()),dates,errors

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--max-riders',type=int,default=650);ap.add_argument('--venue');ap.add_argument('--race-number',type=int);ap.add_argument('--workers',type=int,default=3);ap.add_argument('--budget-seconds',type=int,default=1080);args=ap.parse_args()
 start=time.monotonic();now=dt.datetime.now(UTC);path=ROOT/'data/recent_form.json';old=json.loads(path.read_text()) if path.exists() else {};snapshots=old.get('snapshots',[])
 # Retain old snapshots, so a later collection cannot silently overwrite a pre-race observation.
 snapshots=[s for s in snapshots if (now-stamp(s['collected_at'])).days<=45]
 roster,dates,errors=load_roster(now,args.venue,args.race_number);known={}
 for s in snapshots:
  rid=s['rider_id']
  if rid not in known or stamp(s['collected_at'])>stamp(known[rid]['collected_at']):known[rid]=s
 targets=[r for r in roster if r['rider_id'] not in known or (now-stamp(known[r['rider_id']].get('last_checked_at',known[r['rider_id']]['collected_at']))).total_seconds()>8*3600]
 targets.sort(key=lambda r:(r['rider_id'] in known,r['date'],r['start'],r['race_no'],r['rider_id']))
 targets=targets[:max(1,min(args.max_riders,1000))];f=Fetcher();attempted=0;success=0
 try:
  f.initialize()
  with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(args.workers,3))) as pool:
   # Small batches stop cleanly at the request/time budget and are globally spaced.
   for offset in range(0,len(targets),3):
    if time.monotonic()-start>args.budget_seconds:break
    batch=targets[offset:offset+3];pending={pool.submit(f.profile,r):r for r in batch}
    for future in concurrent.futures.as_completed(pending):
     rider=pending[future];attempted+=1
     try:
      record=future.result();existing=next((s for s in snapshots if s['id']==record['id']),None)
      if existing is None:snapshots.append(record)
      else:existing['last_checked_at']=record['collected_at']
      success+=1
     except Exception as exc:errors.append({'rider_id':rider['rider_id'],'name':rider['name'],'error':str(exc)[:180]})
    print(json.dumps({'attempted':attempted,'success':success,'remaining':len(targets)-attempted}),flush=True)
 except Exception as exc:errors.append({'stage':'collector','error':str(exc)[:180]})
 covered={s['rider_id'] for s in snapshots};missing=[r['rider_id'] for r in roster if r['rider_id'] not in covered]
 out={'schema':'tk-keirin-recent-form/v1','generated_at':dt.datetime.now(UTC).isoformat(),'roster_dates':dates,'snapshots':snapshots,'status':{'roster':len(roster),'covered':sum(r['rider_id'] in covered for r in roster),'attempted':attempted,'succeeded':success,'missing_rider_ids':missing,'errors':errors[-100:]},'notice':'KEIRIN.JPの直近4ヶ月集計と最近20開催。開催日は初日。S回数は取得対象外。発走前取得のスナップショットのみ予想へ反映。'}
 path.parent.mkdir(exist_ok=True);tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n');tmp.replace(path)
 print(json.dumps(out['status'],ensure_ascii=False),flush=True)
 if not snapshots:raise SystemExit('No recent-form snapshots collected')
if __name__=='__main__':main()
