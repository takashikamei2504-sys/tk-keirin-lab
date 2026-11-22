"""Offline research data and accounting. No network, promotion or production writes."""
import copy,datetime as dt,gzip,hashlib,json,pathlib,sys
import numpy as np
from .publish import ROOT,MODEL,ENGINE_HASH,dump,now
sys.path.insert(0,str(ROOT/'mrt/engine'))
import mrt_logic_v3 as v3
from mrt_logic_engine import payout
INPUT_KEYS={'race_id','date','venue','race_no','roster','lines','unknown_cars','names','entry'}

def read(path,default=None):
 return json.loads(path.read_text()) if path.exists() else default

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def input_only(r):return copy.deepcopy({k:v for k,v in r.items() if k in INPUT_KEYS})
def roster(r):return {str(c):p['rider_id'] for c,p in r['entry']['players'].items()}

def verify_snapshot(p):
 if p.get('pre_race') is not True or p.get('race_id')!=p.get('input',{}).get('race_id'):raise ValueError('Not a pre-race input snapshot')
 r=p['input'];dates=[dt.datetime.fromisoformat(p[k]) for k in ['entry_observed_at','generated_at','sales_close_at','start_at']]
 if any(x.tzinfo is None for x in dates) or not dates[0]<=dates[1]<dates[2]<dates[3]:raise ValueError('Invalid pre-start timestamps')
 if len(r['roster']) not in (7,9) or len(set(roster(r).values()))!=len(r['roster']):raise ValueError('Invalid field or rider IDs')
 if set(r)-INPUT_KEYS:raise ValueError('Answer-bearing snapshot input')
 if p['race_id'][:8]!=r['date']:raise ValueError('Input date mismatch')
 return r

def load_corpus(root=ROOT):
 manifest=read(root/'mrt/research_seed_manifest.json');seed=root/'mrt/research_seed.json.gz'
 if digest(seed)!=manifest['sha256']:raise ValueError('Historical seed checksum mismatch')
 data=json.load(gzip.open(seed,'rt'));audit={'seed_records':len(data),'new_records':0,'missing_pre_start_input':0,'rejected':[]}
 known={r['forecast_id'] for r in data};races={r['race_id'] for r in data}
 for path in sorted((root/'data/mrt_teacher/records').glob('*.json')):
  ref=read(path)
  if ref['forecast_id'] in known:continue
  try:
   if ref.get('expert_id')!=634 or not ref.get('result_crosspage_verified'):raise ValueError('Unverified teacher reference')
   rel=ref.get('pre_race_snapshot')
   if not rel:audit['missing_pre_start_input']+=1;continue
   src=(root/rel).resolve()
   if not src.is_relative_to((root/'data/mrt').resolve()):raise ValueError('Invalid snapshot path')
   p=read(src);r=verify_snapshot(p)
   if r['race_id']!=ref['race_id'] or roster(r)!=ref['measured_result']['roster']:raise ValueError('Teacher and input identity mismatch')
   if r['race_id'] in races:raise ValueError('Duplicate race in teacher corpus')
   item=input_only(r);item.update(forecast_id=ref['forecast_id'],history_keys=roster(r),labels=copy.deepcopy(ref['labels']),source_sha256=ref['source_sha256'],input_provenance='verified_pre_start_snapshot')
   item['entry']['asof_start_verified']=True
   # References from the original collector contain raw negated/conditional actions.
   for e in item['labels']['events']:
    if e['action'] in ['先行','捲り','番手抜出']:
     if e.get('negated'):e['action']='否定:'+e['action'];e['negated']=False
     elif e.get('conditional'):e['action']='条件:'+e['action']
   data.append(item);known.add(item['forecast_id']);races.add(item['race_id']);audit['new_records']+=1
  except (ValueError,KeyError,TypeError,FileNotFoundError) as e:audit['rejected'].append({'forecast_id':ref.get('forecast_id'),'reason':str(e)})
 data.sort(key=lambda r:(r['date'],r['race_id'],r['forecast_id']))
 return data,audit

