import unittest, sys, datetime as dt
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from collect_intel import Page, extract, published, article_url
class CollectorTests(unittest.TestCase):
 def page(self,text):
  p=Page();p.feed('<html><meta property="article:published_time" content="2026-10-01T08:00:00+09:00"><h1>レース後コメント</h1>'+text+'</html>');return p
 def test_body_attribution(self):
  p=self.page('<nav><p>町田太我が突っ張った。</p></nav><p>町田太我が前受けから突っ張って主導権を握った。</p><p>清水裕友が大外を強襲した。</p>')
  rows=extract(p,['町田太我','清水裕友'],'https://keirin.jp/test',published(p),dt.datetime.now(dt.timezone.utc))
  self.assertEqual({r['trait'] for r in rows},{'front','resist','outer'})
  self.assertTrue(all(r['body_verified'] for r in rows))
 def test_ambiguity_and_negation(self):
  for text in ['町田太我と清水裕友が突っ張った。','町田太我が突っ張れなかった。','町田太我がカマシを決めれば勝てる。','町田太我は清水君が突っ張ったと語った。']:
   p=self.page('<p>'+text+'</p>');self.assertEqual(extract(p,['町田太我','清水裕友'],'https://keirin.jp/test',published(p),dt.datetime.now(dt.timezone.utc)),[])
 def test_unknown_date(self):
  p=Page();p.feed('<p>町田太我が突っ張った。</p>');self.assertIsNone(published(p))
 def test_url(self):
  self.assertTrue(article_url('https://keirin.tokyo-sports.co.jp/articles/-/123'))
  self.assertFalse(article_url('https://evil.example/articles/-/123'))
if __name__=='__main__':unittest.main()
