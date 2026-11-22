"""Collect new publicly opened Mr.T labels after the entire Japanese race day ends.
This module never changes serving weights or writes live-model prediction history.
"""
import argparse,datetime as dt,hashlib,json,pathlib,re,sys,time
import httpx
from .teacher_parse import BASE,NotPublic,plain,measured_result,reference
ROOT=pathlib.Path(__file__).resolve().parents[1]
DEFAULT_ROOT=ROOT/'data/mrt_teacher'
START=dt.date(2026,11,22)
JST=dt.timezone(dt.timedelta(hours=9))
def now():return dt.datetime.now(dt.timezone.utc)
def write(path,data):
 path.parent.mkdir(parents=True,exist_ok=True);temp=path.with_suffix('.tmp');temp.write_text(json.dumps(data,ensure_ascii=False,allow_nan=False,separators=(',',':')));temp.replace(path)
def read(path,default):return json.loads(path.read_text()) if path.exists() else default
class Pause(RuntimeError):pass
class Fetcher:
 def __init__(self,max_requests=480,max_seconds=780):self.client=httpx.Client(timeout=25,follow_redirects=False,headers={'User-Agent':'TK-KEIRIN-LAB/1.0 (public MrT reference research)','Referer':BASE+'/yoso/profile/?id=634'});self.last=0.;self.started=time.monotonic();self.count=0;self.max_requests=max_requests;self.max_seconds=max_seconds
 def request(self,url,data=None):
  if self.count>=self.max_requests or time.monotonic()-self.started>=self.max_seconds:raise Pause('Request/time budget reached; resume next run')
  time.sleep(max(0,1-(time.monotonic()-self.last)));self.last=time.monotonic();self.count+=1
  r=self.client.post(url,data=data) if data is not None else self.client.get(url)
  if r.status_code in [401,403,429] or 300<=r.status_code<400:raise Pause('Access boundary: HTTP '+str(r.status_code))
  r.raise_for_status();r.encoding='utf-8';return r.text

def schedule_rows(html,date):
 compact=date.replace('-','');ids=set(re.findall(r'race_id=('+compact+r'\d{4})',html));rows={}
 for rid,body in re.findall(r'<a\b[^>]*href="[^\"]*/race/(?:entry|result)/\?race_id=('+compact+r'\d{4})[^\"]*"[^>]*>(.*?)</a>',html,re.S):
  m=re.search(r'発走\s*(\d{2}:\d{2})',plain(body))
  if m:rows[rid]={'race_id':rid,'start_at':date+'T'+m[1]+':00+09:00'}
 return ids,rows

def race_day(fetch,date):
 url=BASE+'/race/api_race_list.html?pid=api_race_list&input=UTF-8&output=html&kaisai_date='+date.replace('-','')+'&jyocd=&link_mode='
 first=fetch.request(url);codes=sorted(set(re.findall(r'btn_jyoname_(\d{2})',first)))
 if not codes:raise ValueError('Venue inventory unavailable; day end cannot be confirmed')
 parts=[first]+[fetch.request(url.replace('&jyocd=','&jyocd='+c)) for c in codes]
 ids=set();rows={}
 for html in parts:
  found,parsed=schedule_rows(html,date);ids.update(found)
  for rid,row in parsed.items():
   if rid in rows and rows[rid]!=row:raise ValueError('Conflicting scheduled start times')
   rows[rid]=row
 if not ids or ids!=set(rows) or set(rid[8:10] for rid in rows)!=set(codes):raise ValueError('Incomplete national race-day schedule')
 return [rows[rid] for rid in sorted(rows)]

def result(fetch,root,rid,refresh=False):
 path=root/'results'/(rid+'.json');prior=read(path,{})
 if prior.get('status') in ['final','cancelled'] and not refresh:return prior
 observed=now().isoformat();value=measured_result(fetch.request(BASE+'/race/result/?race_id='+rid),rid);value.update(first_observed_at=prior.get('first_observed_at',observed),checked_at=now().isoformat())
 if value['status'] in ['final','cancelled']:
  if prior.get('source_sha256') and prior['source_sha256']!=value.get('source_sha256'):write(root/'result_versions'/(rid+'-'+prior['source_sha256']+'.json'),prior)
  write(path,value)
 return value

