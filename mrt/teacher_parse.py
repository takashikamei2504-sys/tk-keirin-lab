"""Parse public Mr.T reference labels and same-provider measured results.
Full article text is processed in memory; only structured labels and hashes are published.
"""
import datetime as dt,hashlib,json,re,sys,unicodedata,pathlib
from html.parser import HTMLParser
from .entry import Tables
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'engine'))
import mrt_logic_v3 as v3
from mrt_logic_engine import parse_tickets,cash,diag_names,payout
BASE='https://keirin.netkeiba.com'
class NotPublic(ValueError):pass
class Text(HTMLParser):
    def __init__(self): super().__init__(); self.parts=[]; self.skip=0
    def handle_starttag(self,t,a):
        if t in ('script','style'): self.skip+=1
        if t in ('tr','p','div','h2','h3','li','br'): self.parts.append('\n')
    def handle_endtag(self,t):
        if t in ('script','style'): self.skip=max(0,self.skip-1)
        if t in ('td','th'): self.parts.append(' | ')
    def handle_data(self,d):
        if not self.skip: self.parts.append(d)
    def value(self): return '\n'.join(x.strip() for x in ''.join(self.parts).splitlines() if x.strip())

def plain(fragment):
 p=Text();p.feed(fragment);return " ".join(p.value().split())

def prediction_facts(html):
    marked=[]
    table=re.search(r'<table class="YosoShirushiTable01"[^>]*>(.*?)</table>',html,re.S)
    if table:
        for block in re.findall(r'<tr[^>]*>(.*?)</tr>',table[1],re.S):
            num=re.search(r'class="Num Waku\d"[^>]*>(\d+)',block)
            name=re.search(r'<dt class="PlayerName"[^>]*>(.*?)</dt>',block,re.S)
            score=re.search(r'<td class="RaceCardCell01"[^>]*>(.*?)</td>',block,re.S)
            mark=re.search(r'Icon_(Honmei|Taikou|Kurosan|Osae|Renka)',block)
            if num:
                value=plain(score[1]) if score else ''
                marked.append(dict(car=int(num[1]),name=plain(name[1]) if name else None,mark=mark[1] if mark else None,score=float(value) if re.fullmatch(r'\d+(?:\.\d+)?',value) else None))
    diagram=re.search(r'<section class="DeployYoso"[^>]*>(.*?)</section>',html,re.S)
    lines=[];line=[]
    if diagram:
        for cls,value in re.findall(r'<span class="([^"]*)"[^>]*>(.*?)</span>',diagram[1],re.S):
            if 'WakuSeparat' in cls:
                if line:lines.append(line);line=[]
            elif 'Shaban_Num' in cls and plain(value).isdigit():line.append(int(plain(value)))
        if line:lines.append(line)
    ids=[x for line in lines for x in line]
    return dict(marked_riders=marked,published_lines=lines,line_members_unique=len(ids)==len(set(ids)),scope='Published prediction marks and diagram; marked riders may be a subset of the field. This is reference-label information, not independently verified pre-race input.')

def table(html,pattern):
 m=re.search(pattern,html,re.S)
 if not m:raise NotPublic('Required public table unavailable')
 p=Tables();p.feed('<table>'+m[1]+'</table>');return p.rows

