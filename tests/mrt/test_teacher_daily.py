import copy,datetime as dt,json,pathlib,sys,tempfile,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from mrt import teacher_daily as daily
from mrt.teacher_parse import measured_result,reference,NotPublic
DATE='2026-11-22';RID='202611224201';FID='b999_634';AT=dt.datetime(2026,11,22,16,tzinfo=dt.timezone.utc)
def result_html(rid=RID,pending=False):
 rows=''.join('<tr class="PlayerList">'+''.join('<td>'+v+'</td>' for v in [str(c)+'着','',str(c),'<a href="https://keirin.netkeiba.com/db/profile/?id='+str(100+c)+'">選手'+str(c)+'</a>','','12.0','逃' if c==1 else '','B' if c==1 else ''])+'</tr>' for c in range(1,6))
 return '<link rel="canonical" href="https://keirin.netkeiba.com/race/result/?race_id='+rid+'">'+('' if pending else '<p>レースが確定しました</p>')+'<table id="All_Result_Table">'+rows+'</table><table><tr><th>３連単</th><td>1&gt;2&gt;3</td><td>1,500円</td></tr></table>'
def detail_html(locked=False):
 return '<title>【Mr.Tの競輪眼】静岡競輪 2026年11月22日 1R 競輪予想</title><link rel="canonical" href="https://keirin.netkeiba.com/yoso/detail/?id='+FID+'"><input id="hide_yosoka_id" value="634"><input id="hide_yosoka_name" value="Mr.Tの競輪眼"><a href="/race/result/?race_id='+RID+'">結果</a>'+('' if locked else '<div class="YosoKenkaiTxt">選手1（1番車）が先行した場合、選手2（2番車）が差す。</div><table class="YosoShirushiTable01"><tr><td><span class="Num Waku1">1</span><dt class="PlayerName">選手1</dt><span class="Icon_Honmei"></span></td><td class="RaceCardCell01">85.5</td></tr></table><section class="DeployYoso"><span class="Shaban_Num">1</span><span class="Shaban_Num">2</span><span class="Shaban_Num">3</span><span class="WakuSeparat"></span><span class="Shaban_Num">4</span><span class="Shaban_Num">5</span></section><table class="YosoKaimeTable01"><tr><th>3連単通常</th><td>1&gt;2&gt;3 500円</td></tr><tr><th>3連単通常</th><td>1&gt;3&gt;2 500円</td></tr><tr><th>合計</th><td>1,000円</td></tr></table><table class="YosoRefundTable01"><tr><th>払い戻し金額</th><td>7,500円</td></tr><tr><th>収支</th><td>6,500円</td></tr></table><table id="All_Result_Table">'+''.join('<tr><td>'+str(c)+'</td><td></td><td>'+str(c)+'</td><td>選手'+str(c)+'</td></tr>' for c in range(1,6))+'</table>')
class FakeFetcher:
 def __init__(self):self.calls=[];self.locked=False;self.pending=False;self.empty=False;self.fail=False;self.ids=[FID]
 def request(self,url,data=None):
  self.calls.append((url,data))
  if self.fail:raise daily.Pause('Access boundary: HTTP 429')
  if 'api_race_list.html' in url:return '<li id="btn_jyoname_42"></li>'+''.join('<a href="/race/entry/?race_id=20261122420'+str(n)+'"><span>発走 '+time+'</span></a>' for n,time in [(1,'14:00'),(2,'23:30')])
  if 'api_get_goods_list_prof' in url:return json.dumps('<div class="YosoList">'+('' if self.empty else ''.join('<a href="/yoso/detail/?id='+fid+'">予想</a>' for fid in self.ids))+'</div>')
  if '/yoso/detail/' in url:return detail_html(self.locked)
  if '/race/result/' in url:return result_html(url[-12:],self.pending and url.endswith('02'))
  raise AssertionError(url)
