import datetime as dt,pathlib,sys,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT));sys.path.insert(0,str(ROOT/'mrt/engine'))
from mrt.entry import serving_card
from mrt.publish import freeze,identity
from mrt.results import parse_result
class PipelineContracts(unittest.TestCase):
 def input(self):
  players={str(c):{'rider_id':str(100+c),'score':80.,'style':'逃' if c in [1,4,6] else '追'} for c in range(1,8)}
  return {'race_id':'202611234201','date':'20261123','venue':42,'race_no':1,'roster':list(range(1,8)),'lines':[[1,2,3],[4,5],[6,7]],'unknown_cars':[],'names':{str(c):str(c) for c in range(1,8)},'entry':{'players':players}}
 def test_freeze_rejects_late_and_training_dates(self):
  r=self.input();meta={'start_at':'2026-11-23T16:05:00+09:00','sales_close_at':'2026-11-23T16:00:00+09:00'};close=dt.datetime.fromisoformat(meta['sales_close_at'])
  with self.assertRaises(ValueError):freeze(r,meta,{'history_through':'20261121'},close)
  with self.assertRaises(ValueError):freeze(r,meta,{'history_through':'20261123'},close-dt.timedelta(minutes=5))
  with patch('mrt.publish.tool.options',return_value={}),patch('mrt.publish.now',return_value=close):
   with self.assertRaises(ValueError):freeze(r,meta,{'history_through':'20261121'},close-dt.timedelta(minutes=5))
 def test_input_identity_changes(self):
  r=self.input();meta={'start_at':'x','sales_close_at':'y'};a=identity(r,meta);r['lines'][0]=[2,1,3];self.assertNotEqual(a,identity(r,meta));r=self.input();r['entry']['players']['1']['rider_id']='999';self.assertNotEqual(a,identity(r,meta))
 def test_no_unconfirmed_entry(self):
  with self.assertRaises(ValueError):serving_card('<title>nothing</title>','202611234201')
 def result(self):
  rows=''.join('<tr class="PlayerList">'+''.join('<td>'+v+'</td>' for v in [str(c)+'着','',str(c),'<a href="https://keirin.netkeiba.com/db/profile/?id='+str(100+c)+'">選手</a>','','','逃','B' if c==1 else ''])+'</tr>' for c in range(1,8))
  return '<link rel="canonical" href="https://keirin.netkeiba.com/race/result/?race_id=202611234201"><p>レースが確定しました</p><div class="Race_Data">発走 16:05 締切 16:00</div><table id="All_Result_Table">'+rows+'</table><tr class="Tan3"><td class="Result">1&gt;2&gt;3</td><td class="Payout">1,500円</td></tr>'
 def test_result_requires_same_riders_and_schedule(self):
  p={'race_id':'202611234201','start_at':'2026-11-23T16:05:00+09:00','input':self.input()};h=self.result();r=parse_result(h,p);self.assertEqual(r['payouts'],{'1-2-3':1500});self.assertEqual(r['back'],[1])
  with self.assertRaises(ValueError):parse_result(h.replace('id=101','id=999'),p)
  with self.assertRaises(ValueError):parse_result(h.replace('発走 16:05','発走 16:15'),p)
  with self.assertRaises(ValueError):parse_result(h.replace('7着','欠'),p)
  self.assertEqual(parse_result(h.replace('レースが確定しました','レース前'),p)['status'],'pending')
if __name__=='__main__':unittest.main()
