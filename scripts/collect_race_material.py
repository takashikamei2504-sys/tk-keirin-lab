#!/usr/bin/env python3
"""Collect S/B and speaker-scoped comments from observed public race-card links."""
import argparse, datetime as dt, hashlib, json, re, time, urllib.parse
from pathlib import Path
from collect_intel import Fetcher, Page, ROOT
from intel_sources import DOM, clean, norm
INDEX='https://keirin.tokyo-sports.co.jp/list/race'
UTC=dt.timezone.utc

def relationships(quotes,names,url,date,collected):
    result=[]
    for q in quotes:
        text=norm(q['text']).translate(str.maketrans('','','（）()'))
        contained=[name for name in names if name in text]
        peers=[name for name in contained if name!=q['rider'] and not any(name!=other and name in other for other in contained)]
        for peer in peers:
            tail=text.split(peer,1)[1][:45]
            kind='assistance_received' if re.search(r'仕事してくれ|助けてくれ|援護してくれ|お世話にな|世話にな|のおかげ|に感謝',tail) else 'mentor' if re.search(r'は自分の師匠|は僕の師匠|が師匠',tail) else 'trust' if re.search(r'を信頼して|を信頼し|に信頼を',tail) else None
            if any(other in tail for other in names if other not in (peer,q['rider'])):continue
            if not kind or re.search(r'くれな|ではない|ことはない|と思う|かもしれ',tail):continue
            result.append({'id':hashlib.sha256(f'{url}|{q["rider"]}|{peer}|{kind}|{text}'.encode()).hexdigest()[:20], 'rider':q['rider'],'peer':peer,'kind':kind,'excerpt':q.get('original_text',text[max(0,text.index(peer)-12):text.index(peer)+78])[:80],'url':url,'published_at':date,'collected_at':collected,'body_verified':True,'attribution':q.get('attribution','選手別コメント欄を照合'),'publication_basis':'article_date_or_collection_upper_bound','scope':'historical_statement'})
    return result

def parse_card(html,url,collected):
    page=Page();page.feed(html);dom=DOM(html).root
    # Never use article:published_time: recommendation/sidebar articles populate that meta on race cards.
    title=page.meta.get('og:title','');match=re.search(r'(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\S+?)競輪\s*(\d{1,2})R',title)
    if not match:raise ValueError('race title date/venue/R missing')
    date=f'{match[1]}-{int(match[2]):02}-{int(match[3]):02}';venue=match[4];rn=int(match[5])
    text=clean(dom.text());start=re.search(r'発走[：:]\s*(\d{2}:\d{2})',text)
    if not start:raise ValueError('start missing')
    tables=[t for t in dom.all('table') if t.has('syussou')]
    if len(tables)!=1:raise ValueError('unique race table missing')
    rows=list(tables[0].all('tr'))
    cells=lambda tr:[n for n in tr.children if hasattr(n,'tag') and n.tag in ('th','td')]
    if len(rows)<10 or [norm(n.text()) for n in cells(rows[1])]!=['競走得点','決まり手','B','S','失格','重注','走注']:raise ValueError('S/B header layout changed')
    if '直近４ヶ月' not in tables[0].text():raise ValueError('statistics period missing')
    riders=[]
    for tr in rows[3:]:
        cs=cells(tr)
        if not 14<=len(cs)<=20:raise ValueError('race columns changed')
        name=clean(cs[2].text());identity=re.fullmatch(r'(.+?)\s+(\d+)歳\s*/\s*(.+?)\s*/\s*(\d+)期',name)
        if not identity:raise ValueError('full identity missing')
        grade=norm(cs[3].text()).replace('Ｓ','S').replace('Ａ','A');rank=re.match(r'(SS|S[12]|A[123])',grade)
        if not rank or not re.fullmatch(r'\d+',norm(cs[1].text())):raise ValueError('car or class missing')
        numbers=[norm(cs[i].text()) for i in (9,10)]
        if not all(re.fullmatch(r'\d+',n) for n in numbers):raise ValueError('measured S/B missing')
        riders.append({'no':int(norm(cs[1].text())),'name':norm(identity[1]),'family':identity[1].split()[0] if len(identity[1].split())==2 else None,'age':int(identity[2]),'prefecture':identity[3],'term':int(identity[4]),'rank':rank[1],'b':int(numbers[0]),'s':int(numbers[1])})
    if len(riders) not in (7,9) or len({r['no'] for r in riders})!=len(riders) or any(not 1<=r['no']<=9 for r in riders):raise ValueError('7/9 rider identities required')
    by_name={r['name']:r for r in riders};quotes=[]
    for block in dom.all('div'):
        if not block.has('race-comment__item'):continue
        name=next((norm(n.text()) for n in block.all('div') if n.has('race-comment__name')),'')
        body=next((clean(n.text()) for n in block.all('div') if n.has('race-comment__txt')),'')
        if name in by_name and body:quotes.append({'rider':name,'text':body,'attribution':'同一出走表の選手名見出しとコメント欄を照合'})
    return {'date':date,'venue':venue,'race_no':rn,'start':start[1],'riders':riders,'quotes':quotes,'source_url':url,'collected_at':collected,'period':'直近4ヶ月','source_published_at':None,'parser_version':'race-card-story-v1.1','publication_basis':'取得時刻を利用可能時刻の上限として使用','related_urls':list(dict.fromkeys(urllib.parse.urljoin(url,u) for u in page.links if urllib.parse.urlsplit(urllib.parse.urljoin(url,u)).hostname=='keirin.tokyo-sports.co.jp' and re.fullmatch(r'/list/race/\d{8}_\d+',urllib.parse.urlsplit(u).path)))}

