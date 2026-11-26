import copy
from datetime import datetime,timedelta
from hashlib import sha256
from itertools import permutations
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from mrt.odds import POLICY,QUERY,matrix,parse,plan,run,stamp,validate_original,verified_names,write

URL='https://keirin.kdreams.jp/hakodate/racedetail/1120261126010001/?pageType=showResult'
AT=stamp('2026-11-26T12:00:00+09:00')
def original(n=7):
    r={'race_id':'202611261101','date':'20261126','roster':list(range(1,n+1)),
       'names':{str(i):'選手'+str(i) for i in range(1,n+1)},'lines':[list(range(1,n+1))],
       'entry':{'players':{str(i):{'rider_id':str(10000+i)} for i in range(1,n+1)}}}
    p={'race_id':r['race_id'],'input':r,'venue_name':'函館','race_no':1,'pre_race':True,
       'entry_observed_at':'2026-11-26T09:59:00+09:00','generated_at':'2026-11-26T10:00:00+09:00',
       'sales_close_at':'2026-11-26T12:55:00+09:00','start_at':'2026-11-26T13:00:00+09:00'}
    p['identity_sha256']=sha256(json.dumps({'race_id':p['race_id'],'roster':{c:v['rider_id'] for c,v in r['entry']['players'].items()},'lines':r['lines'],'start':p['start_at'],'close':p['sales_close_at']},sort_keys=True).encode()).hexdigest()
    return p

def market(cars):
    body=[];pairs=[]
    for a in cars:
        cols=[b for b in cars if b!=a]
        table=f'<table class="odds_table bt5"><tr><th class="n{a}" colspan="8"><span class="number">{a}</span><span class="name">選手{a}</span></th></tr>'
        table+='<tr>'+''.join(f'<th class="n{b}">{b}</th>' for b in cols)+'</tr>'
        table+='<tr>'+''.join(f'<td class="rider n{b}">選手{b}<br>県</td>' for b in cols)+'</tr>'
        for c in cols:
            table+=f'<tr><th class="n{c}">{c}</th>'
            for b in cols:
                if b==c:table+='<td class="empty"> </td>'
                else:
                    v=f'{a}{b}.{c}';table+='<td>'+v+'</td>';pairs.append(f'<span class="num">{a}-{b}-{c}</span><span class="odds">{v}</span>')
            table+=f'<th class="n{c}">{c}</th></tr>'
        body.append(table+'</table>')
    return '<div id="JS_ODDSCONTENTS_3rentan">'+''.join(body)+''.join(pairs)+'<!-- 3連単 End -->'

def page(n=7,final=False):
    return '<title>函館競輪 1R | 2026年11月26日</title><dt class="start">発走予定</dt><dd>13:00</dd><dt class="bet">投票締切</dt><dd>12:55</dd>'+('<span class="icon_confirmed">確定オッズ</span>' if final else '')+'<div id="JS_ODDSSTATUS_3rentan"><p class="time">2026/11/26 11:59現在</p></div>'+market(range(1,n+1))

def micro(p):
    tickets=[{'cars':q,'yen':v} for q,v in [([1,2,3],4000),([1,3,2],3000),([2,1,3],2000),([3,1,2],1000)]]
    return {'race_id':p['race_id'],'identity_sha256':p['identity_sha256'],'roster':validate_original(p),
        'frozen':True,'pre_race':True,'original_generated_at':p['generated_at'],'generated_at':'2026-11-26T10:30:00+09:00',
        'sales_close_at':p['sales_close_at'],'protocol_id':'fixed-test','methods':{'D_hybrid':tickets}}

