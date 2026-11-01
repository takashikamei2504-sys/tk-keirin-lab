import unittest,sys,datetime as dt
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from collect_recent import parse_profile,robots_allowed,UTC
HEADERS=['1着','2着','3着','着外','棄権','失格','総出走回数','勝率','2連対率','3連対率','ホーム回数','バック回数','競走得点']
def fixture():
 values=['5回','6回','3回','10回','2回','1回','26回','19.2%','42.3%','53.8%','3回','4回','115.75']
 return '<table><tr><td>阿部　拓真</td><td id="PlayerNo">015035</td></tr></table><div>近況成績</div><p>2026/11/01 02:38&nbsp;更新</p><p>■直近4ヶ月成績</p><table><tr>'+''.join('<td>'+s+'</td>' for s in HEADERS)+'</tr><tr>'+''.join('<td><p>'+s+'</p></td>' for s in values)+'</tr></table><p>■最近の成績</p><table class="seiseki_kobetsu"><tr><td>10/17</td><td><a>閣Ｇ３</a></td></tr><tr><td><p title="3"></p></td><td><p title="落車棄権"></p></td></tr></table><p>■出場予定</p><table><td>999回</td></table>'
class RecentCollectorTests(unittest.TestCase):
 def parse(self,s):return parse_profile(s,'015035','阿部拓真',dt.datetime(2026,11,1,1,tzinfo=UTC))
 def test_identity_and_recent_only(self):
  p=self.parse(fixture());self.assertEqual(p['stats']['total'],26);self.assertEqual(p['stats']['b'],4);self.assertEqual(p['recent_meetings'][0]['finishes'],['3','落車棄権']);self.assertEqual(p['recent_meetings'][0]['date'],'2026-10-17')
 def test_current_meeting_results_only_completed(self):
  block='<p>■開催中のレース <a>防府Ｇ３</a></p><table><tr><td>10/31</td><td>11/01</td></tr><tr><td>一予選/11R</td><td><p title="3"></p><p class="imgbadge_s4_B">B</p></td><td>映像</td><td>二予選/12R</td><td>-</td><td>-</td></tr></table>'
  p=self.parse(fixture().replace('<p>■最近の成績</p>',block+'<p>■最近の成績</p>'))
  self.assertEqual(len(p['current_meeting_results']),1);self.assertEqual(p['current_meeting_results'][0]['finish'],'3');self.assertTrue(p['current_meeting_results'][0]['b']);self.assertEqual(p['current_meeting_results'][0]['date'],'2026-10-31')
 def test_wrong_identity(self):
  with self.assertRaisesRegex(ValueError,'name mismatch'):self.parse(fixture().replace('阿部　拓真','清水裕友'))
 def test_changed_layout(self):
  with self.assertRaisesRegex(ValueError,'headers changed'):self.parse(fixture().replace('バック回数','バック数'))
 def test_missing_number_not_zero(self):
  with self.assertRaisesRegex(ValueError,'missing numeric'):self.parse(fixture().replace('4回','—'))
 def test_bad_rate(self):
  with self.assertRaisesRegex(ValueError,'disagree'):self.parse(fixture().replace('19.2%','22.2%'))
 def test_robot_longest_match(self):
  robots='User-agent: *\nDisallow:/\nAllow:/pc/racerprofile\nAllow:/pc/top'
  self.assertTrue(robots_allowed(robots,'https://www.keirin.jp/pc/racerprofile?snum=015035'));self.assertFalse(robots_allowed(robots,'https://www.keirin.jp/private'))
if __name__=='__main__':unittest.main()
