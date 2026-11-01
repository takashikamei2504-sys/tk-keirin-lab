"""Public source adapters. Quotes retain a verified speaker and never become facts by default."""
import re, urllib.parse
from html.parser import HTMLParser
SOURCES=[
 ('tospo','東スポ競輪','https://keirin.tokyo-sports.co.jp/'),
 ('sponichi','KEIRINスポニチ','https://keirinsponichi.jp/'),
 ('netkeirin','netkeirin','https://keirin.netkeiba.com/news/news_list.html'),
 ('oddspark','オッズパーク・選手インタビュー','https://blog.oddspark.com/interview/'),
 ('kdreams','Kドリームス・選手インタビュー','https://keirin.kdreams.jp/'),
 ('marche','けいりんマルシェ・選手コラム','https://keirin-marche.jp/column/'),
]
HOST_SOURCE={urllib.parse.urlsplit(u).hostname:k for k,_,u in SOURCES}
def canonical(url):
 p=urllib.parse.urlsplit(url)
 if p.scheme not in ('https','http') or p.username or p.password:return ''
 # Tracking/query variants must not count as new interviews.
 query=p.query if p.hostname=='keirin.netkeiba.com' else ''
 return urllib.parse.urlunsplit(('https',p.netloc,p.path,query,''))
def source_id(url):return HOST_SOURCE.get(urllib.parse.urlsplit(url).hostname,'other')
def article_kind(url):
 p=urllib.parse.urlsplit(url)
 if p.hostname=='blog.oddspark.com' and re.fullmatch(r'/interview/\d{4}/\d{2}/[^/]+\.html',p.path):return 'oddspark'
 if p.hostname=='keirin.kdreams.jp' and re.fullmatch(r'/[^/]+/pickupracer/\d{10}/',p.path):return 'kdreams'
 if p.hostname=='keirin-marche.jp' and re.fullmatch(r'/(?:column/[^/]+/[^/]+|enjoy/interview/[^/]+)/?',p.path):return 'marche'
 return None

def discovery_url(url):
 p=urllib.parse.urlsplit(url)
 return bool((p.hostname=='blog.oddspark.com' and re.fullmatch(r'/interview/\d{4}/(?:index(?:_\d+)?\.html)?',p.path)) or (p.hostname=='keirin.kdreams.jp' and re.fullmatch(r'/[^/]+/racedetail/\d+/',p.path)))

class Node:
 def __init__(self,tag='',attrs=()):self.tag=tag;self.attrs=dict(attrs);self.children=[]
 def has(self,cls):return cls in self.attrs.get('class','').split()
 def text(self):
  if self.tag in ('script','style','nav','header','footer','aside'):return ''
  return ''.join(c.text() if isinstance(c,Node) else c for c in self.children)
 def all(self,tag=None):
  for c in self.children:
   if isinstance(c,Node):
    if c.tag in ('script','style','nav','header','footer','aside'):continue
    if tag is None or c.tag==tag:yield c
    yield from c.all(tag)
class DOM(HTMLParser):
 def __init__(self,html):super().__init__(convert_charrefs=True);self.root=Node();self.stack=[self.root];self.feed(html)
 def handle_starttag(self,tag,attrs):
  n=Node(tag,attrs);self.stack[-1].children.append(n)
  if tag=='br':n.children.append('\n')
  if tag not in {'br','hr','img','meta','link','input','source','wbr','area','base','embed','param','col'}:self.stack.append(n)
 def handle_startendtag(self,tag,attrs):self.handle_starttag(tag,attrs);self.handle_endtag(tag)
 def handle_endtag(self,tag):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i].tag==tag:self.stack=self.stack[:i];break
 def handle_data(self,data):self.stack[-1].children.append(data)
def norm(s):return re.sub(r'[\s\u3000]','',s)
def clean(s):return re.sub(r'\s+',' ',s).strip()
def by_id(root,id):return next((n for n in root.all() if n.attrs.get('id')==id),None)
def date_text(s):
 m=re.search(r'(\d{4})[年/.](\d{1,2})[月/.](\d{1,2})日?',s)
 return f'{m[1]}-{int(m[2]):02}-{int(m[3]):02}' if m else None