def result_from_teacher(ref):
 lab=ref['labels'];measured=ref['measured_result']
 if measured['status']!='final' or lab['cancelled'] or len(lab['finish'])!=len(ref['roster']):return None
 pays={}
 for t in v3.winners(lab):
  value=payout({'cars':list(t),'yen':100},'3連単',lab)
  if value is None:return None
  pays['-'.join(map(str,t))]=value
 if not pays:return None
 return {'status':'final','race_id':ref['race_id'],'roster':measured['roster'],'back':lab['back'],'payouts':pays}

def results_map(root):
 results={}
 for path in sorted((root/'data/mrt').glob('*/results.json')):
  for r in read(path,{}).get('results',[]):
   if r.get('status')=='final':results[r['race_id']]=r
 for path in sorted((root/'data/mrt_teacher/records').glob('*.json')):
  ref=read(path);r=result_from_teacher(ref)
  if r and r['race_id'] not in results:results[r['race_id']]=r
 return results

def score(output,result,expected_roster,teacher=None):
 if not result or result.get('status')!='final':return None
 if result.get('race_id')!=output.get('race_id') or result.get('roster')!=expected_roster:raise ValueError('Result roster mismatch')
 tickets=output['tickets'];stake=sum(t['yen'] for t in tickets)
 if stake!=10000 or any(t['yen']<=0 or t['yen']%100 for t in tickets):raise ValueError('Comparison must use the same 10000-yen budget')
 pay=sum(t['yen']/100*result['payouts'].get('-'.join(map(str,t['cars'])),0) for t in tickets)
 backs=result.get('back') or [];scenes=output['scenarios'];top=max(scenes,key=lambda x:x['scenario_weight'])['proposed_B_holder']
 row={'stake':stake,'payout':int(pay),'hit':pay>0,'points':len(tickets),'B_correct':top in backs if backs else None}
 ts={tuple(t['cars']) for t in (teacher or {}).get('labels',{}).get('tickets',{}).get('3連単',[])}
 row['teacher_ticket_recall']=len(ts&{tuple(t['cars']) for t in tickets})/len(ts) if ts else None
 return row

def aggregate(rows):
 def mean(key):
  values=[r[key] for r in rows if r.get(key) is not None]
  return float(np.mean(values)) if values else None
 stake=sum(r['stake'] for r in rows);pay=sum(r['payout'] for r in rows)
 return {'races':len(rows),'stake':stake,'payout':pay,'return_percent':100*pay/stake if stake else None,'hit_rate':mean('hit'),'B_accuracy':mean('B_correct'),'mean_points':mean('points'),'teacher_ticket_recall':mean('teacher_ticket_recall')}

def comparison(rows):
 current=aggregate([r['current'] for r in rows]);candidate=aggregate([r['candidate'] for r in rows]);ranked=sorted(rows,key=lambda r:(-max(r['current']['payout'],r['candidate']['payout']),r['race_id']))
 robust=[]
 for n in [1,3,5]:
  rest=ranked[n:];robust.append({'removed':n,'races':len(rest),'current':aggregate([r['current'] for r in rest]),'candidate':aggregate([r['candidate'] for r in rest])})
 groups={}
 for key in ['month','field_size','race_class']:
  values=sorted({str(r[key]) for r in rows})
  groups[key]={value:{'current':aggregate([r['current'] for r in rows if str(r[key])==value]),'candidate':aggregate([r['candidate'] for r in rows if str(r[key])==value])} for value in values}
 return {'paired_races':len(rows),'current':current,'candidate':candidate,'highest_payout_exclusions':robust,'groups':groups,'exclusion_policy':'Remove the same races ranked by max(current payout,candidate payout).','adoption':'human_decision_required','automatic_promotion':False}
