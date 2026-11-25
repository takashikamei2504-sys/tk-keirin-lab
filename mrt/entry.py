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


class PendingLineup(ValueError):
 def __init__(self,meta,reason='Lineup not yet published'):
  super().__init__(reason);self.meta=meta

def fallback_lines(feed,meta,players,date,observed_at):
 # Import only explicit ordered line positions, never other provider features,
 # predictions or outcomes. Match date, venue, race, time and every rider ID.
 if not isinstance(feed,dict) or feed.get('date')!=date:raise ValueError('Fallback date mismatch')
 generated=datetime.datetime.fromisoformat(feed.get('generated_at',''))
 if generated.utcoffset() is None or generated>observed_at or observed_at-generated>datetime.timedelta(hours=6):raise ValueError('Fallback timestamp stale or invalid')
 races=feed.get('races')
 if not isinstance(races,list) or len(races)>250:raise ValueError('Fallback race list invalid')
 matches=[r for r in races if r.get('venue')==meta['venue_name'] and r.get('race_number')==meta['race_no']]
 if len(matches)!=1:raise ValueError('Fallback race identity mismatch')
 race=matches[0]
 if race.get('is_girls') is not False or race.get('start_time')!=meta['start_at'][11:16]:raise ValueError('Fallback schedule or class mismatch')
 entries=race.get('entries')
 if not isinstance(entries,list) or len(entries)!=len(players):raise ValueError('Fallback field mismatch')
 seen=set();groups={}
 for rider in entries:
  c=str(rider.get('car_number',''))
  if c in seen or c not in players or str(rider.get('rider_id',''))!=str(players[c]['rider_id']):raise ValueError('Fallback rider identity mismatch')
  seen.add(c)
  m=re.fullmatch(r'([1-9]|1[0-2])-([1-9])',str(rider.get('line_position') or ''))
  if not m:raise ValueError('Fallback lineup not yet published')
  g,o=map(int,m.groups());groups.setdefault(g,[]).append((o,int(c)))
 if seen!=set(players):raise ValueError('Fallback roster incomplete')
 lines=[]
 for g,items in sorted(groups.items()):
  items.sort()
  if [o for o,c in items]!=list(range(1,len(items)+1)):raise ValueError('Fallback lineup order invalid')
  lines.append([c for o,c in items])
 if sorted(c for l in lines for c in l)!=sorted(map(int,players)):raise ValueError('Fallback lineup incomplete')
 return lines,generated.isoformat()

def serving_card(html,rid,lineup_feed=None,observed_at=None):
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
 if card['lines'] and sorted(known)!=cars:raise ValueError('Missing, duplicate or unconfirmed lineup')
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
 meta={'venue_name':venue[1],'race_no':int(rid[-2:]),'start_at':start,'sales_close_at':close,'source_url':url,'source_sha256':hashlib.sha256(html.encode()).hexdigest()}
 if not card['lines']:
  pending={**meta,'race_class':card['race_class'],'field_size':len(cars)}
  if lineup_feed is None:raise PendingLineup(pending)
  try:
   lines,generated=fallback_lines(lineup_feed,meta,card['players'],date,observed_at or datetime.datetime.now(datetime.timezone.utc))
  except (ValueError,TypeError,KeyError,AttributeError) as exc:raise PendingLineup(pending,'Lineup not yet published; fallback: '+str(exc)) from exc
  card['lines']=lines;r['lines']=lines
  meta.update(lineup_source='public_day_feed',lineup_source_url='https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/'+date+'.json',lineup_source_generated_at=generated,lineup_source_sha256=hashlib.sha256(__import__('json').dumps(lineup_feed,sort_keys=True,ensure_ascii=False).encode()).hexdigest())
 return r,meta
