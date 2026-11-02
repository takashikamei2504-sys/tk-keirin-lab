import unittest,sys,datetime as dt
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from collect_intel import Page,extract,extract_quotes,action_context,merge_evidence
class ActionContextTests(unittest.TestCase):
 def rows(self,text):
  p=Page();p.blocks=[('p',text)]
  return extract(p,['町田太我','清水裕友'],'https://keirin.jp/article',dt.datetime(2026,10,1,tzinfo=dt.timezone.utc),dt.datetime(2026,10,2,tzinfo=dt.timezone.utc))
 def test_observed_phase(self):
  rows=self.rows('町田太我が最終ホームから捲って前団をとらえた。')
  self.assertTrue(rows);self.assertTrue(all(x['context']=={'phase':'最終ホーム'} for x in rows));self.assertTrue(all(x['context_schema']=='tk-action-context/v1' for x in rows))
 def test_following_acceleration(self):
  rows=self.rows('清水裕友が番手でカマシに追走できた。')
  self.assertEqual({x['trait'] for x in rows},{'track'});track=next(x for x in rows if x['trait']=='track');self.assertEqual(track['context'],{'role':'follower','attack_type':'kamashi'})
 def test_no_context_invention(self):
  self.assertEqual(action_context('捲って勝った','makuri'),{})
  self.assertIsNone(action_context('ホームから捲って直線で差し切った','makuri'))
  self.assertEqual(self.rows('町田太我が最終ホームから捲って直線で差し切った。'),[])
 def test_attribution_and_plans(self):
  for text in ['町田太我と清水裕友が最終ホームから捲った。','町田太我が最終ホームから捲りたい。','清水裕友が番手でカマシに追走できなかった。']:
   self.assertEqual(self.rows(text),[])
 def test_reparse_keeps_new_observation_time(self):
  old={'id':'x','url':'https://keirin.jp/article','collected_at':'2026-01-01T00:00:00Z'}
  new={**old,'collected_at':'2026-10-02T00:00:00Z','context_schema':'tk-action-context/v1','context':{'phase':'最終ホーム'}}
  self.assertEqual(merge_evidence({'x':old},old['url'],[new])['x']['collected_at'],new['collected_at'])
  self.assertEqual(merge_evidence({'x':old},old['url'],[]),{})
  self.assertEqual(merge_evidence({'x':new},old['url'],[{**new,'collected_at':'2026-10-03T00:00:00Z'}])['x']['collected_at'],new['collected_at'])
 def test_quote_context(self):
  rows=extract_quotes([{'rider':'町田太我','text':'僕は最終ホームから捲って勝ちました。','attribution':'named quote'}],['町田太我'],'https://keirin.jp/article',dt.datetime(2026,10,1,tzinfo=dt.timezone.utc),dt.datetime(2026,10,2,tzinfo=dt.timezone.utc))
  self.assertTrue(rows);self.assertTrue(all(x['context']=={'phase':'最終ホーム'} for x in rows))
if __name__=='__main__':unittest.main()
