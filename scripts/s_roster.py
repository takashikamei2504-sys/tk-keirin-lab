"""Complete current S-class membership from KEIRIN.JP's public search.
The search form's observed GET fields are used; membership never depends on entries.
"""
import concurrent.futures,datetime as dt,hashlib,json,math,re,unicodedata,urllib.parse
from pathlib import Path
from collect_recent import ORIGIN,ROOT,UTC,stamp,key,plain
SCHEMA='tk-keirin-s-roster/v1'
PARAMS={'kyuhanCD':'11,12,13,15','seibetuCD':'1','stgt':'1'}
def search_url(page=1):return ORIGIN+'/sp/racersearchresult?'+urllib.parse.urlencode({**PARAMS,'dppg':str(page)})
def parse_search(source,page):
 total=re.search(r'<span\b[^>]*id=[\"\']UNQ_orlabel_2[\"\'][^>]*>(\d+)</span>\s*件見つかりました',source)
 shown=re.search(r'<input\b(?=[^>]*name=[\"\']dppg[\"\'])(?=[^>]*value=[\"\'](\d+)[\"\'])[^>]*>',source)
 if not total or not shown or int(shown.group(1))!=page:raise ValueError('search page number or total missing')
 for name,value in PARAMS.items():
  echo=re.search(r'<input\b(?=[^>]*name=[\"\']'+re.escape(name)+r'[\"\'])(?=[^>]*value=[\"\']([^\"\']*)[\"\'])[^>]*>',source)
  if not echo or echo.group(1)!=value:raise ValueError('S-only active search filters not preserved')
 total=int(total.group(1))
 if not 1<=total<=2000:raise ValueError('implausible roster total')
 fields={}
 for row,field,value in re.findall(r'<span\b[^>]*id=[\"\'][^\"\']*:(\d+):UNQ_orlabel_(8|9|10|12|13|16)[\"\'][^>]*>(.*?)</span>',source,re.S|re.I):fields.setdefault(int(row),{})[field]=plain(value)
 riders=[]
 for row,v in sorted(fields.items()):
  if not all(k in v for k in ('8','9','10')):raise ValueError('roster row missing identity/class')
  grade=unicodedata.normalize('NFKC',v['10'])
  grades={'S級S班':'SS','S級1班':'S1','S級2班':'S2','S級3班':'S3'}
  if grade not in grades or not re.fullmatch(r'\d{6}',v['9']):raise ValueError('unexpected class or ID in S-only search')
  if not key(v['8']):raise ValueError('empty rider name')
  riders.append({'rider_id':v['9'],'name':key(v['8']),'class_rank':grades[grade],'prefecture':v.get('12',''),'style':v.get('16','')})
 expected=min(10,max(0,total-(page-1)*10))
 if len(riders)!=expected:raise ValueError('roster page incomplete')
 return total,riders

def validate_membership(riders,total):
 if len(riders)!=total or len({r['rider_id'] for r in riders})!=total:raise ValueError('roster total or unique ID count mismatch')
 if any(r['class_rank'] not in ('SS','S1','S2','S3') for r in riders):raise ValueError('non-S rider in membership')
 return riders

def refresh(fetcher,force=False):
 path=ROOT/'data/s_riders.json';now=dt.datetime.now(UTC)
 old=json.loads(path.read_text()) if path.exists() else None
 if old and old.get('complete') and not force and (now-stamp(old['generated_at'])).total_seconds()<24*3600:return old
 try:
  total,first=parse_search(fetcher.get(search_url()),1);pages=math.ceil(total/10);riders=list(first)
  def load(page):
   count,rows=parse_search(fetcher.get(search_url(page)),page)
   if count!=total:raise ValueError('membership changed during pagination')
   return page,rows
  with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
   pending=[pool.submit(load,page) for page in range(2,pages+1)]
   for future in concurrent.futures.as_completed(pending):
    page,rows=future.result();riders.extend(rows)
    if page%10==0:print(json.dumps({'s_roster_page':page,'pages':pages,'observed':len(riders)}),flush=True)
  validate_membership(riders,total);riders.sort(key=lambda r:r['rider_id'])
  # A stable complete denominator is required before replacing the cached manifest.
  counts={g:sum(r['class_rank']==g for r in riders) for g in ('SS','S1','S2','S3')}
  result={'schema':SCHEMA,'generated_at':now.isoformat(),'complete':True,'total':total,'class_counts':counts,'source_url':search_url(),'source_pages':pages,
   'selection':'現役・男子・S級（S班/1班/2班/3班）。出場予定による条件なし。','roster_hash':hashlib.sha256(json.dumps(riders,ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:24], 'riders':riders,'refresh_error':None}
  path.parent.mkdir(exist_ok=True);tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n');tmp.replace(path)
  print(json.dumps({'s_roster_complete':True,'total':total,'class_counts':counts}),flush=True);return result
 except Exception as exc:
  if old and old.get('complete'):
   validate_membership(old['riders'],old['total']);return {**old,'refresh_error':str(exc)[:200],'refresh_attempt_at':now.isoformat()}
  raise

def coverage(manifest,snapshots,now=None):
 now=now or dt.datetime.now(UTC);members=manifest['riders'];latest={}
 for s in snapshots:
  rid=s['rider_id']
  if rid not in latest or stamp(s['collected_at'])>stamp(latest[rid]['collected_at']):latest[rid]=s
 rows=[]
 for r in members:
  s=latest.get(r['rider_id']);verified=bool(s and s.get('verified_identity') and key(s['name'])==key(r['name']) and stamp(s['source_updated_at'])<=stamp(s['collected_at'])<=now)
  fresh=bool(verified and (now-stamp(s.get('last_checked_at',s['collected_at']))).total_seconds()<=24*3600 and (now-stamp(s['source_updated_at'])).total_seconds()<=72*3600)
  rows.append({**r,'verified':verified,'fresh':fresh})
 return {'roster_complete':manifest['complete'],'roster_generated_at':manifest['generated_at'],'roster_refresh_error':manifest.get('refresh_error'),'total':len(rows),'covered':sum(r['verified'] for r in rows),'fresh':sum(r['fresh'] for r in rows),
  'by_class':{g:{'total':sum(r['class_rank']==g for r in rows),'covered':sum(r['class_rank']==g and r['verified'] for r in rows),'fresh':sum(r['class_rank']==g and r['fresh'] for r in rows)} for g in ('SS','S1','S2','S3')},
  'missing':[{'rider_id':r['rider_id'],'name':r['name'],'class_rank':r['class_rank']} for r in rows if not r['verified']]}
