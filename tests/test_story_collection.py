import copy, datetime as dt, json, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import collect_race_material as collector

class StoryCollectionTests(unittest.TestCase):
 def setUp(self):
  self.card={'date':'2026-11-03','venue':'防府','race_no':1,'collected_at':'2026-11-02T00:00:00Z','source_url':'https://keirin.tokyo-sports.co.jp/list/race/20261102_1','riders':[{'name':'甲野一郎','family':'甲野','no':1,'rank':'S1'},{'name':'乙川二郎','family':'乙川','no':2,'rank':'S1'},{'name':'丙山三郎','family':'丙山','no':3,'rank':'S2'}]}
 def note(self,text,card=None):return collector.comment_entry({'rider':'甲野一郎','text':text,'attribution':'選手見出し'},card or self.card)
 def test_direct_follower_and_solo(self):
  for text in ['乙川さんの後ろ。','乙川二郎君の番手。','乙川君に任せます。','乙川君へ。']:
   self.assertEqual(self.note(text)['follow_no'],2,text)
  self.assertEqual(self.note('乙川さんの後ろ。')['follow_position'],'immediate')
  self.assertEqual(self.note('単騎で。')['lineup_intention'],'solo')
  self.assertEqual(self.note('乙川君にジカ。')['lineup_intention'],'compete')
  self.assertEqual(self.note('乙川君にジカ。')['follow_no'],2)
 def test_ambiguous_conditional_past(self):
  card=copy.deepcopy(self.card);card['riders'][2].update(name='乙川三郎',family='乙川')
  self.assertNotIn('follow_no',self.note('乙川さんの後ろ。',card))
  for text in ['昨日は乙川さんの後ろ。','よければ乙川君へ。','乙川君には行かない。']:
   self.assertNotIn('follow_no',self.note(text))
 def test_current_statement_survives_long_prior_review(self):
  text='前回は内を締められず反省。'*8+'乙川さんの後ろ。'
  note=self.note(text);self.assertEqual(note['follow_no'],2);self.assertEqual(note['declaration'],'乙川さんの後ろ')
  self.assertFalse(self.note('先行を考えていますが'+'あ'*60+'先行はしない')['declaration_complete'])
 def test_cached_card_still_discovers_new_related_race(self):
  now=dt.datetime.now(dt.timezone.utc).isoformat();cached={**self.card,'collected_at':now,'id':'cached','parser_version':collector.PARSER_VERSION,'related_urls':['https://keirin.tokyo-sports.co.jp/list/race/20261102_2'],'comments':[]}
  requested=[]
  class Fetch:
   def get(_,url):
    requested.append(url)
    if url==collector.INDEX:return '<a href="'+cached['source_url']+'">race</a>'
    if url==cached['related_urls'][0]:return 'new card'
    raise AssertionError('A cached card should not be downloaded again: '+url)
  def parse(_,url,collected):return {**self.card,'collected_at':collected,'race_no':2,'source_url':url,'quotes':[],'related_urls':[],'parser_version':collector.PARSER_VERSION}
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);(root/'data').mkdir()
   for name,value in [('s_riders',{'riders':[]}),('intelligence',{'relationships':[]}),('race_material',{'cards':[cached]})]:(root/'data'/f'{name}.json').write_text(json.dumps(value))
   with patch.object(collector,'ROOT',root),patch.object(collector,'Fetcher',Fetch),patch.object(collector,'parse_card',parse):collector.collect(1,5)
   result=json.loads((root/'data/race_material.json').read_text())
   self.assertIn(cached['related_urls'][0],requested);self.assertNotIn(cached['source_url'],requested);self.assertEqual(len(result['cards']),2)
 def test_upcoming_s_class_seeds_precede_finished_races(self):
  links=collector.discover_races('<a href="/list/race/20261101_1">GⅢ 防府 終了</a><a href="/list/race/20261101_2">FⅡ 熊本 09:00発走</a><a href="/list/race/20261101_3">FⅠ 弥彦 11:00発走</a><a href="https://example.org/list/race/20261101_4">GⅢ 11:00発走</a>')
  self.assertEqual([u.rsplit('_',1)[1] for u in links],['3','2','1'])

if __name__=='__main__':unittest.main()
