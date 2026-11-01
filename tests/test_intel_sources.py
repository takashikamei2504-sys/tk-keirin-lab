import unittest,sys,datetime as dt,urllib.error
from pathlib import Path
from unittest.mock import patch,Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from collect_intel import Page,published,extract_quotes,fair_urls,Fetcher
from intel_sources import adapt,observations,article_kind,canonical
ODDS='https://blog.oddspark.com/interview/2026/03/post-380.html'
KD='https://keirin.kdreams.jp/hofu/pickupracer/6320261031/'
NOW=dt.datetime(2026,11,1,tzinfo=dt.timezone.utc)
class SourcesTests(unittest.TestCase):
 def prepare(self,html,url,names):
  p=Page();p.feed(html);qs=adapt(p,html,url,names);return p,qs
 def test_odds_speaker_scope_and_date(self):
  html='<p>2020/01/01</p><div id="entryTitle">テスト｜郡司 浩平選手</div><div id="entryBody"><p>記者：捲りましたか？</p><p>郡司：僕は捲りで勝ちました。</p><p>吉田：カマシを決めました。</p></div><div id="entryFooterDate">2026/03/17</div>'
  p,qs=self.prepare(html,ODDS,['郡司浩平','吉田拓矢']);self.assertEqual(len(qs),1);self.assertEqual(qs[0]['rider'],'郡司浩平');self.assertEqual(published(p).day,17)
  rows=extract_quotes(qs,['郡司浩平','吉田拓矢'],ODDS,published(p),NOW);self.assertEqual([r['trait'] for r in rows],['makuri'])
 def test_kdreams_heading_name_and_quotes(self):
  html='<p class="kaisai-detail_contents-header-note">2026年10月30日時点の記事です。</p><div class="interview_section"><div class="column cf"><h5 class="racer">太田 海也<span>【岡山/121期/S1】</span></h5><p class="title">記者の捲り予想</p><p class="text">次はカマシを決めたいです。状態は良いです。</p></div><div class="column"><h5 class="racer">別の選手</h5><p class="text">前回は捲りました。</p></div></div>'
  p,qs=self.prepare(html,KD,['太田海也']);self.assertEqual(len(qs),1);self.assertEqual(published(p).month,10);self.assertEqual(extract_quotes(qs,['太田海也'],KD,published(p),NOW),[])
  notes=observations(qs,KD,'記事',published(p),NOW);self.assertEqual(len(notes),1);self.assertEqual(notes[0]['kind'],'interview_comment')
 def test_opponent_and_hypothetical_not_traits(self):
  qs=[{'rider':'太田海也','text':text,'attribution':'fixture'} for text in ['郡司さんが捲りました。','次はカマシを決めたいです。','突っ張れなかった。','捲ってもらいました。','僕は突っ張る作戦も考えたが、後ろから組み立てました。','結果的に飛びつかれる形にはなりませんでした。','その時は英斗も捲りに行きました。']]
  self.assertEqual(extract_quotes(qs,['太田海也','郡司浩平'],KD,NOW,NOW),[])
 def test_marche_article_date_ignores_related_items(self):
  html='<time datetime="2020-01-01"></time><div class="article interview"><h1>太田海也選手</h1><p class="date_publicArticle">2026.10.28</p><div id="article_top"><p>僕は前回、捲りで勝ちました。</p></div></div><p>太田海也がカマシを決めた。</p>'
  p,qs=self.prepare(html,'https://keirin-marche.jp/enjoy/interview/introduction62/',['太田海也']);self.assertEqual(published(p).year,2026);self.assertEqual(len(qs),1);self.assertFalse(any('カマシ' in v for t,v in p.blocks))
 def test_blocked_host_is_not_requested_again(self):
  f=Fetcher();f.raw=Mock(side_effect=['User-agent: *\nAllow: /',urllib.error.HTTPError(KD,429,'rate limit',{},None)])
  with patch('collect_intel.time.sleep'):
   with self.assertRaises(urllib.error.HTTPError):f.get(KD)
   with self.assertRaisesRegex(ValueError,'paused'):f.get(KD)
  self.assertEqual(f.raw.call_count,2)
 def test_missing_scope_date_and_ambiguous_subject(self):
  with self.assertRaises(ValueError):self.prepare('<p>2026/01/01</p>',ODDS,['郡司浩平'])
  html='<div id="entryTitle">郡司浩平と吉田拓矢</div><div id="entryBody"><p>郡司：捲りました。</p></div><div id="entryFooterDate">2026/03/17</div>'
  self.assertEqual(self.prepare(html,ODDS,['郡司浩平','吉田拓矢'])[1],[])
 def test_fairness_tracking_dedup_and_article_allowlist(self):
  urls=['https://keirin.tokyo-sports.co.jp/articles/-/'+str(i) for i in range(10)]+[KD+'?l-id=one',KD+'?l-id=two',ODDS]
  queue=list(fair_urls(urls));self.assertEqual(len(queue),12);self.assertIn(KD,queue[:3]);self.assertIn(ODDS,queue[:3]);self.assertIsNone(article_kind('https://evil.test/interview/2026/03/post-380.html'));self.assertIsNone(article_kind('https://keirin.kdreams.jp/support/guide/'))
 def test_short_comment_budget(self):
  qs=[{'rider':'郡司浩平','text':'状態は良く前回は捲りで勝ちました。','attribution':'fixture'}]*8
  self.assertLessEqual(len(observations(qs,ODDS,'title',NOW,NOW)),2)
 def test_robots_missing_vs_unreachable(self):
  f=Fetcher();f.raw=Mock(side_effect=[urllib.error.HTTPError(ODDS,404,'not found',{},None),'body'])
  with patch('collect_intel.time.sleep'):self.assertEqual(f.get(ODDS),'body')
  f=Fetcher();f.raw=Mock(side_effect=TimeoutError())
  with self.assertRaisesRegex(ValueError,'robots unavailable'):f.get(ODDS)
if __name__=='__main__':unittest.main()
