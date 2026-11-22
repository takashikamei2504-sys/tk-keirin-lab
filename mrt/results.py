"""Result-only collection, independently joined to frozen per-car rider IDs.
Irregular finishes/refunds are excluded rather than counted as losing bets.
"""
import argparse,datetime as dt,json,pathlib,re
from .entry import Tables,plain
from .publish import Fetcher,ROOT,now,dump

def parse_result(html,payload):
 rid=payload['race_id'];url='https://keirin.netkeiba.com/race/result/?race_id='+rid
 canonical=re.search(r'<link rel="canonical" href="([^"]+)"',html)
 if not canonical or canonical[1]!=url:raise ValueError('Result identity mismatch')
 if not re.search(r'<p>\s*レースが確定しました\s*</p>',html):return {'race_id':rid,'status':'pending'}
 schedule=re.search(r'<div class="Race_Data"[^>]*>(.*?)</div>',html,re.S)
 expected=dt.datetime.fromisoformat(payload['start_at']).strftime('%H:%M')
 if not schedule or not re.search('発走\\s*'+re.escape(expected)+r'(?!\d)',plain(schedule[1])):raise ValueError('Schedule changed')
 table=re.search(r'<table\b[^>]*id="All_Result_Table"[^>]*>(.*?)</table>',html,re.S)
 if not table:raise ValueError('Result table unavailable')
 roster={};backs=[];ranks={}
 for row in re.findall(r'<tr\b[^>]*class="PlayerList"[^>]*>(.*?)</tr>',table[1],re.S):
  cells=re.findall(r'<td\b[^>]*>(.*?)</td>',row,re.S)
  if len(cells)!=8:raise ValueError('Invalid result row')
  car=plain(cells[2]);rider=re.search(r'/db/profile/\?id=(\d+)',cells[3]);rank=re.fullmatch(r'([1-9])着',plain(cells[0]))
  if not car.isdigit() or not rider or car in roster:raise ValueError('Invalid result identity')
  roster[car]=rider[1]
  if not rank:raise ValueError('Irregular finish, cancellation or refund')
  ranks[car]=int(rank[1])
  if 'B' in plain(cells[7]):backs.append(int(car))
 expected_roster={c:p['rider_id'] for c,p in payload['input']['entry']['players'].items()}
 if roster!=expected_roster:raise ValueError('Rider roster changed')
 payouts={}
 for row in re.findall(r'<tr\b[^>]*class="Tan3"[^>]*>(.*?)</tr>',html,re.S):
  combo=re.search(r'<td class="Result">(.*?)</td>',row,re.S);amount=re.search(r'<td class="Payout">(.*?)</td>',row,re.S)
  if not combo or not amount:raise ValueError('Invalid triple payout')
  key=re.sub(r'\s*', '',plain(combo[1])).replace('>','-');cash=plain(amount[1])
  if not re.fullmatch(r'[1-9]-[1-9]-[1-9]',key) or not re.fullmatch(r'[\d,]+円',cash) or len(set(key.split('-')))!=3:raise ValueError('Invalid triple payment')
  cars=key.split('-');rs=[ranks.get(c) for c in cars]
  # Equal-rank permutations are legitimate for dead heats.
  if any(v is None for v in rs) or rs!=sorted(rs) or max(rs)>3:raise ValueError('Finish and payout disagree')
  payouts[key]=int(cash[:-1].replace(',',''))
 if not payouts:raise ValueError('Payout pending')
 return {'race_id':rid,'status':'final','roster':roster,'ranks':ranks,'back':backs,'payouts':payouts,'source_url':url,'checked_at':now().isoformat()}

def run(root=None):
 root=pathlib.Path(root or ROOT/'data/mrt');fetch=Fetcher()
 # Only dates that already have real pre-race snapshots. No forecast generation here.
 for index in sorted(root.glob('*/index.json')):
  date=index.parent.name
  if date<(now().date()-dt.timedelta(days=7)).isoformat():continue
  manifest=json.loads(index.read_text());dest=index.parent/'results.json';prior={r['race_id']:r for r in json.loads(dest.read_text()).get('results',[])} if dest.exists() else {};rows=[]
  snapshots={}
  for f in sorted(index.parent.glob('????????????-????????????????.json')):
   payload=json.loads(f.read_text())
   if payload.get('pre_race') and payload.get('input'):
    rid=payload['race_id'];previous=snapshots.get(rid)
    if previous is None or payload['generated_at']>previous['generated_at']:
     snapshots[rid]={'race_id':rid,'file':f.name,'start_at':payload['start_at'],'generated_at':payload['generated_at']}
  for row in snapshots.values():
   if now()<dt.datetime.fromisoformat(row['start_at'])+dt.timedelta(minutes=5):continue
   if prior.get(row['race_id'],{}).get('status')=='final':rows.append(prior[row['race_id']]);continue
   try:
    payload=json.loads((index.parent/row['file']).read_text());h=fetch.get('https://keirin.netkeiba.com/race/result/?race_id='+row['race_id']);rows.append(parse_result(h,payload))
   except PermissionError:raise
   except Exception as e:rows.append({'race_id':row['race_id'],'status':'unverified','reason':str(e),'checked_at':now().isoformat()})
  dump(dest,{'schema':'tk-mrt-results/v1','date':date,'checked_at':now().isoformat(),'results':rows})
if __name__=='__main__':run()
