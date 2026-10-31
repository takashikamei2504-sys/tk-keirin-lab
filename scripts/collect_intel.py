#!/usr/bin/env python3
"""Bounded public-article body collector, no paid APIs or manual personality entry.
Only explicit named-subject observations are extracted. Search titles/snippets are
never evidence. Unknown dates, future articles and inaccessible bodies are skipped.
"""
import argparse, datetime as dt, hashlib, json, re, time, urllib.request, urllib.parse, urllib.robotparser
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UTC = dt.timezone.utc
AGENT = 'TKKeirinLab/1.4 (public article research; bounded requests)'
HOSTS = {'keirin.tokyo-sports.co.jp', 'keirinsponichi.jp', 'keirin.netkeiba.com', 'keirin.jp', 'www.keirin.jp'}
INDEXES = ['https://keirin.tokyo-sports.co.jp/', 'https://keirinsponichi.jp/', 'https://keirin.netkeiba.com/news/news_list.html']
RULES = {
 'front': [(r'前受け|前を取|正攻法', .85)],
 'resist': [(r'突っ張|ツッパリ', .9)],
 'withdraw': [(r'引いて|一旦引|いったん引|下げて|引き切', .85)],
 'kamashi': [(r'カマシ|かまし|カマして|かまして|叩いて先行', .9)],
 'makuri': [(r'捲り|まくり|捲って|まくって', .85)],
 'track': [(r'離れた|離れて|追走できず|千切れ|ちぎれ', .1), (r'追走でき|追走成功|食らい付|食らいつ', .85)],
 'seat': [(r'番手にはま|番手にハマ|番手に収ま|飛び付|飛びつ', .9)],
 'recover': [(r'自力に転じ|自力に切り替|立て直して|再度仕掛|再自力', .9)],
 'finish': [(r'差し切|差し脚|追い込んで|追い込みで', .85)],
 'outer': [(r'大外|外を強襲|外強襲', .9)]}

class Page(HTMLParser):
 def __init__(self):
  super().__init__(); self.links=[]; self.meta={}; self.blocks=[]; self.stack=[]; self.parts=[]; self.active=0; self.skip=0; self.jsonld=[]; self.ld=False; self.ldparts=[]
 def handle_starttag(self, tag, attrs):
  a=dict(attrs); self.stack.append(tag)
  if tag in ('script','style','nav','header','footer','aside'): self.skip+=1
  if tag=='script' and a.get('type')=='application/ld+json': self.ld=True; self.ldparts=[]
  if tag=='a' and a.get('href'): self.links.append(a['href'])
  if tag=='meta': self.meta[a.get('property') or a.get('name') or '']=a.get('content','')
  if tag=='time' and a.get('datetime'): self.meta.setdefault('article:published_time',a['datetime'])
  if tag in ('p','h1','h2') and not self.skip: self.active+=1; self.parts=[]
 def handle_endtag(self, tag):
  if tag=='script' and self.ld:
   try: self.jsonld.append(json.loads(''.join(self.ldparts)))
   except (ValueError,TypeError): pass
   self.ld=False
  if tag in ('p','h1','h2') and self.active:
   text=re.sub(r'\s+',' ',''.join(self.parts)).strip()
   if text: self.blocks.append((tag,text))
   self.active-=1; self.parts=[]
  if tag in ('script','style','nav','header','footer','aside'): self.skip=max(0,self.skip-1)
 def handle_data(self, data):
  if self.ld: self.ldparts.append(data)
  if self.active and not self.skip: self.parts.append(data)

def iso(value):
 try:
  s=str(value).strip().replace('Z','+00:00')
  # Date-only is conservatively the end of that day in JST.
  if re.fullmatch(r'\d{4}-\d{2}-\d{2}',s): s+='T23:59:59+09:00'
  d=dt.datetime.fromisoformat(s)
  if d.tzinfo is None: d=d.replace(tzinfo=dt.timezone(dt.timedelta(hours=9)))
  return d.astimezone(UTC)
 except (ValueError,TypeError): return None