class TeacherDaily(unittest.TestCase):
 def test_public_reference_contract(self):
  m=measured_result(result_html(),RID);r=reference(detail_html(),FID,'20261122',m)
  self.assertEqual(r['labels']['teacher_payout'],7500);self.assertEqual(r['labels']['charged_stake'],1000);self.assertEqual(r['labels']['back'],[1]);self.assertTrue(r['labels']['events']);self.assertFalse(r['allowed_as_current_race_input']);self.assertNotIn('explanation',r);self.assertEqual(r['explanation_chars'],len('選手1（1番車）が先行した場合、選手2（2番車）が差す。'))
 def test_refund_is_not_double_counted_as_payout(self):
  h=detail_html().replace('<tr><th>合計</th>','<tr><th>3連単通常</th><td>1&gt;2&gt;5 200円</td></tr><tr><th>合計</th>').replace('<tr><td>5</td><td></td><td>5</td>','<tr><td>欠</td><td></td><td>5</td>')
  result=result_html().replace('5着','欠');r=reference(h,FID,'20261122',measured_result(result,RID));self.assertEqual(r['labels']['refund'],200);self.assertEqual(r['labels']['gross_stake'],1200);self.assertEqual(r['labels']['charged_stake'],1000);self.assertEqual(r['labels']['teacher_payout'],7500)
 def test_wrong_expert_date_result_rejected(self):
  m=measured_result(result_html(),RID)
  for h in [detail_html().replace('value="634"','value="635"'),detail_html().replace('2026年11月22日','2026年11月21日'),detail_html().replace('7,500円','7,600円')]:
   with self.assertRaises(ValueError):reference(h,FID,'20261122',m)
  bad=copy.deepcopy(m);bad['finish_rows'][0][0]='2着'
  with self.assertRaises(ValueError):reference(detail_html(),FID,'20261122',bad)
  with self.assertRaises(NotPublic):reference(detail_html(True),FID,'20261122',m)
 def test_no_fetch_before_national_day_end(self):
  f=FakeFetcher()
  with tempfile.TemporaryDirectory() as tmp,patch.object(daily,'now',return_value=AT.replace(hour=3)):
   d=daily.collect_day(f,pathlib.Path(tmp),DATE);self.assertEqual(d['state'],'waiting_day_end');self.assertFalse(any('yoso/' in u for u,_ in f.calls));self.assertFalse(list(pathlib.Path(tmp).rglob('b*_634.json')))
 def test_unconfirmed_last_result_blocks_publication_fetch(self):
  f=FakeFetcher();f.pending=True
  with tempfile.TemporaryDirectory() as tmp,patch.object(daily,'now',return_value=AT):
   d=daily.collect_day(f,pathlib.Path(tmp),DATE);self.assertEqual(d['state'],'waiting_day_end');self.assertEqual(d['day_end_gate']['pending_race_ids'],['202611224202']);self.assertFalse(any('yoso/' in u for u,_ in f.calls))
 def test_daily_pairing_and_no_duplicate_overwrite(self):
  f=FakeFetcher()
  with tempfile.TemporaryDirectory() as tmp,patch.object(daily,'now',return_value=AT):
   root=pathlib.Path(tmp);d=daily.collect_day(f,root,DATE);self.assertEqual(d['state'],'up_to_date');p=root/'records'/(FID+'.json');before=p.read_bytes();f.calls=[];daily.collect_day(f,root,DATE);self.assertEqual(p.read_bytes(),before);self.assertFalse(any('/yoso/detail/' in u for u,_ in f.calls));self.assertEqual(len(list((root/'records').glob('*.json'))),1)
 def test_late_publication_is_retried(self):
  f=FakeFetcher();f.locked=True
  with tempfile.TemporaryDirectory() as tmp,patch.object(daily,'now',return_value=AT):
   root=pathlib.Path(tmp);d=daily.collect_day(f,root,DATE);self.assertEqual(d['pending'][FID]['state'],'waiting_publication');f.locked=False;d=daily.collect_day(f,root,DATE);self.assertEqual(d['paired'],[FID])
 def test_empty_listing_is_not_a_false_complete_day(self):
  f=FakeFetcher();f.empty=True
  with tempfile.TemporaryDirectory() as tmp,patch.object(daily,'now',return_value=AT):
   d=daily.collect_day(f,pathlib.Path(tmp),DATE);self.assertEqual(d['state'],'no_public_forecasts_observed')
 def test_access_boundary_persists_pause(self):
  f=FakeFetcher();f.fail=True
  with tempfile.TemporaryDirectory() as tmp,patch.object(daily,'now',return_value=AT):
   root=pathlib.Path(tmp);s=daily.run(root,DATE,1,f);self.assertTrue(s['paused']);self.assertEqual(s['days'][0]['state'],'paused')
 def test_known_pending_older_than_window_remains_queued(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);daily.write(root/'days'/(DATE+'.json'),{'date':DATE,'pending':{FID:{'state':'waiting_publication'}}});seen=[]
   def collect(fetch,root,date):
    seen.append(date);r={'date':date,'state':'up_to_date','forecast_ids':[],'paired':[],'pending':{},'errors':[]};daily.write(root/'days'/(date+'.json'),r);return r
   with patch.object(daily,'now',return_value=dt.datetime(2026,12,3,0,tzinfo=dt.timezone.utc)),patch.object(daily,'collect_day',side_effect=collect):daily.run(root,lookback=7,fetch=FakeFetcher())
   self.assertIn(DATE,seen);self.assertEqual(len(seen),8);self.assertNotIn('2026-12-03',seen)
 def test_finished_schedule_links_are_also_parsed(self):
  html='<a href="/race/result/?race_id=202611224201"><span>発走 14:00</span></a><a href="/race/entry/?race_id=202611224202"><span>発走 23:30</span></a>'
  ids,rows=daily.schedule_rows(html,DATE);self.assertEqual(set(rows),ids);self.assertEqual(rows['202611224201']['start_at'],'2026-11-22T14:00:00+09:00')
 def test_partial_schedule_and_other_expert_rejected(self):
  f=FakeFetcher();f.ids=['b999_635']
  with self.assertRaises(ValueError):daily.listing(f,DATE)
  with tempfile.TemporaryDirectory() as tmp,patch.object(daily,'now',return_value=AT):
   with self.assertRaises(ValueError):daily.run(pathlib.Path(tmp),'2026-11-21',1,f)
if __name__=='__main__':unittest.main()
