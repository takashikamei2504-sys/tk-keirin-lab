import copy,datetime as dt,gzip,hashlib,json,pathlib,tempfile,unittest
from unittest.mock import patch
from mrt import research,shadow
from mrt import research_data as rd
ROOT=pathlib.Path(__file__).resolve().parents[2]

def snapshot():
 file=ROOT/'data/mrt/2026-11-22/202611223603-1b50253648ea77ed.json'
 return json.loads(file.read_text())

def manifest(p):return {'schema':'tk-mrt-candidate/v1','candidate_id':'mrt-test','status':'awaiting_forward_validation','current_model_sha256':p['model_sha256'],'engine_sha256':p['engine_sha256'],'model_sha256':'candidate-hash','validation_through':'20261121','adoption':'human_decision_required','automatic_promotion':False,'training_records':7126,'training_through':'20261121','created_at':p['generated_at']}

def result(p):
 return {'race_id':p['race_id'],'status':'final','roster':rd.roster(p['input']),'back':[p['automatic']['scenarios'][0]['proposed_B_holder']],'payouts':{ '-'.join(map(str,p['automatic']['tickets'][0]['cars'])):1000}}

class Research(unittest.TestCase):
 def test_seed_checksum_no_prose_and_feature_equivalence(self):
  data,audit=rd.load_corpus();self.assertEqual(audit['seed_records'],7126);self.assertEqual(len({r['race_id'] for r in data}),len(data));self.assertEqual(data[-1]['date'],'20261121')
  self.assertTrue(all(r['input_provenance']=='retrospectively_retrieved_historical_entry' for r in data[:7126]));self.assertTrue(all('view' not in r and 'explanation' not in r for r in data))
 def test_real_small_candidate_fits_serving_heads_without_production_write(self):
  from sklearn.ensemble import HistGradientBoostingClassifier,HistGradientBoostingRegressor
  data,_=rd.load_corpus();known=[r for r in data if r['labels']['back']];train=known[:64];target=next(r for r in known[64:] if r['date']>train[-1]['date'])
  before=rd.digest(rd.MODEL)
  with patch.object(rd.v3.v2,'clf',side_effect=lambda:HistGradientBoostingClassifier(max_iter=2,early_stopping=False,random_state=634)),patch.object(rd.v3.v2,'reg',side_effect=lambda:HistGradientBoostingRegressor(max_iter=2,early_stopping=False,random_state=634)):
   model=research.fit_candidate(train)
  out=rd.v3.predict_input(model,rd.input_only(target));self.assertEqual(sum(t['yen'] for t in out['tickets']),10000);self.assertEqual(len(model['finish_given_B']),3);self.assertEqual(model['history_through'],train[-1]['date']);self.assertEqual(rd.digest(rd.MODEL),before)
 def test_snapshot_temporal_and_answer_rejection(self):
  p=snapshot();rd.verify_snapshot(p)
  for key,value in [('pre_race',False),('entry_observed_at',p['start_at']),('generated_at',p['sales_close_at'])]:
   bad=copy.deepcopy(p);bad[key]=value
   with self.assertRaises(ValueError):rd.verify_snapshot(bad)
  bad=copy.deepcopy(p);bad['input']['labels']={}
  with self.assertRaises(ValueError):rd.verify_snapshot(bad)
 def test_new_labels_join_only_to_matching_pre_start_inputs(self):
  p=snapshot();ref={'forecast_id':'b123_634','expert_id':634,'result_crosspage_verified':True,'race_id':p['race_id'],'pre_race_snapshot':'data/mrt/2026-11-22/p.json','measured_result':{'roster':rd.roster(p['input'])},'labels':{'events':[]},'source_sha256':'reference'}
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);(root/'mrt').mkdir();(root/'mrt/research_seed.json.gz').write_bytes(gzip.compress(b'[]'));rd.dump(root/'mrt/research_seed_manifest.json',{'sha256':rd.digest(root/'mrt/research_seed.json.gz')});rd.dump(root/ref['pre_race_snapshot'],p);f=root/'data/mrt_teacher/records/b123_634.json';rd.dump(f,ref)
   data,a=rd.load_corpus(root);self.assertEqual(len(data),1);self.assertEqual(data[0]['lines'],p['input']['lines']);self.assertEqual(data[0]['input_provenance'],'verified_pre_start_snapshot')
   ref['measured_result']['roster']['1']='wrong';rd.dump(f,ref);data,a=rd.load_corpus(root);self.assertFalse(data);self.assertEqual(len(a['rejected']),1)
   ref['pre_race_snapshot']=None;rd.dump(f,ref);data,a=rd.load_corpus(root);self.assertEqual(a['missing_pre_start_input'],1)
 def test_monthly_split_never_uses_current_training_in_validation(self):
  records=[];asof=dt.date(2027,1,1)
  for day in range(1,32):
   for n in range(10):records.append({'date':'202612'+str(day).zfill(2),'input_provenance':'verified_pre_start_snapshot','forecast_id':str(day)+'-'+str(n)})
  train,val,a=research.split_training(records,{'history_through':'20261121'},asof)
  self.assertFalse(a['reasons']);self.assertLess(max(r['date'] for r in train),min(r['date'] for r in val));self.assertEqual(len(val),140)
  _,_,a=research.split_training(records,{'history_through':'20261225'},asof);self.assertIn('validation_overlaps_current_training',a['reasons'])
 def test_validation_uses_fourteen_available_dates_across_publication_gaps(self):
  records=[{'date':'202612'+str(day).zfill(2),'input_provenance':'verified_pre_start_snapshot'} for day in range(1,32) if day not in [20,25] for _ in range(10)]
  train,val,a=research.split_training(records,{'history_through':'20261121'},dt.date(2027,1,1));self.assertFalse(a['reasons']);self.assertEqual(len({r['date'] for r in val}),14);self.assertLess(max(r['date'] for r in train),min(r['date'] for r in val));self.assertEqual(a['validation_first'],'20261216')
 def test_monthly_failure_is_retried_on_next_daily_run(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);rd.dump(root/'data/mrt_research/status.json',{'monthly':{'state':'error'},'weekly':{}})
   with patch.object(research,'load_corpus',return_value=([],{})),patch.object(research,'make_monthly',return_value={'state':'insufficient_data'}) as make:
    research.run(root,dt.date(2026,11,24));make.assert_called_once()
 def test_force_check_does_not_bypass_thresholds_or_train(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(research,'fit_candidate') as fit:
   state=research.make_monthly(pathlib.Path(tmp),dt.date(2026,11,22),[{'date':'20261121'}],{})
   self.assertEqual(state['state'],'insufficient_data');fit.assert_not_called();self.assertFalse(state['automatic_promotion']);self.assertEqual(state['adoption'],'human_decision_required')
 def test_freeze_pair_requires_live_time_and_common_fingerprint(self):
  p=snapshot();m=manifest(p);at=dt.datetime.fromisoformat(p['generated_at'])+dt.timedelta(seconds=1)
  with patch.object(shadow,'now',return_value=at+dt.timedelta(seconds=1)),patch.object(rd.v3,'predict_input',return_value=p['automatic']):
   out=shadow.freeze_pair(p,{'history_through':'20261121'},m,at);self.assertEqual(out['current'],p['automatic']);self.assertFalse(out['automatic_promotion']);self.assertEqual(out['roster'],rd.roster(p['input']))
  for update in [{'engine_sha256':'wrong'},{'validation_through':'20261122'}]:
   bad=m|update
   with self.assertRaises(ValueError):shadow.freeze_pair(p,{'history_through':'20261121'},bad,at)
  with self.assertRaises(ValueError):shadow.freeze_pair(p,{},m,dt.datetime.fromisoformat(p['sales_close_at']))
  with patch.object(shadow,'now',return_value=dt.datetime.fromisoformat(p['sales_close_at'])),patch.object(rd.v3,'predict_input',return_value=p['automatic']):
   with self.assertRaises(ValueError):shadow.freeze_pair(p,{'history_through':'20261121'},m,at)
 def test_pairing_payout_same_budget_and_roster(self):
  p=snapshot();res=result(p);row=rd.score(p['automatic'],res,rd.roster(p['input']));ticket=p['automatic']['tickets'][0];self.assertEqual(row['payout'],ticket['yen']*10);self.assertEqual(row['stake'],10000)
  res['roster']['1']='wrong'
  with self.assertRaises(ValueError):rd.score(p['automatic'],res,rd.roster(p['input']))
  self.assertIsNone(rd.score(p['automatic'],None,rd.roster(p['input'])))
 def test_robustness_excludes_same_races_for_both_models(self):
  rows=[{'race_id':str(i),'month':'202612','field_size':7,'race_class':'A','current':{'stake':10000,'payout':100000 if i==0 else 0,'hit':i==0},'candidate':{'stake':10000,'payout':200000 if i==1 else 0,'hit':i==1}} for i in range(8)]
  report=rd.comparison(rows);r=report['highest_payout_exclusions'][0];self.assertEqual(r['current']['payout'],100000);self.assertEqual(r['candidate']['payout'],0);self.assertEqual(r['current']['races'],r['candidate']['races']);self.assertFalse(report['automatic_promotion'])
 def test_shadow_first_pair_is_immutable(self):
  p=snapshot();m=manifest(p);at=dt.datetime.fromisoformat(p['generated_at'])+dt.timedelta(seconds=2)
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);folder=root/'data/mrt_research/candidates/mrt-test';folder.mkdir(parents=True);(folder/'model.joblib').write_bytes(b'fake');m['model_sha256']=rd.digest(folder/'model.joblib');rd.dump(folder/'manifest.json',m);file='p.json';rd.dump(root/'data/mrt/2026-11-22'/file,p);rd.dump(root/'data/mrt/2026-11-22/index.json',{'races':[{'race_id':p['race_id'],'file':file,'identity_sha256':p['identity_sha256']}]})
   with patch.object(shadow,'now',return_value=at),patch.object(rd.v3,'predict_input',return_value=p['automatic']),patch.object(shadow.joblib,'load',return_value={'history_through':'20261121'}):
    first=shadow.run(root,'2026-11-22');target=root/'data/mrt_research/forward/mrt-test'/(p['race_id']+'.json');before=target.read_bytes();second=shadow.run(root,'2026-11-22');self.assertEqual(first['frozen'],1);self.assertEqual(second['already_frozen'],1);self.assertEqual(target.read_bytes(),before)
 def test_forward_insufficient_and_ready_both_require_human_decision(self):
  p=snapshot();m=manifest(p);at=dt.datetime.fromisoformat(p['generated_at'])+dt.timedelta(seconds=1)
  with patch.object(shadow,'now',return_value=at),patch.object(rd.v3,'predict_input',return_value=p['automatic']):pair=shadow.freeze_pair(p,{'history_through':'20261121'},m,at)
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);folder=root/'data/mrt_research/candidates/mrt-test';rd.dump(folder/'manifest.json',m);rd.dump(folder/'replay.json',{'metrics':rd.comparison([])});f=root/'data/mrt_research/forward/mrt-test'/(p['race_id']+'.json');rd.dump(f,pair)
   with patch.object(research,'results_map',return_value={p['race_id']:result(p)}):
    r=research.forward_reports(root)[0]['forward'];self.assertEqual(r['state'],'collecting_forward');self.assertEqual(r['paired_races'],1)
    with patch.dict(research.PROTOCOL,{'forward_min':1,'forward_days':1}):
     r=research.forward_reports(root)[0]['forward'];self.assertEqual(r['state'],'human_review_ready');self.assertFalse(r['automatic_promotion']);self.assertEqual(r['adoption'],'human_decision_required')
   pair['generated_at']=pair['sales_close_at'];rd.dump(f,pair)
   r=research.forward_reports(root)[0]['forward'];self.assertEqual(r['paired_races'],0);self.assertEqual(len(r['excluded']),1)
 def test_quarterly_structure_uses_only_prior_quarter(self):
  r={'date':'20261201','roster':[1,2,3,4,5,6,7],'lines':[[1,2,3],[4,5],[6,7]],'entry':{'race_class':'A'},'labels':{'back':[1],'finish':{'2':1,'1':2},'cancelled':[],'events':[{'actor':1,'action':'先行','negated':False}]}}
  q=research.structural_audit([r,r|{'date':'20270101'},r|{'date':'20260930'}],dt.date(2027,1,1));self.assertEqual(q['B_evaluable_races'],1);g=q['groups']['7車 / A'];self.assertEqual(g['B_line_other_win'],1);self.assertEqual(g['teacher_action_labels']['先行'],1);self.assertFalse(q['automatic_promotion'])
 def test_research_cannot_modify_production_model(self):
  before=rd.digest(rd.MODEL)
  with tempfile.TemporaryDirectory() as tmp,patch.object(research,'load_corpus',return_value=([],{'seed_records':0,'new_records':0})),patch.object(research,'monitor_current',return_value={}):
   status=research.run(pathlib.Path(tmp),dt.date(2026,11,22),True);self.assertTrue(status['production_unchanged']);self.assertFalse(status['automatic_promotion']);self.assertEqual(rd.digest(rd.MODEL),before)
if __name__=='__main__':unittest.main()