def measured_result(html,rid):
 canonical=re.search(r'<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"',html)
 url=BASE+'/race/result/?race_id='+rid
 if not canonical or canonical[1]!=url:raise ValueError('Result identity mismatch')
 if not re.search(r'<p[^>]*>\s*レースが確定しました\s*</p>',html):
  # Do not infer cancellation from an absent result or a generic navigation label.
  messages=re.findall(r'<(?:p|h[12])\b[^>]*>(.*?)</(?:p|h[12])>',html,re.S)
  if any(re.fullmatch(r'.{0,20}(?:このレース|本レース|本日の開催|本日の全レース)(?:は|が).{0,8}(?:中止|不成立).{0,20}',plain(m)) for m in messages):
   return {'race_id':rid,'status':'cancelled','source_url':url,'source_sha256':hashlib.sha256(html.encode()).hexdigest()}
  return {'race_id':rid,'status':'pending','source_url':url}
 rows=table(html,r'<table\b[^>]*id="All_Result_Table"[^>]*>(.*?)</table>')
 finish=[r for r in rows if len(r)==8 and re.fullmatch(r'(?:[1-9]着|失|棄|欠|落)',r[0]) and re.fullmatch(r'[1-9]',r[2])]
 if not 5<=len(finish)<=9 or len({r[2] for r in finish})!=len(finish):raise ValueError('Incomplete result roster')
 raw=re.search(r'<table\b[^>]*id="All_Result_Table"[^>]*>(.*?)</table>',html,re.S)[1]
 roster={}
 for b in re.findall(r'<tr\b[^>]*class="PlayerList"[^>]*>(.*?)</tr>',raw,re.S):
  cells=re.findall(r'<td\b[^>]*>(.*?)</td>',b,re.S)
  if len(cells)!=8:continue
  c=plain(cells[2]);ident=re.search(r'/db/profile/\?id=(\d+)',cells[3])
  if c in roster or not ident:raise ValueError('Result rider identity missing or duplicated')
  roster[c]=ident[1]
 if set(roster)!=set(r[2] for r in finish) or len(set(roster.values()))!=len(roster):raise ValueError('Result rider IDs incomplete')
 all_rows=Tables();all_rows.feed(html)
 payments=[r for r in all_rows.rows if any(re.search(r'[\d,]+円',c) for c in r)]
 if not payments:raise ValueError('Published result has no payment rows')
 return {'race_id':rid,'status':'final','source_url':url,'source_sha256':hashlib.sha256(html.encode()).hexdigest(),'roster':roster,'finish_rows':finish,'payment_rows':payments,'back_cars':[int(r[2]) for r in finish if 'B' in r[7]],'start_cars':[int(r[2]) for r in finish if 'S' in r[7]],'winner_kimarite':[{'car':int(r[2]),'kimarite':r[6],'agari_time':r[5]} for r in finish if r[0]=='1着']}

