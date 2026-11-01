import unittest,sys,datetime as dt
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from s_roster import parse_search,validate_membership,coverage,search_url
from collect_recent import robots_allowed,UTC,Fetcher
from unittest.mock import patch,Mock

def page(page_no,total,rows):
 return f'<input name="kyuhanCD" value="11,12,13,15"><input name="seibetuCD" value="1"><input name="stgt" value="1"><input name="dppg" value="{page_no}"><span id="UNQ_orlabel_2">{total}</span>件見つかりました。'+''.join(f'<span id="j_idt25:{i}:UNQ_orlabel_8">{name}</span><span id="j_idt25:{i}:UNQ_orlabel_9">{rid}</span><span id="j_idt25:{i}:UNQ_orlabel_10">{grade}</span>' for i,(rid,name,grade) in enumerate(rows))
class SRosterTests(unittest.TestCase):
 def test_membership_not_entries(self):
  total,rs=parse_search(page(1,2,[('014089','浅井 康太','S級1班'),('015035','阿部拓真','S級S班')]),1)
  self.assertEqual(total,2);self.assertEqual(rs[0]['name'],'浅井康太');self.assertEqual(rs[1]['class_rank'],'SS');validate_membership(rs,2)
 def test_filters_must_be_echoed(self):
  with self.assertRaisesRegex(ValueError,'filters not preserved'):parse_search(page(1,1,[('014089','浅井康太','S級1班')]).replace('value="11,12,13,15"','value="11"'),1)
 def test_incomplete_page(self):
  with self.assertRaisesRegex(ValueError,'incomplete'):parse_search(page(1,12,[('014089','浅井康太','S級1班')]),1)
 def test_wrong_page(self):
  with self.assertRaises(ValueError):parse_search(page(2,1,[('014089','浅井康太','S級1班')]),1)
 def test_duplicate_or_wrong_class(self):
  r={'rider_id':'014089','class_rank':'S1'}
  with self.assertRaises(ValueError):validate_membership([r,r],2)
  with self.assertRaises(ValueError):parse_search(page(1,1,[('014089','浅井康太','A級1班')]),1)
 def test_coverage_requires_identity_and_freshness(self):
  now=dt.datetime(2026,11,1,2,tzinfo=UTC)
  manifest={'complete':True,'generated_at':now.isoformat(),'riders':[{'rider_id':'014089','name':'浅井康太','class_rank':'S1'},{'rider_id':'015035','name':'阿部拓真','class_rank':'SS'}]}
  snaps=[{'rider_id':'014089','name':'浅井康太','verified_identity':True,'collected_at':'2026-11-01T01:00:00+00:00','source_updated_at':'2026-11-01T00:00:00+00:00'},{'rider_id':'015035','name':'別人','verified_identity':True,'collected_at':'2026-11-01T01:00:00+00:00','source_updated_at':'2026-11-01T00:00:00+00:00'}]
  result=coverage(manifest,snaps,now);self.assertEqual(result['covered'],1);self.assertEqual(result['fresh'],1);self.assertEqual(result['missing'][0]['rider_id'],'015035')
 def test_transient_fetch_retries_once(self):
  f=Fetcher(delay=0);f.robots='User-agent: *\nAllow:/';f.raw=Mock(side_effect=[TimeoutError('temporary'), 'ok'])
  with patch('collect_recent.time.sleep'):self.assertEqual(f.get(search_url()),'ok')
  self.assertEqual(f.raw.call_count,2)
 def test_public_search_allowed_by_prefix(self):
  self.assertTrue(robots_allowed('User-agent: *\nDisallow:/\nAllow:/sp/racersearch',search_url()))
if __name__=='__main__':unittest.main()
