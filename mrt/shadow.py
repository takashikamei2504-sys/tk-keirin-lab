"""Freeze candidate/current pairs before close. This never serves or adopts a model."""
import datetime as dt,hashlib,json,pathlib
import joblib
from .research_data import ROOT,MODEL,ENGINE_HASH,v3,read,digest,dump,now,verify_snapshot,input_only,roster

def candidates(root):
 result=[]
 for p in sorted((root/'data/mrt_research/candidates').glob('*/manifest.json')):
  m=read(p)
  if m.get('schema')!='tk-mrt-candidate/v1' or m.get('automatic_promotion') is not False or m.get('adoption')!='human_decision_required':continue
  if m.get('status')=='awaiting_forward_validation':result.append((p.parent,m))
 return result

def freeze_pair(payload,model,manifest,at=None):
 at=at or now();r=verify_snapshot(payload);close=dt.datetime.fromisoformat(payload['sales_close_at'])
 if at>=close or dt.datetime.fromisoformat(payload['generated_at'])>at:raise ValueError('Not a live pre-close snapshot')
 if payload.get('model_sha256')!=manifest['current_model_sha256'] or payload.get('engine_sha256')!=manifest['engine_sha256']:raise ValueError('Baseline fingerprint changed')
 if r['date']<=manifest['validation_through'] or r['date']<=model['history_through']:raise ValueError('Forward race overlaps training or validation')
 output=v3.predict_input(model,input_only(r));completed=now()
 if completed>=close or completed<at:raise ValueError('Candidate calculation crossed close or clock changed')
 return {'schema':'tk-mrt-forward-pair/v1','candidate_id':manifest['candidate_id'],'race_id':r['race_id'],'date':r['date'],'generated_at':completed.isoformat(),'current_generated_at':payload['generated_at'],'sales_close_at':payload['sales_close_at'],'start_at':payload['start_at'],'pre_race':True,'roster':roster(r),'input_sha256':hashlib.sha256(json.dumps(r,sort_keys=True).encode()).hexdigest(),'identity_sha256':payload['identity_sha256'],'field_size':len(r['roster']),'race_class':r['entry'].get('race_class') or '不明','month':r['date'][:6],'current_model_sha256':payload['model_sha256'],'candidate_model_sha256':manifest['model_sha256'],'engine_sha256':manifest['engine_sha256'],'current':payload['automatic'],'candidate':output,'automatic_promotion':False}

def run(root=ROOT,date=None):
 date=date or now().astimezone(dt.timezone(dt.timedelta(hours=9))).date().isoformat();research=root/'data/mrt_research';active=candidates(root)
 if not active:
  status={'schema':'tk-mrt-shadow-status/v1','checked_at':now().isoformat(),'state':'no_candidate','frozen':0,'errors':[],'automatic_promotion':False};dump(research/'shadow_status.json',status);return status
 folder,manifest=active[-1];modelpath=folder/'model.joblib'
 if digest(MODEL)!=manifest['current_model_sha256'] or ENGINE_HASH!=manifest['engine_sha256']:raise ValueError('Current model/engine changed; new comparison is required')
 if digest(modelpath)!=manifest['model_sha256']:raise ValueError('Candidate checksum mismatch')
 model=joblib.load(modelpath);dest=research/'forward'/manifest['candidate_id'];dest.mkdir(parents=True,exist_ok=True);status={'schema':'tk-mrt-shadow-status/v1','date':date,'checked_at':now().isoformat(),'candidate_id':manifest['candidate_id'],'state':'collecting','frozen':0,'already_frozen':0,'closed':0,'errors':[],'automatic_promotion':False}
 # Each candidate/race has only one immutable earliest successfully calculated pair.
 index=read(root/'data/mrt'/date/'index.json',{})
 for row in index.get('races',[]):
  rid=row['race_id'];target=dest/(rid+'.json')
  if target.exists():status['already_frozen']+=1;continue
  try:
   file=row.get('file')
   if not file:continue
   path=(root/'data/mrt'/date/file).resolve()
   if path.parent!=(root/'data/mrt'/date).resolve():raise ValueError('Invalid snapshot path')
   p=read(path)
   if p['race_id']!=rid or p['identity_sha256']!=row.get('identity_sha256'):raise ValueError('Input changed')
   if now()>=dt.datetime.fromisoformat(p['sales_close_at']):status['closed']+=1;continue
   pair=freeze_pair(p,model,manifest);dump(target,pair);status['frozen']+=1
  except Exception as e:status['errors'].append({'race_id':rid,'reason':str(e)})
 dump(research/'shadow_status.json',status);return status
if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('--date');args=p.parse_args()
 try:print(json.dumps(run(date=args.date),ensure_ascii=False))
 except Exception as e:
  dump(ROOT/'data/mrt_research/shadow_status.json',{'schema':'tk-mrt-shadow-status/v1','checked_at':now().isoformat(),'state':'error','reason':str(e),'automatic_promotion':False});raise