def end_gate(fetch,root,date,observed):
 rows=race_day(fetch,date);latest=max(dt.datetime.fromisoformat(r['start_at']) for r in rows)
 gate={'race_count':len(rows),'latest_start_at':latest.isoformat(),'checked_at':observed.isoformat(),'finished':False,'pending_race_ids':[]}
 if observed<latest+dt.timedelta(minutes=15):gate['reason']='waiting_for_last_race';return gate,{}
 values={}
 for row in rows:
  r=result(fetch,root,row['race_id']);values[row['race_id']]=r
  if r['status'] not in ['final','cancelled']:gate['pending_race_ids'].append(row['race_id'])
 gate['finished']=not gate['pending_race_ids'];gate['reason']='all_results_confirmed' if gate['finished'] else 'waiting_for_results';gate['checked_at']=now().isoformat();return gate,values

def listing(fetch,date):
 raw=fetch.request(BASE+'/yoso/api/api_get_goods_list_prof.html',{'input':'UTF-8','output':'json','show_id':'goods_list_main','kaisai_date':date.replace('-',''),'yosoka_id':634,'jyo':'all'})
 html=json.loads(raw)
 if not isinstance(html,str) or not re.search(r'goods_list|Yoso|予想|該当',html):raise ValueError('Unrecognized expert listing response')
 # The profile endpoint's response must remain scoped to expert 634.
 ids=set(re.findall(r'(?<![A-Za-z0-9])b\d+_\d+(?![A-Za-z0-9_])',html))
 if any(not re.fullmatch(r'b\d+_634',fid) for fid in ids):raise ValueError('Listing contains a different expert')
 return sorted(ids),{'source_url':BASE+'/yoso/profile/?id=634&kaisai_date='+date.replace('-',''),'response_sha256':hashlib.sha256(raw.encode()).hexdigest(),'checked_at':now().isoformat()}

def race_id(html,date):
 ids=set(re.findall(r'race_id=('+date.replace('-','')+r'\d{4})',html))
 if len(ids)!=1:raise ValueError('Forecast race is ambiguous')
 return next(iter(ids))

def attach_pre_race(record):
 date=dt.datetime.strptime(record['date'],'%Y%m%d').date().isoformat();folder=ROOT/'data/mrt'/date;matched=[]
 for path in folder.glob(record['race_id']+'-*.json'):
  p=read(path,{})
  if p.get('pre_race') is not True or p.get('input',{}).get('entry',{}).get('players') is None:continue
  ids={c:r['rider_id'] for c,r in p['input']['entry']['players'].items()}
  if ids==record['measured_result'].get('roster') and dt.datetime.fromisoformat(p['generated_at'])<dt.datetime.fromisoformat(p['sales_close_at']):matched.append((p['generated_at'],str(path.relative_to(ROOT))))
 record['pre_race_snapshot']=min(matched)[1] if matched else None
 record['pre_race_snapshot_status']='matched_rider_ids' if matched else 'unavailable_do_not_invent'