def published(page):
 candidates=[page.meta.get('article:published_time'), page.meta.get('datePublished'),page.meta.get('pubdate')]
 def walk(o):
  if isinstance(o,dict):
   if o.get('datePublished'): candidates.append(o['datePublished'])
   for v in o.values(): walk(v)
  elif isinstance(o,list):
   for v in o: walk(v)
 for o in page.jsonld: walk(o)
 return next((d for s in candidates if (d:=iso(s))),None)

class Fetcher:
 def __init__(self): self.robots={}; self.errors=[]; self.last={}
 def raw(self,url):
  req=urllib.request.Request(url,headers={'User-Agent':AGENT})
  with urllib.request.urlopen(req,timeout=12) as res:
   final=urllib.parse.urlparse(res.url)
   original=urllib.parse.urlparse(url)
   if final.hostname!=original.hostname: raise ValueError('cross-host redirect skipped')
   body=res.read(2_000_001)
   if len(body)>2_000_000: raise ValueError('body too large')
   charset=res.headers.get_content_charset()
   if not charset:
    m=re.search(br'charset=["\s]*([\w-]+)',body[:5000],re.I); charset=m.group(1).decode() if m else 'utf-8'
   return body.decode(charset,errors='replace')
 def get(self,url):
  host=urllib.parse.urlparse(url).hostname
  if host not in HOSTS: raise ValueError('host not allowed')
  if host not in self.robots:
   rp=urllib.robotparser.RobotFileParser()
   try: rp.parse(self.raw('https://'+host+'/robots.txt').splitlines())
   except Exception: rp=None
   self.robots[host]=rp
  rp=self.robots[host]
  if rp is None or not rp.can_fetch(AGENT,url): raise ValueError('robots unavailable or disallowed')
  delay=max(1.0,float(rp.crawl_delay(AGENT) or 0))
  time.sleep(max(0,delay-(time.monotonic()-self.last.get(host,0))))
  try: return self.raw(url)
  finally: self.last[host]=time.monotonic()

def article_url(url):
 p=urllib.parse.urlparse(url)
 return p.hostname in HOSTS and (bool(re.search(r'/articles/-/\d+',p.path)) or ('news_detail' in p.path and 'id=' in p.query) or '/chumoku_race/' in p.path or '/keirin_news/' in p.path or bool(re.search(r'/report.+/report_\d+\.html',p.path)))

def extract(page, names, url, date, collected):
 rows=[]; title=next((s for t,s in page.blocks if t=='h1'),page.meta.get('og:title',''))
 for tag,text in page.blocks:
  if tag!='p': continue
  # Full names are required; ambiguous quoted speakers and co-mentioned opponents are skipped.
  compact=re.sub(r'[\s\u3000]','',text)
  for sentence in re.split(r'[。！？]',compact):
   contained=[n for n in names if n in sentence]
   if len(contained)!=1: continue
   rider=contained[0]; tail=sentence.split(rider,1)[1]
   if not tail or len(tail)>350 or re.search(r'だろう|ならば|すれば|狙い目|とみた|予想|かもしれ|と思う',tail): continue
   # Subject switches introduced by a second name/surname are deliberately not inferred.
   if re.search(r'[一-龥々]{2,}(?:君|選手|さん|が|は)',tail): continue
   for trait,rules in RULES.items():
    for pattern,value in rules:
     match=re.search(pattern,tail)
     if not match: continue
     window=tail[max(0,match.start()-8):match.end()+16]
     if re.search(r'できな|しなかった|せず|られず|れなか|したくな|ない|厳しい|失敗|つもり|予定|たい|れば',window): continue
     identity=hashlib.sha256(f'{url}|{rider}|{trait}|{sentence}'.encode()).hexdigest()[:20]
     rows.append(dict(id=identity,rider=rider,trait=trait,value=value,confidence=.6,
       url=url,title=title[:120],excerpt=sentence[:110],condition='単一局面の観察。恒常的な性格と断定しない',
       published_at=date.isoformat(),collected_at=collected.isoformat(),body_verified=True,extractor='explicit-subject-rules-v1.4'))
     break
 return rows