def adapt(page,html,url,names):
 """Returns only source-scoped bodies. Sidebar dates/subjects cannot supply attribution."""
 kind=article_kind(url);root=DOM(html).root;quotes=[]
 if kind=='oddspark':
  title=by_id(root,'entryTitle');body=by_id(root,'entryBody');date=by_id(root,'entryFooterDate')
  if not title or not body or not date:raise ValueError('interview article scope or date missing')
  page.blocks=[('h1',clean(title.text()))]+[('p',clean(n.text())) for n in body.all('p') if clean(n.text())]
  page.meta['article:published_time']=date_text(date.text()) or ''
  subjects=[n for n in names if n in norm(title.text())]
  if len(subjects)==1:
   subject=subjects[0]
   for node in body.all('p'):
    for line in node.text().splitlines():
     m=re.match(r'^\s*([^：:]{2,12})[：:]\s*(.+)',line)
     if m and subject.startswith(norm(m[1])):quotes.append({'rider':subject,'text':clean(m[2]),'attribution':'記事題名の氏名と発言者ラベルを照合'})
 elif kind=='kdreams':
  sections=[n for n in root.all('div') if n.has('interview_section')]
  notes=[n for n in root.all('p') if n.has('kaisai-detail_contents-header-note')]
  date=next((date_text(n.text()) for n in notes if '時点の記事' in n.text()),None)
  if not sections or not date:raise ValueError('dated interview section missing')
  page.meta['article:published_time']=date;page.blocks=[('h1',page.meta.get('og:title','Kドリームス選手インタビュー'))]
  for section in sections:
   for column in section.all('div'):
    headings=[n for n in column.all('h5') if n.has('racer')]
    if not column.has('column') or len(headings)!=1:continue
    name=norm(re.split('[【［\\[]',headings[0].text())[0])
    if name not in names:continue
    for para in column.all('p'):
     if para.has('text') and len(clean(para.text()))>10:
      text=clean(para.text());quotes.append({'rider':name,'text':text,'attribution':'選手見出しと同じコメント欄を照合'});page.blocks.append(('p',text))
 elif kind=='marche':
  article=next((n for n in root.all('div') if n.has('article') and n.has('interview')),None)
  body=by_id(root,'article_top')
  dates=[n for n in (article.all('p') if article else []) if n.has('date_publicArticle')]
  title=next(article.all('h1'),None) if article else None
  if not body or not title or len(dates)!=1:raise ValueError('scoped article body/date missing')
  page.meta['article:published_time']=date_text(dates[0].text()) or ''
  page.blocks=[('h1',clean(title.text()))]+[('p',clean(n.text())) for n in body.all('p') if clean(n.text())]
  subjects=[n for n in names if n in norm(title.text())]
  if len(subjects)==1:
   for para in body.all('p'):
    text=clean(para.text())
    if re.search(r'僕は|私は|自分は',text) and not any(n!=subjects[0] and n in norm(text) for n in names):quotes.append({'rider':subjects[0],'text':text,'attribution':'単独の選手インタビュー題名と一人称の段落を照合'})
 return quotes

# Interview speech is stored separately from observed race actions.
# Intent, uncertainty, quoted opponents and ambiguous subjects never get trait values here.
def observations(quotes,url,title,date,collected):
 import hashlib
 result=[];counts={}
 for q in quotes:
  if counts.get(q['rider'],0)>=2:continue
  sentences=[s.strip('「」 ') for s in re.split(r'[。！？]',q['text']) if len(s.strip())>8]
  relevant=[s for s in sentences if re.search(r'先行|捲|まく|カマ|かま|突っ張|追走|番手|位置|仕掛|単騎|切り替|脚|状態|調子|前受|引いて|バック|練習|疲れ|不安|後方',s)]
  if not relevant:continue
  excerpt='。'.join(relevant)[:80];counts[q['rider']]=counts.get(q['rider'],0)+1
  identity=hashlib.sha256((url+'|'+q['rider']+'|'+excerpt).encode()).hexdigest()[:24]
  result.append({'id':identity,'rider':q['rider'],'excerpt':excerpt,'url':url,'title':title[:120],'published_at':date.isoformat(),'collected_at':collected.isoformat(),'body_verified':True,'kind':'interview_comment','attribution':q['attribution'],'source':source_id(url),'use':'意向・近況を含む本人コメント。恒常的特性や実行済みの走りと断定せず、特性スコアへ自動加算しない'})
 return result
