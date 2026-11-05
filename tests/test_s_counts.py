import datetime as dt,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from collect_s_counts import parse_s_table,Tables
class SCountsTests(unittest.TestCase):
 def setUp(self):
  self.es=[{'rider_full_name':name,'car_number':i+1} for i,name in enumerate(['山田太郎','山本次郎','田中健','鈴木勇','佐藤翔','高橋亮','斎藤進'])]
  header='<tr><th>車番</th><th>選手</th><th>S</th><th>B</th></tr>'
  body=''.join(f'<tr><td>{i+1}</td><td><a>{e["rider_full_name"]}</a></td><td>{i}</td><td>0</td></tr>' for i,e in enumerate(self.es))
  self.html='<table>'+header+body+'</table>'
 def test_all_riders_and_zero_is_real(self):
  v=parse_s_table(self.html,self.es)
  self.assertEqual([x['s'] for x in v],list(range(7)))
 def test_wrong_name_fails(self):
  with self.assertRaisesRegex(ValueError,'complete S column'):parse_s_table(self.html.replace('斎藤進','斎藤誤'),self.es)
 def test_no_s_header_fails(self):
  with self.assertRaisesRegex(ValueError,'complete S column'):parse_s_table(self.html.replace('<th>S</th>','<th>X</th>'),self.es)
 def test_missing_value_fails(self):
  with self.assertRaisesRegex(ValueError,'complete S column'):parse_s_table(self.html.replace('<td>6</td><td>0</td>','<td>--</td><td>0</td>'),self.es)
if __name__=='__main__':unittest.main()
