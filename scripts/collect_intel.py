#!/usr/bin/env python3
"""Bounded public-article body collector, no paid APIs or manual personality entry.
Only explicit named-subject observations are extracted. Search titles/snippets are
never evidence. Unknown dates, future articles and inaccessible bodies are skipped.
"""
import argparse, datetime as dt, hashlib, json, re, time, urllib.request, urllib.parse, urllib.robotparser, urllib.error
from intel_sources import SOURCES, article_kind, discovery_url, canonical, source_id, adapt, observations
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UTC = dt.timezone.utc
AGENT = 'TKKeirinLab/1.4 (public article research; bounded requests)'
HOSTS = {urllib.parse.urlsplit(u).hostname for _,_,u in SOURCES}|{'keirin.jp','www.keirin.jp'}
INDEXES = [u for _,_,u in SOURCES]
PARSER_VERSION='public-sources-v1.7-context'
RULES = {
 'block': [(r'ブロック|けん制|牽制', .85)],
 'vertical': [(r'縦に踏|タテに踏', .85)],
 'inside': [(r'中割り|中を割|インを突|内を突', .85)],
 'long_makuri': [(r'ホームから.{0,12}(?:捲|まく)|ロング(?:捲|まく)', .85)],
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
 def __init__(self): self.robots={}; self.robot_status={}; self.blocked={}; self.errors=[]; self.last={}
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
  if host in self.blocked:raise ValueError(self.blocked[host])
  if host not in self.robots:
   rp=urllib.robotparser.RobotFileParser()
   try:
    text=self.raw('https://'+host+'/robots.txt');rp.parse(text.splitlines());self.robot_status[host]='parseable rules applied' if re.search(r'^\s*user-agent\s*:',text,re.I|re.M) else 'no parseable rules in successful robots response'
   except urllib.error.HTTPError as exc:
    if exc.code in (404,410):rp.parse([]);self.robot_status[host]='robots '+str(exc.code)+' (RFC 9309 unavailable)'
    else:rp=None;self.robot_status[host]='robots HTTP '+str(exc.code)+'; collection stopped'
   except Exception as exc:rp=None;self.robot_status[host]='robots unreachable; collection stopped'
   self.robots[host]=rp
  rp=self.robots[host]
  if rp is None or not rp.can_fetch(AGENT,url): raise ValueError('robots unavailable or disallowed')
  delay=max(1.0,float(rp.crawl_delay(AGENT) or 0))
  time.sleep(max(0,delay-(time.monotonic()-self.last.get(host,0))))
  try:return self.raw(url)
  except urllib.error.HTTPError as exc:
   if exc.code in (401,403,429):self.blocked[host]='host paused after HTTP '+str(exc.code)
   raise
  finally: self.last[host]=time.monotonic()

def article_url(url):
 p=urllib.parse.urlparse(url)
 return p.hostname in HOSTS and (article_kind(url) is not None or bool(re.search(r'/articles/-/\d+',p.path)) or ('news_detail' in p.path and 'id=' in p.query) or '/chumoku_race/' in p.path or '/keirin_news/' in p.path or bool(re.search(r'/report.+/report_\d+\.html',p.path)))

def action_context(text, trait):
 """Only explicit circumstances attached to this action; no guessed personality."""
 context={}
 phases=[('並び確認・S取り',r'S取り|スタート取り'),('赤板周回～打鐘',r'赤板|打鐘'),('最終ホーム',r'最終ホーム|ホームから'),('最終バック',r'最終バック|バックから'),('最終3～4コーナー',r'[３3]角|[４4]角|[３3][〜～・~][４4]コーナー'),('最後の直線',r'直線')]
 found=[name for name,pattern in phases if re.search(pattern,text)]
 # Multiple time markers do not establish which one modifies the action.
 if len(found)>1:return None
 if len(found)==1:context['phase']=found[0]
 if re.search(r'番手(?:から|で|を回)',text):context['role']='follower'
 if trait=='track' and re.search(r'(?:カマシ|かまし)(?:に|への)',text):context['attack_type']='kamashi'
 if trait in ('recover','makuri') and re.search(r'(?:離れて|千切れて|ちぎれて)から',text):context['connection']='detached'
 return context

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
   if re.search(r'[一-龥々]{2,}(?:君|選手|さん)',tail):continue
   subjects=re.findall(r'([一-龥々]{2,})(?:が|は)',tail)
   if any(v not in {'前回','今回','自分','番手','先頭','状態','調子','脚力','作戦','目標','展開','最後','最初','位置','練習'} for v in subjects):continue
   for trait,rules in RULES.items():
    for pattern,value in rules:
     match=re.search(pattern,tail)
     if not match: continue
     if trait=='kamashi' and re.search(r'(?:カマシ|かまし)(?:に|への)',tail):continue
     window=tail[max(0,match.start()-8):match.end()+16]
     if re.search(r'できな|しなかった|せず|られず|れなか|したくな|ない|厳しい|失敗|つもり|予定|たい|れば',window): continue
     context=action_context(tail,trait)
     if context is None:continue
     identity=hashlib.sha256(f'{url}|{rider}|{trait}|{sentence}'.encode()).hexdigest()[:20]
     rows.append(dict(id=identity,rider=rider,trait=trait,value=value,confidence=.6,
       url=url,title=title[:120],excerpt=sentence[:110],condition='単一局面の観察。恒常的な性格と断定しない',
       context=context,context_schema='tk-action-context/v1',
       published_at=date.isoformat(),collected_at=collected.isoformat(),body_verified=True,extractor='explicit-subject-context-v1.7'))
     break
 return rows

def merge_evidence(previous, url, rows):
 # A successful reparse replaces older unscoped interpretations, including
 # actions that the stricter parser no longer attributes to this rider.
 kept={k:e for k,e in previous.items() if e.get('url')!=url or e.get('context_schema')=='tk-action-context/v1'}
 for row in rows:kept.setdefault(row['id'],row)
 return kept

def roster(now,errors):
 names=set(); dates=[]
 manifest=ROOT/'data/s_riders.json'
 if manifest.exists():
  population=json.loads(manifest.read_text())
  if population.get('complete'):names.update(r['name'] for r in population.get('riders',[]))
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

# Completed active-voice actions only. A spoken plan or opponent action is not a rider trait.
SPOKEN_ACTIONS={
 'block':r'ブロックした|けん制した|牽制した',
 'vertical':r'縦に踏んだ|タテに踏んだ',
 'inside':r'中を割った|インを突いた|内を突いた',
 'long_makuri':r'ホームから捲った|ホームからまくった',
 'front':r'前を取った|前受けした|前を取りました',
 'resist':r'突っ張った|突っ張りました',
 'withdraw':r'引いた|引きました|下げた|下げました',
 'kamashi':r'カマした|かました|カマシを決めた|カマシを決めました',
 'makuri':r'捲った|まくった|捲りました|まくりました|捲りで勝った|捲りで勝ちました|捲って勝った|捲って勝ちました',
 'track':r'追走できた|追走できました|食らいついた',
 'seat':r'番手にはまった|飛びついた|飛び付きました',
 'recover':r'自力に切り替えた|再度仕掛けた',
 'finish':r'差し切った|差し切りました|追い込んだ',
 'outer':r'大外から伸びた|外を強襲した',
}
def extract_quotes(quotes,names,url,date,collected):
 rows=[]
 for quote in quotes:
  for sentence in re.split(r'[。！？]',quote['text']):
   sentence=sentence.strip('「」 ')
   if re.search(r'たい|つもり|予定|なら|れば|だろう|かもしれ|と思|と言|と聞|てくれ|てもら|ません|なかった',sentence):continue
   # No implicit subject, second agent, quoted plan, or passive voice between self and action.
   matched={trait for trait,action in SPOKEN_ACTIONS.items() if re.search(r'^(?:僕|私|自分)(?:が|は)(?:(?![がはも「」]).){0,28}(?:'+action+')',sentence)}
   if not matched:continue
   page=Page();page.blocks=[('p',quote['rider']+'は'+sentence)]
   for row in extract(page,names,url,date,collected):
    if row['trait'] not in matched:continue
    row.update(confidence=.45,attribution=quote['attribution'],extractor=PARSER_VERSION,source=source_id(url));row['excerpt']=sentence[:80];rows.append(row)
 return rows

def fair_urls(urls):
 buckets={key:[] for key,_,_ in SOURCES};buckets['other']=[]
 for url in dict.fromkeys(filter(None,map(canonical,urls))):
  if article_url(url):buckets[source_id(url)].append(url)
 while any(buckets.values()):
  for bucket in buckets.values():
   if bucket:yield bucket.pop(0)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--max-articles',type=int,default=60);ap.add_argument('--max-discovery',type=int,default=8);ap.add_argument('--budget-seconds',type=int,default=480);args=ap.parse_args()
 started=time.monotonic();now=dt.datetime.now(UTC);output=ROOT/'data/intelligence.json';previous=json.loads(output.read_text()) if output.exists() else {}
 fetch=Fetcher();errors=[];names,dates=roster(now,errors);links=[];discovery=[]
 statuses={key:{'name':label,'index_url':url,'index_ok':False,'discovered':0,'attempted':0,'body_succeeded':0,'comments_added':0,'errors':0} for key,label,url in SOURCES}
 statuses['other']={'name':'その他の公式レポート','index_ok':False,'discovered':0,'attempted':0,'body_succeeded':0,'comments_added':0,'errors':0}
 def discover(url):
  page=Page();page.feed(fetch.get(url));found=[canonical(urllib.parse.urljoin(url,u)) for u in page.links]
  links.extend(u for u in found if article_url(u));return found
 for key,label,index in SOURCES:
  print(json.dumps({'discovering':key},ensure_ascii=False),flush=True)
  if time.monotonic()-started>args.budget_seconds:break
  try:
   found=discover(index);statuses[key]['index_ok']=True
   discovery.extend(u for u in found if discovery_url(u) and (source_id(u)!='oddspark' or int(re.search(r'/interview/(\d{4})/',u)[1])>=now.year-2))
  except Exception as exc:errors.append({'url':index,'error':str(exc)[:160]});statuses[key]['errors']+=1
 # Follow only observed links: a few recent archive and race detail pages reveal more interviews.
 counts={};seen=set()
 for url in discovery:
  key=source_id(url)
  if url in seen or counts.get(key,0)>=4:continue
  if len(seen)>=min(max(args.max_discovery,0),12) or time.monotonic()-started>args.budget_seconds:break
  seen.add(url);counts[key]=counts.get(key,0)+1
  try:discover(url)
  except Exception as exc:errors.append({'url':url,'error':str(exc)[:160]});statuses[key]['errors']+=1
 links.extend(previous.get('pending_urls',[]))
 links.extend(re.findall(r'https://[^\s\"\'<>]+',(ROOT/'v13.html').read_text()))
 roster_hash=hashlib.sha256('|'.join(names).encode()).hexdigest()[:16]
 cache=previous.get('articles',[])
 known={canonical(a['url']) for a in cache if a.get('body_verified') and a.get('parser_version')==PARSER_VERSION and (now-(iso(a.get('last_checked_at')) or iso(a['collected_at']))).days<30}
 evidence={e['id']:e for e in previous.get('evidence',[]) if e.get('extractor')!='public-sources-v1.5' and iso(e.get('published_at')) and (now-iso(e['published_at'])).days<1095}
 relations={e['id']:e for e in previous.get('relationships',[]) if iso(e.get('published_at')) and (now-iso(e['published_at'])).days<1095}
 notes={n['id']:n for n in previous.get('observations',[]) if iso(n.get('published_at')) and (now-iso(n['published_at'])).days<1095}
 articles={canonical(a['url']):a for a in cache};attempted=0
 queue=list(fair_urls(links))
 for url in queue:statuses[source_id(url)]['discovered']+=1
 pending=[]
 for url in queue:
  if url in known:continue
  if attempted>=max(1,min(args.max_articles,120)) or time.monotonic()-started>args.budget_seconds:pending.append(url);continue
  key=source_id(url);stat=statuses[key];attempted+=1;stat['attempted']+=1
  try:
   source=fetch.get(url);page=Page();page.feed(source);quotes=adapt(page,source,url,names);date=published(page)
   if date is None:raise ValueError('publication date unknown; not used')
   if date>now:raise ValueError('future publication; not used')
   if not any(t=='p' and len(s)>30 for t,s in page.blocks):raise ValueError('article body missing')
   collected=dt.datetime.now(UTC)
   rows=extract_quotes(quotes,names,url,date,collected) if article_kind(url) in ('oddspark','kdreams','marche') else extract(page,names,url,date,collected)
   title=next((v for t,v in page.blocks if t=='h1'),page.meta.get('og:title',''))
   comments=observations(quotes,url,title,date,collected)
   from collect_race_material import relationships
   for rel in relationships(quotes,names,url,date.isoformat(),collected.isoformat()):relations.setdefault(rel['id'],rel)
   for e in rows:e['title']=title[:120]
   evidence=merge_evidence(evidence,url,rows)
   for note in comments:
    if note['id'] not in notes:notes[note['id']]=note;stat['comments_added']+=1
   first=articles.get(url,{}).get('collected_at',collected.isoformat())
   articles[url]={'url':url,'source':key,'published_at':date.isoformat(),'collected_at':first,'last_checked_at':collected.isoformat(),'body_verified':True,'evidence_count':len(rows),'comment_count':len(comments),'roster_hash':roster_hash,'parser_version':PARSER_VERSION}
   stat['body_succeeded']+=1
  except Exception as exc:errors.append({'url':url,'error':str(exc)[:160]});stat['errors']+=1;pending.append(url)
  print(json.dumps({'source':key,'attempted':attempted,'evidence':len(evidence),'comments':len(notes)},ensure_ascii=False),flush=True)
 counts={};bounded={}
 for n in notes.values():
  k=(n['url'],n['rider'])
  if counts.get(k,0)>=2:continue
  n['excerpt']=n['excerpt'][:80];bounded[n['id']]=n;counts[k]=counts.get(k,0)+1
 notes=bounded
 for key,stat in statuses.items():
  stat['stored_articles']=sum(source_id(a['url'])==key for a in articles.values());stat['stored_comments']=sum(source_id(n['url'])==key for n in notes.values());stat['stored_evidence']=sum(source_id(n['url'])==key for n in evidence.values())
 result={'schema':'tk-keirin-intelligence/v1.4','generated_at':dt.datetime.now(UTC).isoformat(),'roster_dates':dates,'roster_size':len(names),'evidence':list(evidence.values()),'observations':list(notes.values()),'relationships':list(relations.values()),'articles':list(articles.values())[-1500:],'pending_urls':pending[:1000],
  'status':{'attempted':attempted,'body_articles':len(articles),'evidence':len(evidence),'comments':len(notes),'sources':statuses,'robots':fetch.robot_status,'errors':errors[-100:]},'notice':'公開本文の氏名・発言者・掲載日を確認。本人コメントは意向と観察を区別し、コメント全体を恒常的特性のスコアにはしない。発走前の情報だけ予想に適用。'}
 output.parent.mkdir(exist_ok=True);tmp=output.with_suffix('.tmp');tmp.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');tmp.replace(output)
 print(json.dumps({'roster':len(names),'articles':len(articles),'evidence':len(evidence),'comments':len(notes),'attempted':attempted,'errors':len(errors)},ensure_ascii=False),flush=True)
 if not articles and not evidence:raise SystemExit('No article bodies available; inspect collection status')
if __name__=='__main__':main()
