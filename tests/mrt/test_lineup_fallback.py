import copy,datetime as dt,unittest
from mrt.entry import serving_card,PendingLineup,fallback_lines
RID='202611253402'
NOW=dt.datetime.fromisoformat('2026-11-25T10:00:00+09:00')
def html(lines='',n=7,klass='Ａ級 チャレンジ一般'):
 rows=''
 for c in range(1,n+1):
  cells=['',str(c),f'<span id="names_{100+c}_{RID}">選手{c}</span>','','','75.1','逃' if c==1 else '追']+['0']*14+['3.92','自力']
  rows+='<tr class="PlayerList">'+''.join('<td>'+x+'</td>' for x in cells)+'</tr>'
 return '<link rel="canonical" href="https://keirin.netkeiba.com/race/entry/?race_id='+RID+'"><title>川崎競輪 2026年11月25日 2R 出走表</title><div class="Race_Name">'+klass+'</div><div class="Race_Data">発走 21:13 締切 21:08</div><section class="Contents_Box DeployYoso"><div>'+lines+'</div></section><table>'+rows+'</table>'
def feed():
 return {'date':'2026-11-25','generated_at':'2026-11-25T09:00:00+09:00','races':[{'venue':'川崎','race_number':2,'start_time':'21:13','is_girls':False,'entries':[{'car_number':c,'rider_id':str(100+c),'line_position':f'{1 if c<=3 else 2}-{c if c<=3 else c-3}'} for c in range(1,8)]}]}
class LineupFallback(unittest.TestCase):
 def test_primary_empty_has_identified_pending(self):
  with self.assertRaises(PendingLineup) as cm:serving_card(html(),RID)
  self.assertEqual(cm.exception.meta['venue_name'],'川崎')
  self.assertEqual(cm.exception.meta['field_size'],7)
 def test_fallback_only_imports_lines(self):
  f=feed();f['races'][0]['entries'][0]['score']=999
  r,m=serving_card(html(),RID,f,NOW)
  self.assertEqual(r['lines'],[[1,2,3],[4,5,6,7]])
  self.assertEqual(r['entry']['lines'],r['lines'])
  self.assertEqual(r['entry']['players']['1']['score'],75.1)
  self.assertEqual(m['lineup_source'],'public_day_feed')
 def test_missing_invalid_or_stale(self):
  for key,value in [('line_position',None),('line_position','1-2'),('rider_id','999')]:
   f=feed();f['races'][0]['entries'][0][key]=value
   with self.assertRaises(PendingLineup):serving_card(html(),RID,f,NOW)
  for t in ['2026-11-25T03:00:00+09:00','2026-11-25T11:00:00+09:00','2026-11-25T09:00:00']:
   f=feed();f['generated_at']=t
   with self.assertRaises(PendingLineup):serving_card(html(),RID,f,NOW)
  f=feed();f['races'][0]['start_time']='21:14'
  with self.assertRaises(PendingLineup):serving_card(html(),RID,f,NOW)
 def test_primary_precedence_and_no_relaxation(self):
  primary=''.join('<span class="Shaban_Num">'+str(c)+'</span>' for c in range(1,8))
  r,m=serving_card(html(primary),RID,{},NOW)
  self.assertEqual(r['lines'],[list(range(1,8))]);self.assertNotIn('lineup_source',m)
  with self.assertRaisesRegex(ValueError,'unconfirmed lineup'):serving_card(html(primary.replace('>7<','>6<')),RID,feed(),NOW)
  with self.assertRaisesRegex(ValueError,'Unsupported race class'):serving_card(html(klass='Ｌ級 ガールズ'),RID,feed(),NOW)
  with self.assertRaisesRegex(ValueError,'Invalid rider roster'):serving_card(html(n=5),RID,feed(),NOW)
if __name__=='__main__':unittest.main()