def reference(html,fid,date,measured):
 if not re.fullmatch(r'b\d+_634',fid):raise ValueError('Wrong expert forecast ID')
 canonical=re.search(r'<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"',html)
 if not canonical or canonical[1]!=BASE+'/yoso/detail/?id='+fid:raise ValueError('Forecast identity mismatch')
 author=re.search(r'id="hide_yosoka_id"\s+value="(\d+)"',html)
 name=re.search(r'id="hide_yosoka_name"\s+value="([^"]+)"',html)
 if not author or author[1]!='634' or not name or name[1]!='Mr.Tの競輪眼':raise ValueError('Expert identity mismatch')
 d=dt.datetime.strptime(date,'%Y%m%d');title=re.search(r'<title>(.*?)</title>',html,re.S)
 if not title or d.strftime('%Y年%m月%d日') not in plain(title[1]) or 'Mr.Tの競輪眼' not in plain(title[1]):raise ValueError('Forecast date/title mismatch')
 ids=set(re.findall(r'race_id=('+date+r'\d{4})',html))
 if ids!={measured['race_id']}:raise ValueError('Forecast race ambiguous or mismatched')
 if measured['status']!='final':raise ValueError('Measured result not final')
 rid=measured['race_id']
 if not re.search(r'(?<!\d)'+str(int(rid[-2:]))+r'R(?!\w)',plain(title[1])):raise ValueError('Forecast race number mismatch')
 view=re.search(r'<div class="YosoKenkaiTxt"[^>]*>(.*?)</div>',html,re.S)
 ticket_rows=table(html,r'<table class="YosoKaimeTable01"[^>]*>(.*?)</table>')
 if not view or not plain(view[1]):raise NotPublic('Explanation not public yet')
 rows=[r for r in ticket_rows if r and re.match(r'(?:3連単|３連単|2車単|２車単|3連複|３連複|2車複|２車複)',r[0])]
 if not rows:raise NotPublic('Tickets not public yet')
 tickets,errors=parse_tickets(rows)
 if errors:raise ValueError('Unsupported or unparsed ticket rows')
 # The result embedded in the expert detail and the separate result page must agree.
 teacher_finish=table(html,r'<table\b[^>]*id="All_Result_Table"[^>]*>(.*?)</table>')
 teacher_finish=[r for r in teacher_finish if len(r)==4 and re.fullmatch(r'(?:[1-9]|失|棄|欠|落)',r[0]) and re.fullmatch(r'[1-9]',r[2])]
 expected=sorted((r[0].replace('着',''),r[2]) for r in measured['finish_rows'])
 if sorted((r[0],r[2]) for r in teacher_finish)!=expected:raise ValueError('Expert/result finishing orders disagree')
 roster=sorted(map(int,measured['roster']));cancelled={int(r[2]) for r in measured['finish_rows'] if r[0]=='欠'}
 if any(set(t)-set(roster) for ts in tickets.values() for t in ts):raise ValueError('Ticket outside confirmed roster')
 amounts={r[0]:cash(r[1]) for r in ticket_rows if len(r)==2 and r[0]=='合計'}
 for r in table(html,r'<table class="YosoRefundTable01"[^>]*>(.*?)</table>'):
  if len(r)==2 and r[0] in ('払い戻し金額','収支'):
   m=re.search(r'[+-]?[\d,]+',unicodedata.normalize('NFKC',r[1]));amounts[r[0]]=int(m[0].replace(',','')) if m else None
 if any(amounts.get(k) is None for k in ['合計','払い戻し金額','収支']):raise ValueError('Financial summary incomplete')
 gross=sum(v for ts in tickets.values() for v in ts.values());refund=sum(v for ts in tickets.values() for t,v in ts.items() if set(t)&cancelled)
 if gross-refund!=amounts['合計'] or amounts['払い戻し金額']-amounts['合計']!=amounts['収支']:raise ValueError('Stake/refund/profit mismatch')
 facts=prediction_facts(html);lines=facts['published_lines'];members=[c for l in lines for c in l]
 if len(members)!=len(set(members)) or set(members)-set(roster):raise ValueError('Published line membership invalid')
 marks=facts['marked_riders']
 if not marks or len({r['car'] for r in marks})!=len(marks) or any(r['car'] not in roster for r in marks):raise ValueError('Published marks invalid')
 result_names={int(r[2]):re.sub(r'\s+','',unicodedata.normalize('NFKC',r[3].split()[0])) for r in measured['finish_rows']}
 for rider in marks:
  if re.sub(r'\s+','',unicodedata.normalize('NFKC',rider['name'] or ''))!=result_names[rider['car']]:raise ValueError('Expert/result rider names disagree')
 aliases={c:[r['name'] for r in marks if r['car']==c and r['name']]+[r[3].split()[0] for r in measured['finish_rows'] if int(r[2])==c] for c in roster}
 text=plain(view[1]);events,edges,mentioned,unresolved=v3.v2.extract_events(text,aliases);branches,incomplete=v3.branches(text,aliases)
 labels={'tickets':{k:[{'cars':list(t),'yen':v} for t,v in ts.items()] for k,ts in tickets.items()},'gross_stake':gross,'charged_stake':amounts['合計'],'refund':refund,'cancelled':sorted(cancelled),'honmei':next((r['car'] for r in marks if r['mark']=='Honmei'),None),'finish':{r[2]:int(r[0].replace('着','')) for r in measured['finish_rows'] if r[0].replace('着','').isdigit()},'back':measured['back_cars'],'payments':measured['payment_rows'],'teacher_payout':amounts['払い戻し金額'],'events':events,'conditional_edges':edges,'mentioned_actors':mentioned,'unresolved_action_mentions':unresolved,'condition_scenarios':branches,'unresolved_conditions':incomplete,'scores_after_race':{str(r['car']):r['score'] for r in marks if r['score'] is not None}}
 # Charged stake is already net of refunds; published payout excludes refunded stakes.
 calculated=0
 for kind,ts in labels['tickets'].items():
  for t in ts:
   if not set(t['cars'])&cancelled:
    value=payout(t,kind,{'payments':measured['payment_rows']})
    if value is None:raise ValueError('Payout cannot be independently calculated')
    calculated+=value
 if calculated!=labels['teacher_payout']:raise ValueError('Separate result payout disagrees with teacher summary')
 return {'schema':'tk-mrt-teacher-reference/v1','expert_id':634,'expert_name':'Mr.Tの競輪眼','forecast_id':fid,'date':date,'race_id':rid,'venue':int(rid[8:10]),'race_no':int(rid[-2:]),'roster':roster,'lines':lines,'unknown_cars':sorted(set(roster)-set(members)),'names':{r[2]:r[3].split()[0] for r in measured['finish_rows']},'history_keys':measured['roster'],'prediction_facts':facts,'labels':labels,'measured_result':measured,'amounts':amounts,'source_url':BASE+'/yoso/detail/?id='+fid,'source_sha256':hashlib.sha256(html.encode()).hexdigest(),'explanation_sha256':hashlib.sha256(text.encode()).hexdigest(),'explanation_chars':len(text),'result_crosspage_verified':True,'published_at':None,'label_origin':'retrospective_public_reference','allowed_as_current_race_input':False,'full_explanation_republished':False,'extraction_version':'mrt-v3-weak-labels-1'}
