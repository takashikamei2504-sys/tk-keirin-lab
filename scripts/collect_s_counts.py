#!/usr/bin/env python3
"""Collect measured pre-race S counts from public netkeirin entry tables.

Only fully matched seven/nine-rider tables are stored. Never substitute zeros.
"""
import argparse
import datetime as dt
import html
import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
JST=dt.timezone(dt.timedelta(hours=9))
UTC=dt.timezone.utc
SCHEMA='tk-keirin-s-counts/v1'
AGENT='TKKeirinLab/2.0 (public race entry stats; contact via project Github)'
HOST='keirin.netkeiba.com'

def norm(s):
 return re.sub(r'[\s\u3000]', '', unicodedata.normalize('NFKC',html.unescape(str(s or ''))))

def read_url(url,limit=2_000_000,timeout=12):
 host=urllib.parse.urlsplit(url).hostname
 if host not in (HOST,'raw.githubusercontent.com'):raise ValueError('unexpected fetch host')
 req=urllib.request.Request(url,headers={'User-Agent':AGENT,'Accept':'text/html,application/json'})
 with urllib.request.urlopen(req,timeout=timeout) as r:
  if urllib.parse.urlsplit(r.url).hostname!=host:raise ValueError('cross-host redirect')
  body=r.read(limit+1)
  if len(body)>limit:raise ValueError('response too large')
  return body.decode(r.headers.get_content_charset() or 'utf-8',errors='replace')

class Tables(HTMLParser):
 """Keep cell contents and attributes from nested HTML tables."""
 def __init__(self):
  super().__init__(convert_charrefs=True)
  self.stack=[];self.tables=[]
 def handle_starttag(self,tag,attrs):
  attr=dict(attrs)
  if tag=='table':
   table=[];self.stack.append({'table':table,'row':None,'cell':None,'depth':1});self.tables.append(table);return
  if not self.stack:return
  t=self.stack[-1]
  if tag=='tr':t['row']=[];t['table'].append(t['row'])
  elif tag in ('th','td') and t['row'] is not None:
   t['cell']={'text':'','attrs':attr};t['row'].append(t['cell'])
  elif tag in ('br','p') and t['cell'] is not None:t['cell']['text']+=' '
 def handle_endtag(self,tag):
  if not self.stack:return
  if tag=='table':self.stack.pop();return
  t=self.stack[-1]
  if tag in ('th','td'):t['cell']=None
  elif tag=='tr':t['row']=None
 def handle_data(self,data):
  for t in self.stack:
   if t['cell'] is not None:t['cell']['text']+=data

def parse_s_table(source,entries):
 if len(entries) not in (7,9):raise ValueError('unsupported rider count')
 names={norm(e['rider_full_name']):int(e['car_number']) for e in entries}
 if len(names)!=len(entries):raise ValueError('duplicate rider names')
 tree=Tables();tree.feed(source)
 headings={'S','S数','S回数','スタート回数','スタート数','ST'}
 for table in tree.tables:
  if len(table)<len(entries)+1:continue
  for head_index,head in enumerate(table):
   cols=[norm(c['text']).upper() for c in head]
   indices=[i for i,c in enumerate(cols) if c in headings]
   if not indices:continue
   for idx in indices:
    found={}
    for row in table[head_index+1:]:
     # Do not match glossary paragraphs; only full rider rows in the same table.
     combined=norm(''.join(c['text'] for c in row))
     matches=[(name,no) for name,no in names.items() if name in combined]
     if len(matches)!=1:continue
     name,no=matches[0]
     if no in found or len(row)<=idx:continue
     v=norm(row[idx]['text'])
     if not re.fullmatch(r'\d{1,2}',v):continue
     found[no]={'no':no,'name':name,'s':int(v)}
    if len(found)==len(entries) and all(x['s']<=50 for x in found.values()):
     return [found[int(e['car_number'])] for e in entries]
 raise ValueError('complete S column not found for all riders')

