import sys,pathlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/"mrt/engine"))
import copy,unittest
import numpy as np
import mrt_logic_v3 as v3
from test_mrt_logic_v2 import LogicV2Contracts

class ConstantRegressor:
 def __init__(self,value=1.):self.value=value
 def predict(self,X):return np.full(len(X),self.value)
class ConstantClassifier:
 def predict_proba(self,X):return np.full((len(X),2),.5)

class V3Contracts(unittest.TestCase):
 def setup_fixture(self):
  r=LogicV2Contracts().base();r['lines']=[[1,2,3],[4,5]];r['unknown_cars']=[];rf,rv=v3.v2.features_for(r,{})
  model={'base':{'back':ConstantClassifier(),'count':ConstantRegressor(6)},'finish_given_B':[ConstantRegressor(),ConstantRegressor(),ConstantRegressor()]}
  return model,r,(rf,rv)
 def test_guard_effect_and_reference(self):
  x,u=v3.branches('青木(1番車)が先行した場合、木村(2番車)が差す。その場合、田中(3番車)が伸びる。',{1:['青木'],2:['木村'],3:['田中']})
  self.assertEqual(len(x),2);self.assertEqual(x[0]['guard'][0]['actor'],1);self.assertEqual(x[0]['effects'][0]['actor'],2);self.assertEqual(x[1]['inherits'],x[0]['scenario_id']);self.assertEqual(x[1]['guard'],x[0]['guard'])
 def test_reference_without_premise_is_unknown(self):
  x,u=v3.branches('その場合、青木(1番車)が差す。',{1:['青木']});self.assertEqual(x,[]);self.assertEqual(u,1)
 def test_opponent_profile_is_not_an_asserted_action(self):
  x,u=v3.branches('捲り主体の青木(1番車)が相手なら、木村(2番車)が先行する。',{1:['青木'],2:['木村']});self.assertEqual(x[0]['guard_type'],'opponent_profile')
 def test_avoiding_a_lead_fight_is_negative(self):
  x,u=v3.branches('青木(1番車)が先行争いを避けたとしても、木村(2番車)は捲りを決める。',{1:['青木'],2:['木村']});self.assertTrue(x[0]['guard'][0]['negated'])
 def test_all_B_candidates_and_probability_mass(self):
  model,r,features=self.setup_fixture();triples,score,contribution,cars,back=v3.probabilities(model,r,features)
  self.assertEqual(len(triples),60);self.assertEqual(len(cars),5);self.assertAlmostEqual(score.sum(),1.);self.assertAlmostEqual(back.sum(),1.);self.assertTrue(np.allclose(contribution.sum(axis=0),score))
 def test_current_results_do_not_enter_inference(self):
  model,r,f=self.setup_fixture();a=v3.infer(model,r,f);r['labels']={'back':[5],'finish':{'5':1},'tickets':[],'events':[]};self.assertEqual(a,v3.infer(model,r,f))
 def test_each_ticket_has_a_modeled_scenario_and_exact_budget(self):
  m,r,f=self.setup_fixture();p=v3.infer(m,r,f);ids={s['scenario_id'] for s in p['scenarios']};self.assertTrue(all(t['scenario_id'] in ids for t in p['tickets']));self.assertEqual(sum(t['yen'] for t in p['tickets']),10000)

if __name__=='__main__':unittest.main()
