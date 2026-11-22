import sys,pathlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/"mrt/engine"))
import copy
import unittest
import numpy as np
from mrt_logic_engine import parse_tickets, allocate, race_features, rider_features, make_features, validate_input

class LogicContracts(unittest.TestCase):
 def test_ticket_annotation_is_not_a_stake_or_input(self):
  t,e=parse_tickets([['3連単通常','1＞2＞3 500円 的中 99,999円']])
  self.assertFalse(e);self.assertEqual(t['3連単'][(1,2,3)],500)
 def test_formations_and_boxes_expand_without_repeated_cars(self):
  t,e=parse_tickets([['3連単フォーメーション','1着 1 2着 23 3着 123 2通り 各1,000円'],['3連単ボックス','123 6通り 各100円']])
  self.assertFalse(e);self.assertEqual(len(t['3連単']),6);self.assertEqual(sum(t['3連単'].values()),2600)
 def test_allocation_exact_budget(self):
  for n in [1,3,19,100]:
   a=allocate(np.arange(n)+1,10000);self.assertEqual(sum(a),10000);self.assertTrue(all(v>=100 and v%100==0 for v in a))
 def race(self,date='20261122'):
  return {'date':date,'race_id':date+'0101','venue':1,'race_no':1,'lines':[[1,2,3],[4,5]],'names':{str(c):str(c)+'選手' for c in range(1,6)}}
 def test_current_labels_do_not_change_features(self):
  r=self.race();a=(race_features(r),rider_features(r,{}));r['labels']={'honmei':5,'tickets':{'3連単':[{'cars':[5,4,3],'yen':10000}]},'finish':{'5':1},'payout':999999}
  self.assertEqual(a,(race_features(r),rider_features(r,{})))
 def test_same_day_history_is_frozen(self):
  a=self.race('20261120');a['labels']={'finish':{'1':1},'back':[1],'scores_after_race':{'1':100}}
  b=copy.deepcopy(a);b['race_id']='202611200102';c=copy.deepcopy(a);c['date']='20261121'
  f,h=make_features([a,b,c]);self.assertEqual(f[0][1][1],f[1][1][1]);self.assertEqual(f[2][1][1][6],2);self.assertEqual(f[2][1][1][12],100)
 def test_input_blocks_teacher_keys_and_historical_replay(self):
  r=self.race();h={'through_date':'20261121'};validate_input(r,h)
  r['honmei']=1
  with self.assertRaises(ValueError):validate_input(r,h)
  with self.assertRaises(ValueError):validate_input(self.race('20261120'),h)

if __name__=='__main__':unittest.main()