def race_sources(date,now):
 source='https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/'+date+'.json'
 day=json.loads(read_url(source))
 if day.get('date')!=date or not isinstance(day.get('races'),list):raise ValueError('daily feed mismatch')
 races=[]
 for r in day['races']:
  entries=r.get('entries') or []
  if r.get('is_girls') or len(entries) not in (7,9) or not all(str(e.get('class_rank','')).startswith('S') for e in entries):continue
  start=r.get('start_time','')
  try:cutoff=dt.datetime.fromisoformat(date+'T'+start+':00+09:00')
  except ValueError:continue
  if now>=cutoff or not re.fullmatch(r'\d{12}',str(r.get('race_id',''))):continue
  races.append((cutoff,r))
 return races

def collect(fetch=read_url,now=None,max_races=50,budget_seconds=240,delay=1.4):
 now=now or dt.datetime.now(UTC)
 path=ROOT/'data/s_counts.json'
 old=json.loads(path.read_text()) if path.exists() else {'snapshots':[]}
 snaps={str(s['race_id']):s for s in old.get('snapshots',[]) if s.get('complete') and s.get('race_id') and dt.date.fromisoformat(s['date'])>=now.astimezone(JST).date()-dt.timedelta(days=2)}
 errors=[];races=[]
 for i in range(2):
  day=(now.astimezone(JST).date()+dt.timedelta(days=i)).isoformat()
  try:
   # fetch parameter is injectable for tests.
   data=json.loads(fetch('https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/'+day+'.json'))
   if data.get('date')!=day:raise ValueError('feed date mismatch')
   for r in data.get('races',[]):
    es=r.get('entries') or []
    if r.get('is_girls') or len(es) not in (7,9) or not all(str(e.get('class_rank','')).startswith('S') for e in es):continue
    try:cutoff=dt.datetime.fromisoformat(day+'T'+r['start_time']+':00+09:00')
    except (ValueError,KeyError):continue
    if cutoff<=now or not re.fullmatch(r'\d{12}',str(r.get('race_id',''))):continue
    races.append((cutoff,day,r))
  except Exception as exc:errors.append({'date':day,'error':str(exc)[:150]})
 races.sort(key=lambda x:x[0])
 fetched=0;started=time.monotonic()
 for cutoff,date,r in races:
  rid=str(r['race_id'])
  if rid in snaps:continue
  if fetched>=max_races or time.monotonic()-started>budget_seconds:break
  url='https://keirin.netkeiba.com/race/entry/?race_id='+rid
  try:
   source=fetch(url)
   riders=parse_s_table(source,r['entries'])
   stamp=dt.datetime.now(UTC) if now is None else now
   if stamp>=cutoff:continue
   snaps[rid]={'date':date,'venue':r['venue'],'race_no':int(r['race_number']),'race_id':rid,
    'complete':True,'source_url':url,'collected_at':stamp.isoformat(),'riders':riders}
  except Exception as exc:errors.append({'race_id':rid,'error':str(exc)[:150]})
  fetched+=1
  if delay and time.monotonic()-started<budget_seconds:time.sleep(delay)
 current=dt.datetime.now(UTC)
 out={'schema':SCHEMA,'generated_at':current.isoformat(),'snapshots':list(snaps.values()),
  'status':{'selected':len(races),'attempted':fetched,'complete':len(snaps),'errors':errors[:60]}}
 path.parent.mkdir(exist_ok=True)
 temp=path.with_suffix('.tmp');temp.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n');temp.replace(path)
 print(json.dumps(out['status'],ensure_ascii=False))
 return out

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument('--max-races',type=int,default=50)
 ap.add_argument('--budget-seconds',type=float,default=240)
 args=ap.parse_args()
 collect(max_races=args.max_races,budget_seconds=args.budget_seconds)

if __name__=='__main__':main()
