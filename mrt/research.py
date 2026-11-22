"""Scheduled monitoring, monthly training and comparison; human adoption only.
All writes stay in data/mrt_research. No promotion CLI, model switch or git merge.
"""
import argparse,copy,datetime as dt,hashlib,json,pathlib
import joblib,numpy as np
from sklearn.ensemble import ExtraTreesRegressor
from .research_data import ROOT,MODEL,ENGINE_HASH,v3,read,digest,dump,now,load_corpus,input_only,roster,verify_snapshot,results_map,score,aggregate,comparison
from .shadow import candidates
JST=dt.timezone(dt.timedelta(hours=9))
PROTOCOL={'version':'mrt-review-1','budget_yen':10000,'new_training_min':100,'validation_min':100,'validation_days':14,'forward_min':200,'forward_days':28,'automatic_promotion':False,'adoption':'human_decision_required','monthly':'1st 08:10 JST','weekly':'Monday 08:10 JST','quarterly':'Jan/Apr/Jul/Oct 1st','scope':'Refit V3 B, ticket count, B-conditional finish heads and explanation action-label heads. No hyperparameter search on validation.'}

def fit_candidate(data):
 """V3 serving uses B/count/three finish heads. Unused V2 sequence heads are not fitted."""
 features,history=v3.build_features(data);RX=[];backs=[];raceX=[];counts=[]
 for r,(rf,rv) in zip(data,features):
  raceX.append(rf);counts.append(sum(map(len,r['labels']['tickets'].values())))
  for c in sorted(rv):
   if r['labels']['back'] is not None and c not in r['labels']['cancelled']:
    RX.append(rf+rv[c]);backs.append(int(c in r['labels']['back']))
 if len(set(backs))!=2:raise ValueError('B labels require positive and negative examples')
 ids=list(range(len(data)));X,Y,_=v3.v2.actor_rows(data,features,ids)
 base={'back':v3.v2.clf().fit(np.asarray(RX,dtype=np.float32),backs),'count':ExtraTreesRegressor(n_estimators=120,min_samples_leaf=15,random_state=634,n_jobs=2).fit(raceX,counts),'actions':v3.v2.fit_actions(X,Y),'training_forecast_ids':[r['forecast_id'] for r in data],'trained_races':len(data),'trained_through':data[-1]['date']}
 model=v3.fit_scenario(data,features,ids,base);model.update(history=history,history_through=data[-1]['date']);return model

def split_training(data,current,asof):
 eligible=[r for r in data if r['date']<asof.strftime('%Y%m%d')];latest=max((r['date'] for r in eligible),default=current['history_through'])
 first=(dt.datetime.strptime(latest,'%Y%m%d').date()-dt.timedelta(days=PROTOCOL['validation_days']-1)).strftime('%Y%m%d')
 train=[r for r in eligible if r['date']<first];validation=[r for r in eligible if r['date']>=first and r.get('input_provenance')=='verified_pre_start_snapshot'];new=[r for r in train if r['date']>current['history_through']]
 reasons=[]
 if first<=current['history_through']:reasons.append('validation_overlaps_current_training')
 if len(new)<PROTOCOL['new_training_min']:reasons.append('new_training_records_below_100')
 if len(validation)<PROTOCOL['validation_min']:reasons.append('validation_records_below_100')
 if len({r['date'] for r in validation})<PROTOCOL['validation_days']:reasons.append('validation_dates_below_14')
 return train,validation,{'new_training_records':len(new),'validation_records':len(validation),'validation_first':first,'validation_through':latest,'reasons':reasons}

def retrospective_compare(current,candidate,validation):
 from .research_data import result_from_teacher
 rows=[];excluded=[]
 for r in validation:
  try:
   lab=r['labels'];ref={'labels':lab,'measured_result':{'status':'final','roster':roster(r)},'roster':r['roster'],'race_id':r['race_id']};res=result_from_teacher(ref)
   if not res:excluded.append({'race_id':r['race_id'],'reason':'Irregular finish or missing payment'});continue
   inp=input_only(r);a=v3.predict_input(current,inp);b=v3.predict_input(candidate,inp)
   rows.append({'race_id':r['race_id'],'date':r['date'],'month':r['date'][:6],'field_size':len(r['roster']),'race_class':r['entry'].get('race_class') or '不明','current':score(a,res,roster(r),r),'candidate':score(b,res,roster(r),r)})
  except ValueError as e:excluded.append({'race_id':r['race_id'],'reason':str(e)})
 return {'schema':'tk-mrt-comparison/v1','mode':'historical_replay_on_pre_start_inputs','untouched_forward_test':False,'selection_rule_fixed_before_run':True,'metrics':comparison(rows),'excluded':excluded,'rows':rows}