def collect(max_races=24,budget=90):
    now=dt.datetime.now(UTC);output=ROOT/'data/race_material.json';old=json.loads(output.read_text()) if output.exists() else {};cards=old.get('cards',[]);errors=[];started=time.monotonic();fetch=Fetcher()
    manifest=json.loads((ROOT/'data/s_riders.json').read_text());names=[r['name'] for r in manifest.get('riders',[])];registry={norm(r['name']):r for r in manifest.get('riders',[]) if sum(norm(x['name'])==norm(r['name']) for x in manifest.get('riders',[]))==1}
    intel_path=ROOT/'data/intelligence.json';intel=json.loads(intel_path.read_text());links=[];attempted=0
    try:
        page=Page();page.feed(fetch.get(INDEX))
        links=list(dict.fromkeys(urllib.parse.urljoin(INDEX,u) for u in page.links if urllib.parse.urlsplit(urllib.parse.urljoin(INDEX,u)).hostname=='keirin.tokyo-sports.co.jp' and re.fullmatch(r'/list/race/\d{8}_\d+',urllib.parse.urlsplit(u).path)))
    except Exception as e:errors.append({'url':INDEX,'error':str(e)[:160]})
    relations={r['id']:r for r in intel.get('relationships',[])}
    queue=list(links);seen=set()
    while queue:
        url=queue.pop(0)
        if url in seen:continue
        seen.add(url)
        if attempted>=max_races or time.monotonic()-started>budget:break
        if any(c.get('parser_version')=='race-card-story-v1.1' and c['source_url']==url and (now-dt.datetime.fromisoformat(c.get('last_checked_at',c['collected_at']))).total_seconds()<4*3600 for c in cards):continue
        attempted+=1
        try:
            card=parse_card(fetch.get(url),url,dt.datetime.now(UTC).isoformat())
            for rider in card['riders']:
                ref=registry.get(rider['name']);pref=lambda s:norm(s).replace('県','').replace('府','').replace('都','')
                if ref and pref(ref.get('prefecture',''))==pref(rider['prefecture']) and ref.get('class_rank')==rider['rank']:
                    rider.update(rider_id=ref['rider_id'],verified_identity=True,identity_basis='公式全S級名簿のフルネーム・登録地・級班を照合')
            quotes=card.pop('quotes')
            neighbors=[u for u in card['related_urls'] if u not in seen and u not in queue]
            queue=(neighbors+queue) if any(r['rank'].startswith('S') for r in card['riders']) else (queue+neighbors)
            # A surname is resolved only when it is unique among these exact entrants.
            relation_quotes=[]
            for q in quotes:
                resolved=q['text']
                for rider in card['riders']:
                    family=rider.get('family')
                    if family and sum(r.get('family')==family for r in card['riders'])==1:resolved=re.sub(re.escape(family)+r'(君|さん)',rider['name']+r'\1',resolved)
                relation_quotes.append({**q,'text':resolved,'original_text':q['text'],'attribution':q['attribution']+('／同一出走者の一意な姓を解決' if resolved!=q['text'] else '')})
            card['comments']=[{'rider':q['rider'],'excerpt':q['text'][:38],'declaration':next(iter([s.strip() for s in re.split('[。！？]',q['text']) if s.strip()][-1:]),'')[:24],'body_verified':True,'published_at':card['collected_at'],'collected_at':card['collected_at'],'publication_basis':'collection_upper_bound','url':url,'attribution':q['attribution'],'kind':'race_intention','race_id':f'{card["date"]}:{card["venue"]}:{card["race_no"]}'} for q in quotes]
            for note in card['comments']:
                targets=[]
                for rider in card['riders']:
                    labels=[rider['name']]+([rider['family']] if rider.get('family') and sum(r.get('family')==rider['family'] for r in card['riders'])==1 else [])
                    if any(re.search(re.escape(label)+r'(?:君|さん)?(?:へ|に任せ|をマーク)[。！]?$',norm(note['declaration'])) for label in labels):targets.append(rider['no'])
                if len(set(targets))==1:note['follow_no']=targets[0]
            for e in relationships(relation_quotes,sorted(set(names)|{r['name'] for r in card['riders']}),url,card['collected_at'],card['collected_at']):relations.setdefault(e['id'],e)
            digest=hashlib.sha256(json.dumps({'card':{k:v for k,v in card.items() if k not in ('collected_at','comments')},'comments':[(c['rider'],c['excerpt']) for c in card['comments']]},sort_keys=True,ensure_ascii=False).encode()).hexdigest()[:20]
            card['id']=digest;existing=next((c for c in cards if c['id']==digest),None)
            if existing:existing['last_checked_at']=card['collected_at']
            else:cards.append(card)
        except Exception as e:errors.append({'url':url,'error':str(e)[:160]})
    cards=[c for c in cards if (now-dt.datetime.fromisoformat(c['collected_at'])).days<=45]
    output.write_text(json.dumps({'schema':'tk-keirin-race-material/v1','generated_at':dt.datetime.now(UTC).isoformat(),'cards':cards,'status':{'discovered':len(links),'attempted':attempted,'errors':errors}},ensure_ascii=False,indent=2)+'\n')
    intel['relationships']=list(relations.values());intel_path.write_text(json.dumps(intel,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'cards':len(cards),'rider_rows':sum(len(c['riders']) for c in cards),'relations':len(relations),'errors':len(errors)},ensure_ascii=False))
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--max-races',type=int,default=24);ap.add_argument('--budget-seconds',type=int,default=90);a=ap.parse_args();collect(max(1,min(a.max_races,48)),max(5,min(a.budget_seconds,150)))