class OddsTests(unittest.TestCase):
    def test_legacy_names_require_independent_rider_id_match(self):
        p=original();p['input']['names']={k:'-- ◎ ◯' for k in p['input']['names']}
        before=copy.deepcopy(p)
        feed={'date':'2026-11-26','generated_at':'2026-11-26T11:00:00+09:00','races':[{'race_id':p['race_id'],'venue':p['venue_name'],'start_time':'13:00','entries':[{'car_number':i,'rider_id':str(10000+i),'rider_full_name':'選手'+str(i)} for i in range(1,8)]}]}
        resolved=verified_names(p,feed,AT);self.assertEqual(resolved['input']['names']['1'],'選手1');self.assertEqual(p,before)
        feed['races'][0]['entries'][0]['rider_id']='wrong'
        with self.assertRaisesRegex(ValueError,'roster'):verified_names(p,feed,AT)

    def test_real_primary_source_layout_and_orientation(self):
        fixture=(Path(__file__).resolve().parents[1]/'fixtures/mrt-trifecta.html').read_text()
        names={'1':'藤田 周磨','2':'吉川 希望','3':'山田 敦也','4':'池野 健太','5':'吉田 茂生','6':'太刀川 一成','7':'橋本 智昭'}
        q=matrix(fixture,{'input':{'roster':list(range(1,8)),'names':names}})
        self.assertEqual(len(q),210);self.assertEqual(q['1-4-6'],24.2);self.assertEqual(q['1-6-4'],25.9)

    def test_complete_seven_and_nine_car_markets(self):
        for n in (7,9):
            q=parse(page(n),URL.removesuffix('?pageType=showResult')+QUERY,original(n),AT)
            self.assertEqual(len(q['odds']),n*(n-1)*(n-2));self.assertEqual(q['odds']['1-2-3'],12.3);self.assertEqual(q['odds']['1-3-2'],13.2)

    def test_rejects_final_missing_duplicate_and_changed_roster(self):
        p=original();url=URL.removesuffix('?pageType=showResult')+QUERY
        for markup in (page(final=True),page().replace('<td>12.3</td>','<td>-</td>',1),page().replace('選手4','別選手4'),page().replace('11:59現在','11:00現在'),page().replace('13:00','13:01',1),page().replace('<span class="num">1-2-3','<span class="num">1-2-4',1)):
            with self.subTest(markup=markup[:80]),self.assertRaises(ValueError):parse(markup,url,p,AT)
        with self.assertRaises(ValueError):parse(page(),url,p,stamp(p['sales_close_at']))

    def test_no_gami_floor_uses_reduced_total_and_preserves_amounts(self):
        p=original();s=micro(p);q=parse(page(),URL.removesuffix('?pageType=showResult')+QUERY,p,AT)
        q['odds'].update({'1-2-3':2.,'1-3-2':4.,'2-1-3':10.,'3-1-2':30.})
        out=plan(q,s,AT);self.assertEqual(out['stake_yen'],6000);self.assertEqual(len(out['tickets']),3)
        self.assertEqual(out['minimum_protected_return_yen'],9600)
        self.assertEqual([x['yen'] for x in out['tickets']],[3000,2000,1000])
        q['odds']={k:1. for k in q['odds']};self.assertEqual(plan(q,s,AT)['status'],'skip')

    def test_plan_rejects_stale_final_mismatched_and_incomplete_quotes(self):
        p=original();s=micro(p);q=parse(page(),URL.removesuffix('?pageType=showResult')+QUERY,p,AT)
        for change in ({'state':'final'},{'identity_sha256':'other'},{'pool':'provider'},{'roster':{}},{'odds':{}}):
            with self.subTest(change=change),self.assertRaises(ValueError):plan({**q,**change},s,AT)
        with self.assertRaisesRegex(ValueError,'stale'):plan(q,s,AT+timedelta(minutes=21))
        with self.assertRaises(ValueError):plan(q,{**s,'generated_at':(AT+timedelta(minutes=1)).isoformat()},AT)
        fresh={**q,'published_at':'2026-11-26T12:52:00+09:00','captured_at':'2026-11-26T12:52:00+09:00'}
        with self.assertRaisesRegex(ValueError,'close'):plan(fresh,s,stamp(p['sales_close_at'])-timedelta(seconds=60))

    def seed(self,root):
        p=original();day='2026-11-26';file=p['race_id']+'-original.json'
        write(root/'data/mrt'/day/file,p)
        write(root/'data/mrt'/day/'index.json',{'races':[{'race_id':p['race_id'],'file':file,'status':'ready','identity_sha256':p['identity_sha256']}]})
        write(root/'data/mrt_research/micro_forward/snapshots'/(p['race_id']+'.json'),micro(p))
        return p

    def test_periodic_collection_is_immutable_and_does_not_rewrite_micro(self):
        with TemporaryDirectory() as directory:
            root=Path(directory);p=self.seed(root);calls=[]
            before=(root/'data/mrt_research/micro_forward/snapshots'/(p['race_id']+'.json')).read_bytes()
            get=lambda url:(calls.append(url) or page())
            opts={'get':get,'discover':lambda:{p['race_id']:URL}}
            a=run(root,clock=lambda:AT,**opts);self.assertEqual(a['counts']['quotes_saved'],1)
            b=run(root,clock=lambda:AT+timedelta(minutes=1),**opts);self.assertEqual(b['counts']['recently_captured'],1);self.assertEqual(len(calls),1)
            run(root,clock=lambda:AT+timedelta(minutes=11),**opts)
            self.assertEqual(len(list((root/'data/mrt_odds/snapshots').rglob('*.json'))),2)
            self.assertEqual(before,(root/'data/mrt_research/micro_forward/snapshots'/(p['race_id']+'.json')).read_bytes())

    def test_source_denial_stops_without_alternate_routes(self):
        with TemporaryDirectory() as directory:
            root=Path(directory);p=self.seed(root);calls=[]
            def get(url):calls.append(url);raise PermissionError('source_access_blocked_403')
            status=run(root,clock=lambda:AT,get=get,discover=lambda:{p['race_id']:URL})
            self.assertEqual(status['state'],'source_access_blocked');self.assertEqual(len(calls),1)
            self.assertFalse((root/'data/mrt_odds/latest').exists())

if __name__=='__main__':unittest.main()
