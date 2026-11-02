#!/usr/bin/env python3
"""Join collected public sources by verified registration ID; retain source time.
The dossier is a research index, not a new prediction model.
"""
import datetime as dt
import json
from pathlib import Path
from rider_knowledge import TOPICS, norm, topics

ROOT = Path(__file__).resolve().parents[1]

def stamp(value):
 try:
  t=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
  return t if t.tzinfo else None
 except (ValueError, TypeError, AttributeError): return None

def build(manifest, recent, intel, material, previous=None, now=None):
 now=now or dt.datetime.now(dt.timezone.utc)
 names={}; riders={}; rejected=0
 for r in manifest.get('riders',[]):
  rid=str(r['rider_id']).zfill(6)
  riders[rid]={'rider_id':rid,'name':r['name'],'registration':r,
    'registration_source':manifest.get('source_url'),
    'registration_collected_at':manifest.get('generated_at'),
    'recent_form':None,'race_cards':[],'notes':[]}
  names.setdefault(norm(r['name']),[]).append(rid)
 def resolve(row):
  ids=names.get(norm(row.get('rider') or row.get('name')),[])
  if len(ids)!=1: return None
  rid=ids[0]
  if row.get('rider_id') and str(row['rider_id']).zfill(6)!=rid: return None
  return riders[rid]
 for s in recent.get('snapshots',[]):
  r=resolve(s); acquired=stamp(s.get('collected_at')); updated=stamp(s.get('source_updated_at'))
  if not r or not s.get('verified_identity') or not acquired or not updated or not updated<=acquired<=now: continue
  old=r['recent_form']
  if not old or (s['source_updated_at'],s['collected_at'])>(old['source_updated_at'],old['collected_at']):r['recent_form']={k:s[k] for k in ('id','rider_id','name','period','stats','source_url','source_updated_at','collected_at','verified_identity') if k in s}
 # Preserve measured card history beyond the live feed's 45-day window.
 for old in (previous or {}).get('riders',[]):
  r=resolve(old)
  if r:r['race_cards'].extend(c for c in old.get('race_cards',[]) if stamp(c.get('collected_at')) and stamp(c['collected_at'])<=now)
 # Preserve already collected notes when live-source retention windows expire.
 notes=[]
 for r in (previous or {}).get('riders',[]):notes.extend(r.get('notes',[]))
 notes.extend({**n,'record_type':field} for field in ('evidence','observations','relationships','knowledge') for n in intel.get(field,[]))
 for card in material.get('cards',[]):
  acquired=stamp(card.get('collected_at'))
  if not acquired or acquired>now: continue
  for rr in card.get('riders',[]):
   r=resolve(rr)
   if not r or rr.get('verified_identity') is not True: continue
   # S/B has its own period and observation; do not blend periods or add counts.
   r['race_cards'].append({'date':card['date'],'venue':card['venue'],'race_no':card['race_no'],
     'period':card.get('period'),'s':rr.get('s'),'b':rr.get('b'),
     'age':rr.get('age'),'term':rr.get('term'),
     'url':card['source_url'],'collected_at':card['collected_at']})
  for n in card.get('comments',[]):
   n=dict(n)
   rr=next((rr for rr in card.get('riders',[]) if norm(rr['name'])==norm(n.get('rider'))),{})
   if not rr.get('verified_identity'):continue
   n['rider_id']=rr['rider_id'];n['record_type']='race_comment';notes.append(n)
 seen=set()
 for n in notes:
  r=resolve(n); pub=stamp(n.get('published_at')); col=stamp(n.get('collected_at'))
  if not r or n.get('body_verified') is not True or not str(n.get('url','')).startswith('https://') or not pub or not col or not pub<=col<=now:
   rejected+=1;continue
  identity=(r['rider_id'],n['url'],n.get('record_type'),n.get('id') or n.get('excerpt'),n.get('race_id'))
  if identity in seen:continue
  seen.add(identity)
  r['notes'].append({**n,'rider_id':r['rider_id'],'topics':n.get('topics') or topics(n.get('excerpt',''))})
 for r in riders.values():
  r['notes'].sort(key=lambda n:(n['published_at'],n['collected_at']),reverse=True)
  r['race_cards']=list({(c['url'],c['collected_at']):c for c in r['race_cards']}.values())
  r['race_cards'].sort(key=lambda c:c['collected_at'],reverse=True)
  found={t for n in r['notes'] for t in n['topics']}
  r['covered_topics']=sorted(found & TOPICS.keys());r['missing_topics']=sorted(TOPICS.keys()-found)
  r['coverage']={'recent_form':r['recent_form'] is not None,'article_notes':bool(r['notes']),
    'measured_s':any(c['s'] is not None for c in r['race_cards']),
    'observed_actions':any(n.get('record_type')=='evidence' for n in r['notes'])}
 result={'schema':'tk-rider-dossiers/v1','generated_at':now.isoformat(),
   'topics':{k:v[0] for k,v in TOPICS.items()},'riders':list(riders.values()),
   'coverage':{'total':len(riders),'article_notes':sum(bool(r['notes']) for r in riders.values()),
     'recent_form':sum(r['recent_form'] is not None for r in riders.values()),
     'by_topic':{t:sum(t in r['covered_topics'] for r in riders.values()) for t in TOPICS},'rejected_notes':rejected},
   'source_generated_at':{k:p.get('generated_at') for k,p in [('roster',manifest),('recent',recent),('intel',intel),('race_material',material)]},
   'notice':'全S級を分母として不足分も表示。話題検出は事実認定・能力評価ではない。予想使用時には原記録の掲載・初回取得時刻と局面条件を再検査する。'}
 return result

def main():
 def read(name):
  p=ROOT/'data'/name
  return json.loads(p.read_text()) if p.exists() else {}
 manifest=read('s_riders.json')
 if not manifest.get('complete'):raise SystemExit('complete official roster required')
 result=build(manifest,read('recent_form.json'),read('intelligence.json'),read('race_material.json'),read('rider_dossiers.json'))
 out=ROOT/'data/rider_dossiers.json';tmp=out.with_suffix('.tmp')
 tmp.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n');tmp.replace(out)
 print(json.dumps(result['coverage'],ensure_ascii=False))

if __name__=='__main__':main()
