import datetime as dt
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from collect_intel import Page
from rider_knowledge import extract_knowledge, TOPICS
from build_rider_dossiers import build

NOW=dt.datetime(2026,11,2,tzinfo=dt.timezone.utc)
class KnowledgeTests(unittest.TestCase):
 def test_negative_plan_retained_without_numeric_trait(self):
  q={'rider':'郡司浩平','text':'次はカマシを決めたい。追走できなかった。フレームを換えて練習した。','attribution':'verified speaker'}
  rows=extract_knowledge(Page(),[q],['郡司浩平'],'https://example.org/article',NOW,NOW,'fixture')
  self.assertEqual({t for n in rows for t in n['topics']},{'kamashi','tracking','equipment','training'})
  self.assertTrue(all(n['numeric'] is False and 'value' not in n for n in rows))
  self.assertTrue(any('できなかった' in n['excerpt'] for n in rows))
 def test_ambiguous_reporter_subject_and_budget(self):
  p=Page();p.blocks=[('p','郡司浩平と太田海也は練習した。'),('p','郡司浩平は太田君が追走できなかったと話した。')]
  self.assertEqual(extract_knowledge(p,[],['郡司浩平','太田海也'],'https://example.org/a',NOW,NOW,'fixture'),[])
  q={'rider':'郡司浩平','text':('練習をして状態を確かめた。'*40),'attribution':'verified'}
  rows=extract_knowledge(Page(),[q],['郡司浩平'],'https://example.org/a',NOW,NOW,'fixture')
  self.assertLessEqual(sum(len(n['excerpt']) for n in rows),160)
  self.assertEqual(len(rows),1)
 def test_identity_cutoff_duplicate_and_missing_coverage(self):
  roster={'riders':[{'rider_id':'001234','name':'郡司浩平'},{'rider_id':'001235','name':'太田海也'}]}
  n={'rider':'郡司浩平','excerpt':'追走できなかった','body_verified':True,'url':'https://example.org/a','published_at':NOW.isoformat(),'collected_at':NOW.isoformat()}
  bad=[{**n,'id':'wrong-id','rider_id':'999999'},{**n,'id':'future','collected_at':'2099-01-01T00:00:00+00:00'},{**n,'id':'unverified','body_verified':False}]
  p=build(roster,{}, {'knowledge':[n,n]+bad},{},now=NOW)
  self.assertEqual(len(p['riders'][0]['notes']),1)
  self.assertEqual(p['coverage']['article_notes'],1)
  self.assertEqual(p['riders'][1]['missing_topics'],sorted(TOPICS))
  again=build(roster,{}, {'knowledge':[n]}, {},previous=p,now=NOW)
  self.assertEqual(again['riders'][0]['notes'],p['riders'][0]['notes'])
 def test_name_collision_is_not_resolved_by_guessing(self):
  roster={'riders':[{'rider_id':'001234','name':'同姓同名'},{'rider_id':'001235','name':'同姓同名'}]}
  note={'rider':'同姓同名','excerpt':'練習した','body_verified':True,'url':'https://example.org/a','published_at':NOW.isoformat(),'collected_at':NOW.isoformat()}
  self.assertEqual(build(roster,{}, {'knowledge':[note]}, {},now=NOW)['coverage']['article_notes'],0)

if __name__=='__main__':unittest.main()