def roster(now,errors):
 names=set(); dates=[]
 for off in (0,1):
  day=(now.astimezone(dt.timezone(dt.timedelta(hours=9)))+dt.timedelta(days=off)).date().isoformat()
  try:
   req=urllib.request.Request('https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/'+day+'.json',headers={'User-Agent':AGENT})
   with urllib.request.urlopen(req,timeout=12) as res: payload=json.load(res)
   if payload.get('date')!=day: raise ValueError('date mismatch')
   for race in payload.get('races',[]):
    for e in race.get('entries',[]):
     name=re.sub(r'\s','',str(e.get('rider_full_name') or e.get('rider_name') or ''))
     if name: names.add(name)
   dates.append(day)
  except Exception as exc: errors.append({'stage':'roster','date':day,'error':str(exc)[:160]})
 # Existing bundled race names are automatic fallback discovery, never manual traits.
 html=(ROOT/'v13.html').read_text()
 names.update(re.sub(r'\s','',n) for n in re.findall(r'"name"\s*:\s*"([^"\n]+)"',html) if 2<=len(n)<=12 and re.fullmatch(r'[一-龥ぁ-んァ-ヶー々\s]+',n))
 return sorted(names),dates

def main():
 ap=argparse.ArgumentParser(); ap.add_argument('--max-articles',type=int,default=36); args=ap.parse_args()
 now=dt.datetime.now(UTC); output=ROOT/'data/intelligence.json'; previous=json.loads(output.read_text()) if output.exists() else {}
 fetch=Fetcher(); errors=[]; names,dates=roster(now,errors); links=[]
 for index in INDEXES:
  try:
   page=Page(); page.feed(fetch.get(index))
   links.extend(urllib.parse.urljoin(index,u).split('#')[0] for u in page.links)
  except Exception as exc: errors.append({'url':index,'error':str(exc)[:160]})
 links.extend(re.findall(r'https://[^\s\"\'<>]+', (ROOT/'v13.html').read_text()))
 # Revisit known article URLs on subsequent runs only when not already successfully fetched.
 roster_hash=hashlib.sha256('|'.join(names).encode()).hexdigest()[:16]
 cache=previous.get('articles',[]); known={a['url'] for a in cache if a.get('body_verified') and a.get('roster_hash')==roster_hash}
 evidence={e['id']:e for e in previous.get('evidence',[]) if iso(e.get('published_at')) and (now-iso(e['published_at'])).days<1095}
 articles={a['url']:a for a in cache}; attempted=0
 for url in dict.fromkeys(u for u in links if article_url(u)):
  if url in known: continue
  if attempted>=max(1,min(args.max_articles,60)): break
  attempted+=1
  try:
   page=Page(); page.feed(fetch.get(url)); date=published(page)
   if date is None: raise ValueError('publication date unknown; not used')
   if date>now: raise ValueError('future publication; not used')
   if not any(t=='p' and len(s)>30 for t,s in page.blocks): raise ValueError('article body missing')
   collected=dt.datetime.now(UTC)
   rows=extract(page,names,url,date,collected)
   for e in rows: evidence.setdefault(e['id'],e)
   articles[url]={'url':url,'published_at':date.isoformat(),'collected_at':collected.isoformat(),'body_verified':True,'evidence_count':len(rows),'roster_hash':roster_hash}
  except Exception as exc: errors.append({'url':url,'error':str(exc)[:160]})
 result={'schema':'tk-keirin-intelligence/v1.4','generated_at':now.isoformat(),'roster_dates':dates,'roster_size':len(names),'evidence':list(evidence.values()),'articles':list(articles.values())[-500:],
  'status':{'attempted':attempted,'body_articles':len(articles),'evidence':len(evidence),'errors':errors[-50:]},'notice':'公開記事本文の明示的な選手主語のみ自動抽出。未校正・誤読の可能性あり。取得日時と公開日時より前の予想へは適用しない。'}
 output.parent.mkdir(exist_ok=True); tmp=output.with_suffix('.tmp'); tmp.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n'); tmp.replace(output)
 print(json.dumps({'roster':len(names),'articles':len(articles),'evidence':len(evidence),'attempted':attempted,'errors':len(errors)},ensure_ascii=False))
 if not articles and not evidence: raise SystemExit('No article bodies available; inspect data/intelligence.json status')
if __name__=='__main__': main()