def make_monthly(root,asof,data,audit):
 dest=root/'data/mrt_research';period=asof.strftime('%Y-%m');attempt=dest/'monthly'/(period+'.json')
 # Monthly outcome is immutable. Insufficient-data months wait for the next month.
 if attempt.exists():return read(attempt)
 current=joblib.load(MODEL);train,validation,eligibility=split_training(data,current,asof)
 state={'schema':'tk-mrt-monthly/v1','period':period,'checked_at':now().isoformat(),'state':'insufficient_data','eligibility':eligibility,'data_audit':audit,'protocol':PROTOCOL,'automatic_promotion':False,'adoption':'human_decision_required'}
 if eligibility['reasons']:dump(attempt,state);return state
 corpus_hash=hashlib.sha256(json.dumps(train,sort_keys=True,ensure_ascii=False).encode()).hexdigest();cid='mrt-'+period+'-'+corpus_hash[:12];folder=dest/'candidates'/cid
 if (folder/'manifest.json').exists():state.update(state='candidate_created',candidate_id=cid);dump(attempt,state);return state
 folder.mkdir(parents=True,exist_ok=True);model=fit_candidate(train);modelpath=folder/'model.joblib';tmp=folder/'model.tmp';joblib.dump(model,tmp,compress=3);tmp.replace(modelpath)
 replay=retrospective_compare(current,model,validation);dump(folder/'replay.json',replay)
 manifest={'schema':'tk-mrt-candidate/v1','candidate_id':cid,'created_at':now().isoformat(),'status':'awaiting_forward_validation','training_records':len(train),'training_through':model['history_through'],'training_forecast_ids':model['training_forecast_ids'],'validation_ids':[r['forecast_id'] for r in validation],'validation_through':eligibility['validation_through'],'training_corpus_sha256':corpus_hash,'training_code_sha256':hashlib.sha256(b''.join((ROOT/'mrt'/name).read_bytes() for name in ['research.py','research_data.py','shadow.py'])).hexdigest(),'model_sha256':digest(modelpath),'current_model_sha256':digest(MODEL),'engine_sha256':ENGINE_HASH,'protocol':PROTOCOL,'automatic_promotion':False,'adoption':'human_decision_required','input_provenance':'Historical original corpus plus new verified pre-start snapshots; replay is not a prospective test.'}
 dump(folder/'manifest.json',manifest);state.update(state='candidate_created',candidate_id=cid);dump(attempt,state);return state

def forward_reports(root):
 dest=root/'data/mrt_research';results=results_map(root);teachers={r['race_id']:r for p in (root/'data/mrt_teacher/records').glob('*.json') for r in [read(p)]};reports=[]
 for folder,m in candidates(root):
  rows=[];pending=0;excluded=[]
  for path in sorted((dest/'forward'/m['candidate_id']).glob('*.json')):
   p=read(path)
   try:
    if p.get('pre_race') is not True or p.get('candidate_id')!=m['candidate_id'] or p['candidate_model_sha256']!=m['model_sha256'] or p['current_model_sha256']!=m['current_model_sha256'] or p['engine_sha256']!=m['engine_sha256']:raise ValueError('Pair fingerprint mismatch')
    generated=dt.datetime.fromisoformat(p['generated_at']);close=dt.datetime.fromisoformat(p['sales_close_at'])
    if generated.tzinfo is None or not dt.datetime.fromisoformat(p['current_generated_at'])<=generated<close or p['date']<=m['validation_through']:raise ValueError('Invalid forward timestamp or split')
    res=results.get(p['race_id']);a=score(p['current'],res,p['roster'],teachers.get(p['race_id']));b=score(p['candidate'],res,p['roster'],teachers.get(p['race_id']))
    if a is None or b is None:pending+=1;continue
    rows.append({k:p[k] for k in ['race_id','date','month','field_size','race_class']}|{'current':a,'candidate':b})
   except (ValueError,KeyError) as e:excluded.append({'race_id':p.get('race_id'),'reason':str(e)})
  dates=[dt.datetime.strptime(r['date'],'%Y%m%d').date() for r in rows];days=(max(dates)-min(dates)).days+1 if dates else 0;ready=len(rows)>=PROTOCOL['forward_min'] and days>=PROTOCOL['forward_days'];metrics=comparison(rows)
  report={'schema':'tk-mrt-forward-report/v1','candidate_id':m['candidate_id'],'checked_at':now().isoformat(),'state':'human_review_ready' if ready else 'collecting_forward','automatic_promotion':False,'adoption':'human_decision_required','paired_races':len(rows),'calendar_span_days':days,'pending':pending,'excluded':excluded,'metrics':metrics,'rows':rows,'baseline_still_current':digest(MODEL)==m['current_model_sha256'] and ENGINE_HASH==m['engine_sha256']}
  dump(folder/'forward_report.json',report);reports.append({'candidate_id':m['candidate_id'],'training_records':m['training_records'],'training_through':m['training_through'],'created_at':m['created_at'],'replay':read(folder/'replay.json')['metrics'],'forward':{k:v for k,v in report.items() if k!='rows'}})
 return reports

