import sys,pathlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/"mrt/engine"))
import copy,unittest
import numpy as np
from mrt_logic_v2 import extract_events,ordered_target,features_for,all_features,seq_features,ACTION_NAMES

class LogicV2Contracts(unittest.TestCase):
 def base(self,date='20261120'):
  return {'date':date,'race_id':date+'0101','venue':1,'race_no':1,'roster':[1,2,3,4,5],'lines':[[1,2],[3,4]],'unknown_cars':[5],
   'names':{str(i):str(i)+'選手' for i in range(1,6)},'history_keys':{str(i):str(i)+'選手' for i in range(1,6)},'labels':{'finish':{'1':1},'back':[1],'scores_after_race':{'1':100},'cancelled':[]}}
 def test_subject_action_and_conditional(self):
  events,edges,mentioned,un=extract_events('青木(1番車)が先行した場合、木村(2番車)が差す。',{1:['青木'],2:['木村']})
  self.assertTrue(any(e['actor']==1 and e['action']=='先行' and e['conditional'] for e in events))
  self.assertTrue(any(e['actor']==2 and e['action']=='番手抜出' for e in events))
  self.assertFalse(any(e['actor']==2 and e['action']=='先行' for e in events))
 def test_ambiguous_alias_not_assigned(self):
  events,edges,mentioned,un=extract_events('佐々木が捲りを決める。',{1:['佐々木'],2:['佐々木']})
  self.assertEqual(events,[]);self.assertGreater(un,0)
 def test_negation_retained(self):
  events,*_=extract_events('青木(1番車)の先行は考えにくい。',{1:['青木']})
  self.assertTrue(any(e['negated'] for e in events))
 def test_combinations_symmetrized_mass(self):
  target=ordered_target([{'cars':[1,2,3],'yen':1000}],'3連複')
  self.assertEqual(len(target),6);self.assertAlmostEqual(sum(target.values()),1.)
 def test_unknown_position_not_single(self):
  r=self.base();rf,rv=features_for(r,{})
  self.assertEqual(rv[5][1],-1);self.assertEqual(rv[5][5],0);self.assertEqual(rv[5][6],1)
 def test_answers_do_not_change_current_features(self):
  r=self.base();a=features_for(r,{})
  r['labels']={'honmei':9,'tickets':{},'finish':{'5':1},'cancelled':[1],'events':[{'actor':1,'action':'先行'}]}
  self.assertEqual(a,features_for(r,{}))
 def test_same_date_is_frozen(self):
  a=self.base();b=copy.deepcopy(a);c=self.base('20261121');f,h=all_features([a,b,c])
  self.assertEqual(f[0],f[1]);self.assertEqual(f[2][1][1][7],2)

if __name__=='__main__':unittest.main()
