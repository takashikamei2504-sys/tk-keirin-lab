import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from collect_race_material import parse_card,relationships
class RaceMaterialTests(unittest.TestCase):
 def card(self):
  head='<meta property="og:title" content="2026年11月2日 防府競輪 12R 出走表"><meta property="article:published_time" content="2001-01-01"><p>発走：16:25</p><table class="syussou"><tr><th>直近４ヶ月の成績</th></tr><tr>'+''.join('<th>'+x+'</th>' for x in ['競走得点','決まり手','B','S','失格','重注','走注'])+'</tr><tr><th>逃</th></tr>'
  for i in range(1,8):
   cs=['',str(i),f'仮名 選手{i} 30歳 / 東京 / 110期','Ｓ2 両','105.00','1','2','3','4','5',str(i),'0','0','0','1着']
   head+='<tr>'+''.join('<td>'+x+'</td>' for x in cs)+'</tr>'
  return head+'</table><div class="race-comment__item"><div class="race-comment__name">仮名 選手1</div><div class="race-comment__txt">前回は助けてもらった。自力。</div></div>'
 def test_header_scope(self):
  p=parse_card(self.card(),'https://keirin.tokyo-sports.co.jp/list/race/20261102_1','2026-11-01T20:00:00+00:00')
  self.assertEqual(p['riders'][0]['s'],1);self.assertEqual(p['riders'][0]['b'],5)
  self.assertEqual(p['date'],'2026-11-02');self.assertIsNone(p['source_published_at']);self.assertEqual(len(p['quotes']),1)
 def test_changed_header(self):
  with self.assertRaises(ValueError):parse_card(self.card().replace('<th>S</th>','<th>不明</th>'),'https://example.org','2026-01-01T00:00:00Z')
 def test_scoped_relationship(self):
  names=['甲野一郎','乙川二郎','丙山三郎'];q={'rider':'甲野一郎','text':'乙川二郎さんが前回仕事してくれたので感謝しています。'}
  rows=relationships([q],names,'https://example.org','2026-01-01','2026-01-02');self.assertEqual(len(rows),1);self.assertEqual(rows[0]['peer'],'乙川二郎')
  self.assertFalse(relationships([{'rider':'甲野一郎','text':'乙川さんが仕事してくれた。'}],names,'https://example.org','2026-01-01','2026-01-02'))
  self.assertFalse(relationships([{'rider':'甲野一郎','text':'乙川二郎さんは仕事してくれなかった。'}],names,'https://example.org','2026-01-01','2026-01-02'))
if __name__=='__main__':unittest.main()
