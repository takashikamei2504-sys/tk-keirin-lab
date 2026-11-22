"""Public entry parser; no teacher marks or result fields enter inference."""
import datetime,hashlib,re,unicodedata
from html.parser import HTMLParser
class Tables(HTMLParser):
 def __init__(self):super().__init__();self.rows=[];self.row=None;self.cell=None
 def handle_starttag(self,t,a):
  if t=='tr':self.row=[]
  if t in ('td','th') and self.row is not None:self.cell=[]
 def handle_data(self,d):
  if self.cell is not None:self.cell.append(d)
 def handle_endtag(self,t):
  if t in ('td','th') and self.cell is not None:self.row.append(' '.join(''.join(self.cell).split()));self.cell=None
  if t=='tr' and self.row is not None:self.rows.append(self.row);self.row=None

def plain(s):p=Tables();p.feed('<table><tr><td>'+s+'</td></tr></table>');return p.rows[0][0]
def number(s):
 m=re.search(r'-?\d+(?:\.\d+)?',unicodedata.normalize('NFKC',s));return float(m[0]) if m else None

def parse_entry(h,rid):
 players={}
 for b in re.findall(r'<tr class="PlayerList"[^>]*>(.*?)</tr>',h,re.S):
  p=Tables();p.feed('<table><tr>'+b+'</tr></table>')
  if not p.rows or len(p.rows[0])<23:continue
  row=p.rows[0];car=number(row[1]);identity=re.search(r'id="names_(\d+)_'+rid+r'"',b)
  if car is None or not identity:continue
  c=int(car);style=next((x for x in ['逃','両','追'] if x in row[6]),None)
  players[str(c)]={'rider_id':identity[1],'score':number(row[5]),'style':style,'S':number(row[7]),'H':number(row[8]),'B':number(row[9]),'nige':number(row[10]),'makuri':number(row[11]),'sashi':number(row[12]),'mark':number(row[13]),'wins':number(row[14]),'seconds':number(row[15]),'thirds':number(row[16]),'out':number(row[17]),'win_rate':number(row[18]),'top2_rate':number(row[19]),'top3_rate':number(row[20]),'gear':number(row[21]),'comment':row[22]}
 section=re.search(r'<section class="[^"]*DeployYoso[^"]*"[^>]*>(.*?)</section>',h,re.S);lines=[];line=[]
 if section:
  for cls,val in re.findall(r'<span class="([^"]*)"[^>]*>(.*?)</span>',section[1],re.S):
   if 'WakuSeparat' in cls:
    if line:lines.append(line);line=[]
   elif 'Shaban_Num' in cls:
    v=plain(val)
    if v.isdigit():line.append(int(v))
  if line:lines.append(line)
 m=re.search(r'<title>(.*?)</title>',h,re.S)
 name=re.search(r'<div class="Race_Name"[^>]*>(.*?)</div>',h,re.S)
 course=re.search(r'<div class="Change_Btn Course[^\"]*"[^>]*>(.*?)</div>',h,re.S)
 count=re.search(r'<span class="DayCount"[^>]*>(.*?)</span>',course[1],re.S) if course else None
 return {'parser_version':2,'players':players,'lines':lines,'title':plain(m[1]) if m else '', 'race_class':plain(name[1]) if name else None,'meeting_day':plain(count[1]) if count else None,'status':'received' if 5<=len(players)<=9 else 'parse_incomplete'}


def serving_card(html,rid):
 if not re.fullmatch(r"\d{12}",rid):raise ValueError('Invalid race ID')
 url='https://keirin.netkeiba.com/race/entry/?race_id='+rid
 canonical=re.search(r'<link rel="canonical" href="([^"]+)"',html)
 if not canonical or canonical[1]!=url:raise ValueError('Entry identity mismatch')
 card=parse_entry(html,rid)
 title=card['title'];venue=re.match(r'(.+?)競輪',title)
 day=datetime.datetime.strptime(rid[:8],'%Y%m%d')
 if not venue or day.strftime('%Y年%m月%d日') not in title or not re.search(r'(?<!\d)'+str(int(rid[-2:]))+r'R(?!\w)',title):raise ValueError('Entry title mismatch')
 if not card['race_class'] or not re.search('Ｓ級|Ａ級|S級|A級',card['race_class']) or re.search('ガールズ|Ｌ級|L級',card['race_class']):raise ValueError('Unsupported race class')
 # Reject duplicate rows before dictionary parsing could silently overwrite them.
 rows=re.findall(r'<tr class="PlayerList"[^>]*>(.*?)</tr>',html,re.S)
 if len(rows)!=len(card['players']):raise ValueError('Missing or duplicate entry rows')
 ids=[p['rider_id'] for p in card['players'].values()];cars=sorted(map(int,card['players']))
 if len(cars) not in (7,9) or len(ids)!=len(set(ids)):raise ValueError('Invalid rider roster')
 known=[c for line in card['lines'] for c in line]
 if not card['lines'] or sorted(known)!=cars:raise ValueError('Missing, duplicate or unconfirmed lineup')
 names={}
 for b in rows:
  p=Tables();p.feed('<table><tr>'+b+'</tr></table>');row=p.rows[0];names[str(int(number(row[1])))]=row[2]
 if any(p['score'] is None or p['style'] is None for p in card['players'].values()):raise ValueError('Incomplete score/style')
 schedule=re.search(r'<div class="Race_Data"[^>]*>(.*?)</div>',html,re.S)
 times=re.search(r'発走\s*(\d{2}:\d{2})\s*締切\s*(\d{2}:\d{2})',plain(schedule[1]) if schedule else '')
 if not times:raise ValueError('Schedule unavailable')
 date=day.strftime('%Y-%m-%d');start=date+'T'+times[1]+':00+09:00';close=date+'T'+times[2]+':00+09:00'
 if datetime.datetime.fromisoformat(close)>=datetime.datetime.fromisoformat(start):raise ValueError('Invalid sales close')
 r={'race_id':rid,'date':rid[:8],'venue':int(rid[8:10]),'race_no':int(rid[-2:]),'roster':cars,'lines':card['lines'],'unknown_cars':[],'names':names,'entry':card}
 return r,{'venue_name':venue[1],'race_no':int(rid[-2:]),'start_at':start,'sales_close_at':close,'source_url':url,'source_sha256':hashlib.sha256(html.encode()).hexdigest()}