def collect_day(fetch,root,date):
 path=root/'days'/(date+'.json');prior=read(path,{});state={'schema':'tk-mrt-teacher-day/v1','date':date,'expert_id':634,'checked_at':now().isoformat(),'state':'checking','forecast_ids':prior.get('forecast_ids',[]),'paired':[],'pending':{},'errors':[]}
 try:
  gate,results=end_gate(fetch,root,date,now());state['day_end_gate']=gate
  if not gate['finished']:state['state']='waiting_day_end';return state
  ids,meta=listing(fetch,date);state['listing']=meta;state['forecast_ids']=sorted(set(ids)|set(prior.get('forecast_ids',[])))
  state['listed_count_current']=len(ids)
  for fid in state['forecast_ids']:
   target=root/'records'/(fid+'.json')
   if target.exists():
    stored=read(target,{})
    if stored.get('date')!=date.replace('-','') or stored.get('forecast_id')!=fid or stored.get('expert_id')!=634:raise ValueError('Stored forecast identity mismatch')
    state['paired'].append(fid);continue
   try:
    observed=now().isoformat();html=fetch.request(BASE+'/yoso/detail/?id='+fid);rid=race_id(html,date)
    if rid not in results:raise ValueError('Forecast race is outside the verified race day')
    measured=result(fetch,root,rid,refresh=True)
    record=reference(html,fid,date.replace('-',''),measured);attach_pre_race(record)
    record.update(first_observed_at=observed,collected_at=now().isoformat(),day_end_verified_at=gate['checked_at'],day_end_races=gate['race_count'])
    write(target,record);state['paired'].append(fid)
   except Pause:raise
   except NotPublic as e:state['pending'][fid]={'state':'waiting_publication','reason':str(e)}
   except Exception as e:state['pending'][fid]={'state':'needs_retry','reason':str(e)};state['errors'].append({'forecast_id':fid,'reason':str(e)})
  state['state']='no_public_forecasts_observed' if not state['forecast_ids'] else 'pending' if state['pending'] else 'up_to_date'
 except Pause as e:state['state']='paused';state['errors'].append({'reason':str(e)});raise
 except Exception as e:state['state']='error';state['errors'].append({'reason':str(e)})
 finally:state['checked_at']=now().isoformat();write(path,state)
 return state

def run(root=None,date=None,lookback=None,fetch=None):
 root=pathlib.Path(root or DEFAULT_ROOT);at=now().astimezone(JST);today=at.date();end=dt.date.fromisoformat(date) if date else max(START,today-dt.timedelta(days=1))
 if end<START or end>today:raise ValueError('Collection dates must be from 2026-11-22 through today (JST)')
 window=lookback if lookback is not None else 31 if at.day==1 else 7
 if not 1<=window<=31:raise ValueError('lookback must be 1..31')
 dates={end-dt.timedelta(days=i) for i in range(window) if end-dt.timedelta(days=i)>=START}
 # Known unfinished forecasts remain queued even after the ordinary retry window.
 for path in (root/'days').glob('*.json'):
  old=read(path,{})
  if old.get('pending') and START<=dt.date.fromisoformat(path.stem)<=end:dates.add(dt.date.fromisoformat(path.stem))
 fetch=fetch or Fetcher();states=[];paused=False
 for day in sorted(dates,reverse=True):
  try:states.append(collect_day(fetch,root,day.isoformat()))
  except Pause:paused=True;break
  print(day.isoformat(),states[-1]['state'],len(states[-1]['paired']),flush=True)
 status={'schema':'tk-mrt-teacher-status/v1','expert_id':634,'expert_name':'Mr.Tの競輪眼','start_date':START.isoformat(),'checked_at':now().isoformat(),'schedule_jst':['00:20','03:20','07:20'],'lookback_days':window,'paused':paused,'run_dates':[d.isoformat() for d in sorted(dates)],'days':[],'records':len(list((root/'records').glob('b*_634.json'))),'policy':'Post-race public teacher references only; never live inference input or automatic model adoption.'}
 for path in sorted((root/'days').glob('*.json'),reverse=True):
  d=read(path,{});status['days'].append({k:d.get(k) for k in ['date','state','checked_at','forecast_ids','paired','pending','errors','day_end_gate']})
 write(root/'status.json',status)
 return status
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--date');p.add_argument('--lookback',type=int);a=p.parse_args();s=run(date=a.date,lookback=a.lookback)
 if s['paused'] or any(d['state']=='error' or d['errors'] for d in s['days'] if d['date'] in s['run_dates']):sys.exit(1)