def monitor_current(root,asof):
 results=results_map(root);teacher={r['race_id']:r for p in (root/'data/mrt_teacher/records').glob('*.json') for r in [read(p)]};rows=[];excluded=[];pending=0;seen=set();first=(asof-dt.timedelta(days=28)).isoformat()
 paths=sorted((root/'data/mrt').glob('*/????????????-????????????????.json'),key=lambda p:(p.parent.name,read(p).get('generated_at',''),p.name))
 for path in paths:
  if not first<=path.parent.name<asof.isoformat():continue
  p=read(path);rid=p.get('race_id')
  if rid in seen:continue
  try:
   r=verify_snapshot(p)
   if p.get('model_sha256')!=digest(MODEL):continue
   row=score(p['automatic'],results.get(rid),roster(r),teacher.get(rid))
   if row is None:pending+=1;seen.add(rid);continue
   seen.add(rid);rows.append(row|{'race_id':rid,'date':r['date'],'field_size':len(r['roster']),'race_class':r['entry'].get('race_class') or '不明'})
  except (ValueError,KeyError) as e:excluded.append({'race_id':rid,'reason':str(e)})
 return {'schema':'tk-mrt-weekly/v1','checked_at':now().isoformat(),'window_start':first,'window_end':(asof-dt.timedelta(days=1)).isoformat(),'metrics':aggregate(rows),'pending':pending,'excluded':excluded,'teacher_overlap_races':sum(r['teacher_ticket_recall'] is not None for r in rows),'automatic_promotion':False}

def structural_audit(data,asof):
 month=asof.year*12+asof.month-1-3;first=dt.date(month//12,month%12+1,1).strftime('%Y%m%d');end=asof.strftime('%Y%m%d');groups={};total=0
 for r in data:
  if not first<=r['date']<end:continue
  lab=r['labels'];backs=lab['back'] or [];wins=[int(c) for c,rank in lab['finish'].items() if rank==1]
  if not backs or not wins or lab['cancelled']:continue
  total+=1;loc={c:i for i,line in enumerate(r['lines']) for c in line};key=str(len(r['roster']))+'車 / '+(r['entry'].get('race_class') or '不明');g=groups.setdefault(key,{'races':0,'B_holder_win':0,'B_line_other_win':0,'other_line_win':0,'unknown_line_win':0,'teacher_action_labels':{}});g['races']+=1
  # Dead heats may contribute to several winner categories; counts are descriptive.
  for winner in wins:
   kind='B_holder_win' if winner in backs else 'unknown_line_win' if winner not in loc or any(b not in loc for b in backs) else 'B_line_other_win' if any(loc[winner]==loc[b] for b in backs) else 'other_line_win';g[kind]+=1
  for e in lab['events']:
   if not e.get('negated'):g['teacher_action_labels'][e['action']]=g['teacher_action_labels'].get(e['action'],0)+1
 return {'schema':'tk-mrt-quarterly/v1','checked_at':now().isoformat(),'period':asof.strftime('%Y-%m'),'window_start':first,'window_end':(asof-dt.timedelta(days=1)).strftime('%Y%m%d'),'state':'structural_review_required','B_evaluable_races':total,'groups':groups,'automatic_promotion':False,'message':'直近3か月のB取得者押し切り・同ライン別選手・別線決着と解説の判断要素を車数・級班別に集計。構造変更の採用は人の判断を待つ。','provenance':'Descriptive historical labels; older lineup inputs were retrieved retrospectively.'}

def run(root=ROOT,asof=None,force=False):
 asof=asof or now().astimezone(JST).date();dest=root/'data/mrt_research';before=digest(MODEL);data,audit=load_corpus(root)
 old=read(dest/'status.json',{});monthly=old.get('monthly');weekly=old.get('weekly');quarterly=old.get('quarterly')
 if force or asof.weekday()==0 or weekly is None:
  weekly=monitor_current(root,asof);dump(dest/'weekly'/(asof.isoformat()+'.json'),weekly)
 if force or asof.day==1 or monthly is None:
  try:monthly=make_monthly(root,asof,data,audit)
  except Exception as e:
   monthly={'schema':'tk-mrt-monthly/v1','period':asof.strftime('%Y-%m'),'state':'error','checked_at':now().isoformat(),'reason':str(e),'automatic_promotion':False};dump(dest/'errors'/(asof.isoformat()+'.json'),monthly)
 reports=forward_reports(root)
 if asof.month in [1,4,7,10] and asof.day==1:
  quarterly=structural_audit(data,asof);dump(dest/'quarterly'/(asof.strftime('%Y-%m')+'.json'),quarterly)
 status={'schema':'tk-mrt-research-status/v1','checked_at':now().isoformat(),'production_model_sha256':before,'production_unchanged':before==digest(MODEL),'automatic_promotion':False,'adoption':'human_decision_required','protocol':PROTOCOL,'corpus':{'total_records':len(data),**audit},'monthly':monthly,'weekly':weekly,'quarterly':quarterly,'shadow':read(dest/'shadow_status.json'),'candidates':reports}
 if not status['production_unchanged']:raise RuntimeError('Production model changed during research')
 dump(dest/'status.json',status);return status
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--force-check',action='store_true',help='Run eligibility/monitoring now; never bypass data thresholds or approve adoption.');a=p.parse_args();s=run(force=a.force_check);print(json.dumps({'monthly':s['monthly']['state'],'candidates':len(s['candidates']),'production_unchanged':s['production_unchanged']},ensure_ascii=False));raise SystemExit(1 if s['monthly']['state']=='error' else 0)
