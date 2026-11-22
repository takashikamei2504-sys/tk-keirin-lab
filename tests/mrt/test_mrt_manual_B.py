import sys,pathlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/"mrt/engine"))
import copy, unittest
import numpy as np
import mrt_logic_v3 as v3
from test_mrt_logic_v3 import V3Contracts

class ManualBContracts(unittest.TestCase):
 def setUp(self):self.m,self.r,self.f=V3Contracts().setup_fixture()
 def test_leader_condition_and_exact_budget(self):
  original=copy.deepcopy(self.r)
  triples,p,contrib,cars,b=v3.probabilities(self.m,self.r,self.f,'4-5')
  self.assertEqual(dict(zip(cars,b)),{1:0.,2:0.,3:0.,4:1.,5:0.})
  self.assertAlmostEqual(p.sum(),1.)
  self.assertTrue(np.allclose(contrib.sum(axis=0),p))
  out=v3.infer(self.m,self.r,self.f,2300,'4-5')
  self.assertEqual(sum(t['yen'] for t in out['tickets']),2300)
  self.assertEqual({t['scenario_id'] for t in out['tickets']},{'B4'})
  self.assertEqual(self.r,original)
  self.assertIn('手動Bライン4-5',out['commentary'])
  # B leader can lose: conditioning never filters the finishing combinations.
  self.assertTrue(any(t[0]!=4 and score>0 for t,score in zip(triples,p)))
 def test_members_preserve_relative_weights(self):
  s=v3.resolve_B_selection(self.r,[4,5],'members')
  b=v3.apply_B_selection([1,2,3,4,5],np.array([.1,.1,.2,.2,.4]),s)
  self.assertTrue(np.allclose(b,[0,0,0,1/3,2/3]))
  p=v3.infer(self.m,self.r,self.f,10000,[4,5],'members')
  self.assertEqual({s['proposed_B_holder'] for s in p['scenarios']},{4,5})
 def test_invalid_or_unconfirmed_line(self):
  for line in ['5-4','4','1-4','4-4','',[],[True,2],[4.,5],{'4':5}]:
   with self.subTest(line=line),self.assertRaises(ValueError):v3.infer(self.m,self.r,self.f,10000,line)
  self.assertEqual(v3.resolve_B_selection(self.r,'４－５')['line'],[4,5])
 def test_bad_budget_and_mode(self):
  for budget in [0,99,150,True,100.]:
   with self.assertRaises(ValueError):v3.infer(self.m,self.r,self.f,budget,[4,5])
  with self.assertRaises(ValueError):v3.infer(self.m,self.r,self.f,10000,[4,5],'bad')
 def test_auto_default_unchanged(self):
  a=v3.infer(self.m,self.r,self.f)
  self.assertEqual(a,v3.infer(self.m,self.r,self.f,10000,None,'leader'))
  self.assertEqual(a['B_selection']['mode'],'automatic')

if __name__=='__main__':unittest.main()
