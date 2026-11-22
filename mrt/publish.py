"""Publish all B-line options from a verified, pre-close entry snapshot.
No retrospective predictions are written. Existing prediction snapshots are immutable.
Current entries are rechecked every run; lineup/schedule/roster changes invalidate old options.
"""
import argparse,datetime as dt,hashlib,json,pathlib,re,sys,time
import httpx,joblib
from .entry import serving_card
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'mrt/engine'))
import mrt_manual_B_tool as tool
JST=dt.timezone(dt.timedelta(hours=9))
MODEL=ROOT/'mrt/models/v3.joblib'
ENGINE_FILES=['mrt_logic_engine.py','mrt_logic_v2.py','mrt_logic_v3.py']
ENGINE_HASH=hashlib.sha256(b''.join((ROOT/'mrt/engine'/p).read_bytes() for p in ENGINE_FILES)).hexdigest()
def now():return dt.datetime.now(dt.timezone.utc)
def dump(path,value):
 path.parent.mkdir(parents=True,exist_ok=True);temp=path.with_suffix('.tmp');temp.write_text(json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':')));temp.replace(path)
def identity(r,meta):
 return hashlib.sha256(json.dumps({'race_id':r['race_id'],'roster':{c:p['rider_id'] for c,p in r['entry']['players'].items()},'lines':r['lines'],'start':meta['start_at'],'close':meta['sales_close_at']},sort_keys=True).encode()).hexdigest()
def freeze(r,meta,model,observed_at):
 cutoff=dt.datetime.fromisoformat(meta['sales_close_at'])
 if observed_at>=cutoff:raise ValueError('Sales already closed; no retrospective freeze')
 if r['date']<=model['history_through']:raise ValueError('Input overlaps training history')
 result=tool.options(model,r,budget=10000)
 completed=now()
 if completed>=cutoff:raise ValueError('Calculation finished after sales close')
 result.update(meta,input=r,generated_at=completed.isoformat(),entry_observed_at=observed_at.isoformat(),identity_sha256=identity(r,meta),model_id='MRT_V3_7126',model_sha256=hashlib.sha256(MODEL.read_bytes()).hexdigest(),engine_sha256=ENGINE_HASH,history_through=model['history_through'],pre_race=True)
 return result
class Fetcher:
 def __init__(self):self.client=httpx.Client(timeout=25,follow_redirects=True,headers={'User-Agent':'TK-KEIRIN-LAB/1.0 (public entry research)'});self.last=0
 def get(self,url):
  time.sleep(max(0,1.-(time.monotonic()-self.last)));self.last=time.monotonic()
  r=self.client.get(url)
  if r.status_code in (401,403,429):raise PermissionError('Acquisition paused: HTTP '+str(r.status_code))
  r.raise_for_status();r.encoding='utf-8';return r.text

def run(date,root=None):
 root=pathlib.Path(root or ROOT/'data/mrt');folder=root/date;folder.mkdir(parents=True,exist_ok=True);manifest_path=folder/'index.json'
 manifest={'schema':'tk-mrt-day/v1','date':date,'checked_at':now().isoformat(),'races':[],'errors':[]}
 model=joblib.load(MODEL);fetch=Fetcher();last=manifest_path.exists() and json.loads(manifest_path.read_text()) or {};old={r['race_id']:r for r in last.get('races',[])}
 try:
  url='https://keirin.netkeiba.com/race/api_race_list.html?pid=api_race_list&input=UTF-8&output=html&kaisai_date='+date.replace('-','')+'&jyocd=&link_mode='
  html=fetch.get(url)
  codes=sorted(set(re.findall(r'btn_jyoname_(\d{2})',html)))
  all_html=[html]+[fetch.get(url.replace('&jyocd=','&jyocd='+code)) for code in codes]
  ids=sorted(set(re.findall(r'race_id=('+date.replace('-','')+r'\d{4})',''.join(all_html))))
  if not ids:raise ValueError('No publicly listed race links')
  for rid in ids:
   try:
    r,meta=serving_card(fetch.get('https://keirin.netkeiba.com/race/entry/?race_id='+rid),rid);observed=now();fp=identity(r,meta);row={'race_id':rid,**meta,'identity_sha256':fp,'checked_at':observed.isoformat()}
    prior=old.get(rid,{});cutoff=dt.datetime.fromisoformat(meta['sales_close_at'])
    # Reuse only an identical, fully computed pre-race snapshot with matching engine.
    file=prior.get('file');previous_path=folder/pathlib.Path(file).name if file else None
    if file and previous_path.is_file() and prior.get('identity_sha256')==fp:
     saved=json.loads(previous_path.read_text())
     if saved.get('engine_sha256')==ENGINE_HASH and saved.get('pre_race') is True and 'input' in saved:row.update(file=file,status='ready' if observed<cutoff else 'closed')
    if not row.get('file') and observed<cutoff:
     payload=freeze(r,meta,model,observed);name=rid+'-'+hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()[:16]+'.json'
     dump(folder/name,payload);row.update(file=name,status='ready')
    elif not row.get('file'):row['status']='closed_without_prediction'
    manifest['races'].append(row);print(rid,row['status'],flush=True)
   except PermissionError:raise
   except Exception as e:
    manifest['errors'].append({'race_id':rid,'reason':str(e)});manifest['races'].append({'race_id':rid,'status':'unavailable','reason':str(e),'checked_at':now().isoformat()});print(rid,str(e),flush=True)
 except Exception as e:
  manifest['errors'].append({'scope':'collection','reason':str(e)})
 manifest['checked_at']=now().isoformat();dump(manifest_path,manifest)
 # Latest points at the requested day; unavailable days are never replaced with an old day.
 dump(root/'latest.json',{'date':date,'checked_at':manifest['checked_at'],'path':date+'/index.json'})
 return manifest
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--date',default=now().astimezone(JST).date().isoformat());a=p.parse_args();dt.date.fromisoformat(a.date);run(a.date)
