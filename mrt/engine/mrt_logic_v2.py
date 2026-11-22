"""All-record, sequential-ticket and weakly supervised tactical research model.

Article events are supervised labels only. No present article/mark/outcome enters
inference. Historical validation periods have previously been examined in V1.
"""
import os
os.environ.setdefault('OMP_NUM_THREADS','3')
os.environ.setdefault('OPENBLAS_NUM_THREADS','3')
import argparse,collections,copy,datetime as dt,gzip,hashlib,html,itertools,json,pathlib,re,unicodedata
import joblib,numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor,HistGradientBoostingClassifier,ExtraTreesRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import f1_score
from mrt_logic_engine import parse_tickets,cash,diag_names,allocate,payout,hist_vector

ROOT=pathlib.Path(__file__).resolve().parent
KINDS=['3連単','2車単','3連複','2車複']
ACTIONS={
 '先行':r'先行|主導権|駆け', '捲り':r'捲', 'カマシ':r'カマシ|カマし|カマして',
 '突っ張り':r'突っ張', '番手抜出':r'抜け出|交わ|捉え|差し|差す',
 '切替':r'切り替|切替', '追走懸念':r'離れ|千切|追走に苦|追走が厳',
 '直線伸び':r'強襲|伸び|伸ば|縦脚|縦足', '競り':r'競り|競って|競る',
 '中団':r'中団', '不発':r'不発|仕掛けが遅|捲れず|脚がもたない',
 '前受け':r'前受け','番手捲り':r'番手捲','飛びつき':r'飛びつ|番手に入|番手を奪',
 '牽制ブロック':r'ブロック|牽制|封じ|蓋を|揺さぶ','脚消耗':r'消耗|脚を使|脚がもた|脚を削',
 '関係心理':r'遠慮|先輩|後輩|地元|連れ','追走':r'マーク|追走|続く|追って'}
ACTION_NAMES=list(ACTIONS)
POLICY={'scope':'All 7126 collected forecasts, not all platform races or deleted/unlisted articles.',
 'forbidden_current_inputs':['teacher_article','teacher_marks','teacher_selected_scores','teacher_tickets','finish','actual_B','payout','cancellation_status'],
 'lineup':'Conditioned on retrospective teacher-page lines; independent as-of start-list agreement unverified. Missing positions remain unknown.',
 'history':'Previous dates only; same-date histories frozen. Full roster identity keys only; unresolved identities remain missing.',
 'events':'Conservative automatic actor/action/negation/condition labels; not a manually verified tactical gold standard or observed action.',
 'validation':'Fixed historical folds, development evidence. Some periods were already inspected in V1; no new untouched TEST or prospective proof.',
 'hyperparameters':'Fixed leaves=31, iterations=70, no selection on V2 fold outcomes. No ROI threshold optimization.',
 'scores':'Imitation allocation and article-label scores, not calibrated racing probabilities.',
 'stacking':'Action inputs for ticket fitting use chronological out-of-fold predictions, never current article annotations.'}

def dump(p,x):pathlib.Path(p).write_text(json.dumps(x,ensure_ascii=False,indent=2),encoding='utf-8')
def load(p):return json.loads(pathlib.Path(p).read_text())
def day(s):return dt.datetime.strptime(s,'%Y%m%d').date().toordinal()
def normalize(s):return unicodedata.normalize('NFKC',s)
def reg():return HistGradientBoostingRegressor(max_iter=70,max_leaf_nodes=31,l2_regularization=3,learning_rate=.08,early_stopping=False,random_state=634)
def clf():return HistGradientBoostingClassifier(max_iter=70,max_leaf_nodes=15,l2_regularization=3,learning_rate=.08,early_stopping=False,random_state=634)

def extract_events(text,aliases):
 """Resolve local mentions conservatively; output paraphrased facts, no article text."""
 text=normalize(text);aliascars=collections.defaultdict(set)
 for car,names in aliases.items():
  for n in names:
   n=re.sub(r'\s*[(（].*','',normalize(n)).strip()
   if len(n)>=2:
    aliascars[n].add(int(car))
    # Japanese articles usually introduce a full name once and then use a
    # surname. Prefix aliases are accepted only before an explicit particle;
    # shared prefixes in the same race remain unresolved.
    for length in range(2,min(4,len(n)-1)+1):aliascars[n[:length]].add(int(car))
 unique={k:next(iter(v)) for k,v in aliascars.items() if len(v)==1};events=[];edges=[];unresolved=0;mentioned=set()
 for si,sentence in enumerate(re.split(r'[。\n]+',text)):
  if not sentence.strip():continue
  explicit=[(m.start(),m.end(),int(m[1]),'number') for m in re.finditer(r'\(([1-9])番車\)',sentence)]
  mentions=list(explicit)
  for name,car in sorted(unique.items(),key=lambda x:-len(x[0])):
   pattern=re.escape(name)+r'(?=は|が|の|を|も|に|なら|から|と|＝|=|、|。|$|[（(])'
   for m in re.finditer(pattern,sentence):
    if not any(a<=m.start()<b for a,b,c,method in mentions):mentions.append((m.start(),m.end(),car,'unique_name'))
  mentions.sort();mentioned.update(c for a,b,c,method in mentions)
  previous=None
  for cm in re.finditer(r'[^、,;；]+',sentence):
   start,end=cm.span();clause=cm[0];local=[x for x in mentions if start<=x[0]<end]
   for action,pattern in ACTIONS.items():
    for am in re.finditer(pattern,clause):
     absolute=start+am.start();left=[m for m in local if m[1]<=absolute];right=[m for m in local if m[0]>=absolute]
     if left:actor=left[-1][2];method=left[-1][3]
     elif right and right[0][0]-absolute<25:actor=right[0][2];method='following_'+right[0][3]
     elif not local and previous is not None:actor=previous;method='same_sentence_carry'
     else:unresolved+=1;continue
     window=clause[am.end():am.end()+18]
     negated=bool(re.search(r'できな|難し|厳し|考えにく|とは言えな|わけではな|せず',window))
     conditional=bool(re.search(r'場合|なら|なれば|としても|回った|した展開|仮に',sentence))
     e={'sentence_index':si,'actor':actor,'action':action,'negated':negated,'conditional':conditional,'resolution':method,'sentence_sha256':hashlib.sha256(sentence.encode()).hexdigest()}
     key=(si,actor,action,negated,conditional)
     if not any((q['sentence_index'],q['actor'],q['action'],q['negated'],q['conditional'])==key for q in events):events.append(e)
   if local and len(set(x[2] for x in local))==1:previous=local[-1][2]
   elif len(set(x[2] for x in local))>1:previous=None
  local_events=[e for e in events if e['sentence_index']==si]
  if re.search(r'そうなれば|なら|場合|展開|一方',sentence):
   for a,b in zip(local_events,local_events[1:]):
    if a['actor']!=b['actor']:edges.append({'from_actor':a['actor'],'from_action':a['action'],'to_actor':b['actor'],'to_action':b['action'],'relation':'same_sentence_conditional_candidate','sentence_sha256':a['sentence_sha256']})
 return events,edges,sorted(mentioned),unresolved

def build(out):
 records=load(ROOT/'mrt_2026_11/cumulative_structured_records.json');data=[];audit=[];eventcount=collections.Counter();rawmonth=None;raw={}
 for r in sorted(records,key=lambda r:(r['date'],r['race_ids'][0])):
  ym=r['date'][:6];directory=ROOT/f'mrt_{ym[:4]}_{ym[4:]}'
  if ym!=rawmonth:
   raw={x['forecast_id']:x for x in load(directory/'records.json')};rawmonth=ym
  fid=r['forecast_id'];source=(directory/(fid+'.html')).read_text();display=diag_names(source)
  lines=sorted(r['prediction_facts']['published_lines'],key=lambda l:tuple(l));roster=sorted(set(int(x[2]) for x in r['finish_rows'])|{c for l in lines for c in l})
  assert 5<=len(roster)<=9 and len({c for l in lines for c in l})==sum(map(len,lines)),fid
  tickets,errors=parse_tickets(r['tickets']);assert not errors,(fid,errors)
  assert not any(set(t)-set(roster) for d in tickets.values() for t in d),(fid,'ticket outside roster')
  gross=sum(sum(t.values()) for t in tickets.values());charged=cash(r['amounts']['合計']);cancel={int(x[2]) for x in r['finish_rows'] if x[0]=='欠'}
  refund=sum(v for ts in tickets.values() for t,v in ts.items() if set(t)&cancel)
  assert gross-refund==charged,(fid,gross,refund,charged)
  measured=r.get('measured_result',{});full={int(x[2]):x[3].split()[0] for x in measured.get('finish_rows',[])}
  aliases={c:[display.get(c,'')]+[x['name'] for x in r['prediction_facts']['marked_riders'] if x['car']==c]+([full[c]] if c in full else []) for c in roster}
  events,edges,mentioned,unresolved=extract_events(raw[fid].get('view',''),aliases)
  events=[e for e in events if e['actor'] in roster];eventcount.update(e['action'] for e in events)
  unknown=sorted(set(roster)-{c for l in lines for c in l})
  names={str(c):full.get(c) or display.get(c) or next((x[3] for x in r['finish_rows'] if int(x[2])==c),str(c)) for c in roster}
  labels={'tickets':{k:[{'cars':list(t),'yen':v} for t,v in d.items()] for k,d in tickets.items()},'gross_stake':gross,'charged_stake':charged,'refund':refund,'cancelled':sorted(cancel),
   'honmei':next(x['car'] for x in r['prediction_facts']['marked_riders'] if x['mark']=='Honmei'),'finish':{x[2]:int(x[0]) for x in r['finish_rows'] if x[0].isdigit()},
   'back':measured.get('back_cars') if measured.get('status')=='result_received' else None,'payments':measured.get('payment_rows',[]),'measured_result':measured,
   'scores_after_race':{str(x['car']):x['score'] for x in r['prediction_facts']['marked_riders'] if x['score'] is not None},'teacher_payout':cash(r['amounts']['払い戻し金額']),
   'events':events,'conditional_edges':edges,'mentioned_actors':mentioned,'unresolved_action_mentions':unresolved}
  rid=r['race_ids'][0]
  data.append({'forecast_id':fid,'race_id':rid,'date':r['date'],'venue':int(rid[8:10]),'race_no':int(rid[10:]),'roster':roster,'lines':lines,'unknown_cars':unknown,'names':names,'history_keys':{str(c):full.get(c) for c in roster},'labels':labels,'source_url':r['source_url'],'source_sha256':r['sha256']})
  if refund or unknown:audit.append({'forecast_id':fid,'gross_stake':gross,'refund':refund,'charged_stake':charged,'unknown_line_cars':unknown,'restoration':'No invented line membership; gross plan used for teacher imitation, refund-adjusted stake for accounting.'})
 assert len(data)==len({r['forecast_id'] for r in data})==7126
 result={'source_records':len(records),'learning_records':len(data),'excluded_records':0,'refund_records':sum(r['labels']['refund']>0 for r in data),'unknown_line_records':sum(bool(r['unknown_cars']) for r in data),'articles_with_actor_actions':sum(bool(r['labels']['events']) for r in data),'actor_action_events':sum(len(r['labels']['events']) for r in data),'conditional_candidate_edges':sum(len(r['labels']['conditional_edges']) for r in data),'action_counts':dict(eventcount),'restored_details':audit,'policy':POLICY}
 dump(out/'coverage_audit.json',result)
 with gzip.open(out/'dataset.json.gz','wt',encoding='utf-8') as f:json.dump(data,f,ensure_ascii=False)
 print(json.dumps({'stage':'dataset',**{k:v for k,v in result.items() if k not in ['restored_details','policy']}},ensure_ascii=False),flush=True)
 return data

RACE_NAMES=['field_size','lines','singles','longest','unknown_positions','venue','race_no','elapsed_days','month_sin','month_cos']+[f'line_len_{i}' for i in range(5)]
RIDER_NAMES=['car','position','line_length','leader','second','single','unknown']+['past_n','win_rate','top3_rate','rank_strength','B_rate','B_n','past_score','score_missing','score_age']+['last3_strength','last10_strength','days_since_last','leader_score','leader_B','leader_strength','second_score','score_vs_leader','score_vs_field','B_vs_other_leaders','line_mean_score','line_min_strength']

def features_for(r,history):
 n=len(r['roster']);lengths=sorted(map(len,r['lines']),reverse=True);month=int(r['date'][4:6]);now=day(r['date']);pos={c:(j,p) for j,l in enumerate(r['lines']) for p,c in enumerate(l)}
 rf=[n,len(lengths),lengths.count(1),max(lengths,default=0),len(r['unknown_cars']),r['venue'],r['race_no'],now-day('20250414'),float(np.sin(month*np.pi/6)),float(np.cos(month*np.pi/6))]+(lengths+[0]*5)[:5]
 hv={c:hist_vector(history.get(r['history_keys'].get(str(c)),{}),now) for c in r['roster']};known=[v[6] for v in hv.values() if v[6]];avg=float(np.mean(known)) if known else 0;rv={}
 for c in r['roster']:
  key=r['history_keys'].get(str(c));h=history.get(key,{}) if key else {};recent=h.get('recent',[]);recentstrength=[x[1] for x in recent]
  j,p=pos.get(c,(-1,-1));line=r['lines'][j] if j>=0 else [];leader=line[0] if line else c;second=line[1] if len(line)>1 else None
  others=[hv[l[0]][4] for l in r['lines'] if l and l[0]!=leader];ls=[hv[q][6] for q in line if hv[q][6]]
  rv[c]=[c,p,len(line),int(p==0),int(p==1),int(len(line)==1),int(p==-1)]+hv[c]+[
   float(np.mean(recentstrength[-3:])) if recentstrength else .5,float(np.mean(recentstrength[-10:])) if recentstrength else .5,min(999,now-recent[-1][0]) if recent else 999,
   hv[leader][6],hv[leader][4],hv[leader][3],hv[second][6] if second else 0,hv[c][6]-hv[leader][6] if hv[c][6] and hv[leader][6] else 0,hv[c][6]-avg if hv[c][6] else 0,
   hv[c][4]-max(others,default=1/7),float(np.mean(ls)) if ls else 0,min([hv[q][3] for q in line],default=.5)]
  assert len(rv[c])==len(RIDER_NAMES)
 return rf,rv

def update(r,history):
 lab=r['labels'];now=day(r['date']);n=len(r['roster'])
 for c in r['roster']:
  key=r['history_keys'].get(str(c))
  if not key or c in lab['cancelled']:continue
  h=history.setdefault(key,{});rank=lab['finish'].get(str(c))
  if rank:
   strength=(n-rank)/(n-1);h['n']=h.get('n',0)+1;h['win']=h.get('win',0)+int(rank==1);h['top3']=h.get('top3',0)+int(rank<=3);h['strength']=h.get('strength',0)+strength;h.setdefault('recent',[]).append([now,strength]);h['recent']=h['recent'][-10:]
  if lab['back'] is not None:h['bn']=h.get('bn',0)+1;h['B']=h.get('B',0)+int(c in lab['back'])
  score=lab['scores_after_race'].get(str(c))
  if score is not None:h['score']=score;h['score_day']=now

def all_features(data):
 history={};features=[]
 for date,group in itertools.groupby(data,key=lambda r:r['date']):
  batch=list(group)
  for r in batch:features.append(features_for(r,history))
  for r in batch:update(r,history)
 return features,history

def actor_rows(data,features,indices):
 X=[];Y=[];owner=[]
 for i in indices:
  r=data[i];rf,rv=features[i];ev=r['labels']['events']
  for c in sorted(rv):
   X.append(rf+rv[c]);Y.append([int(any(e['actor']==c and e['action']==a and not e['negated'] for e in ev)) for a in ACTION_NAMES]);owner.append((i,c))
 return np.asarray(X,dtype=np.float32),np.asarray(Y),owner

def fit_actions(X,Y):
 models=[]
 for j in range(len(ACTION_NAMES)):
  if len(set(Y[:,j]))<2:models.append(float(Y[:,j].mean()) if len(Y) else 0.)
  else:models.append(clf().fit(X,Y[:,j]))
 return models

def action_scores(models,X):return np.column_stack([np.full(len(X),m) if isinstance(m,float) else m.predict_proba(X)[:,1] for m in models])

def crossfit_actions(data,features,indices):
 """Expanding date blocks; no current or later fold article labels are used."""
 X,Y,owner=actor_rows(data,features,indices);dates=sorted({data[i]['date'] for i in indices});blocks=[set(x.tolist()) for x in np.array_split(np.asarray(dates),4)];scores=np.zeros((len(X),len(ACTION_NAMES)),dtype=np.float32);proof=[]
 for j,block in enumerate(blocks):
  current=[k for k,(i,c) in enumerate(owner) if data[i]['date'] in block];prior=[k for k,(i,c) in enumerate(owner) if data[i]['date']<min(block)]
  if prior:scores[current]=action_scores(fit_actions(X[prior],Y[prior]),X[current])
  else:scores[current]=.01
  proof.append({'block':j,'first_date':min(block),'last_date':max(block),'training_rider_rows':len(prior),'predicted_rider_rows':len(current),'prior_last_date':max((data[owner[k][0]]['date'] for k in prior),default=None)})
 return {(i,c):scores[k].tolist() for k,(i,c) in enumerate(owner)},fit_actions(X,Y),proof

def seq_features(r,rf,rv,paths,kind,action):
 pos={c:(j,p) for j,l in enumerate(r['lines']) for p,c in enumerate(l)};rows=[]
 for t in paths:
  row=rf+[int(k==kind) for k in KINDS]
  for c in t:row+=rv[c]+list(action[c])
  for a,b in itertools.combinations(range(len(t)),2):
   la,pa=pos.get(t[a],(-1,-1));lb,pb=pos.get(t[b],(-2,-1));same=la>=0 and la==lb;row += [int(same),pb-pa if same else 0,int(same and pb==pa+1)]
  rows.append(row)
 return np.asarray(rows,dtype=np.float32)

def ordered_target(tickets,kind):
 d=collections.Counter();total=sum(t['yen'] for t in tickets)
 for t in tickets:
  perms=list(itertools.permutations(t['cars'])) if '複' in kind else [tuple(t['cars'])]
  for p in perms:d[p]+=t['yen']/total/len(perms)
 return d

def fit_model(data,features,indices,stage):
 print(json.dumps({'stage':stage,'races':len(indices),'phase':'action_crossfit'}),flush=True)
 ac,actionmodels,proof=crossfit_actions(data,features,indices)
 XX=[[],[],[]];YY=[[],[],[]];WW=[[],[],[]];RX=[];hon=[];win=[];back=[];BI=[];raceX=[];family=[];counts=[]
 for ii in indices:
  r=data[ii];rf,rv=features[ii];lab=r['labels'];act={c:ac[ii,c] for c in rv};cars=sorted(rv);raceX.append(rf)
  primary=max(lab['tickets'],key=lambda k:sum(t['yen'] for t in lab['tickets'][k]));family.append(KINDS.index(primary));counts.append(sum(len(v) for v in lab['tickets'].values()))
  for c in cars:
   RX.append(rf+rv[c]);hon.append(int(c==lab['honmei']));win.append(int(lab['finish'].get(str(c))==1))
   if lab['back'] is not None and c not in lab['cancelled']:BI.append(len(RX)-1);back.append(int(c in lab['back']))
  for kind,tickets in lab['tickets'].items():
   d=ordered_target(tickets,kind);fm=collections.Counter();pm=collections.Counter()
   for t,v in d.items():fm[t[0]]+=v;pm[t[:2]]+=v
   paths=[(c,) for c in cars];XX[0].append(seq_features(r,rf,rv,paths,kind,act));YY[0].extend(fm[c] for c in cars);WW[0].extend([1/len(cars)]*len(cars))
   for first,weight in fm.items():
    paths=[(first,c) for c in cars if c!=first];XX[1].append(seq_features(r,rf,rv,paths,kind,act));YY[1].extend(pm[t]/weight for t in paths);WW[1].extend([weight/len(paths)]*len(paths))
   if kind.startswith('3'):
    for pair,weight in pm.items():
     paths=[pair+(c,) for c in cars if c not in pair];XX[2].append(seq_features(r,rf,rv,paths,kind,act));YY[2].extend(d[t]/weight for t in paths);WW[2].extend([weight/len(paths)]*len(paths))
 seq=[]
 for j in range(3):
  X=np.concatenate(XX[j]);y=np.asarray(YY[j])*100;w=np.asarray(WW[j]);w=w/w.mean();seq.append(reg().fit(X,y,sample_weight=w));print(json.dumps({'stage':stage,'sequence_position':j+1,'training_rows':len(y)}),flush=True)
 RX=np.asarray(RX,dtype=np.float32);raceX=np.asarray(raceX,dtype=np.float32)
 fav=clf().fit(RX,hon);winner=clf().fit(RX,win);bm=clf().fit(RX[BI],back)
 fam=make_pipeline(StandardScaler(),LogisticRegression(C=.05,max_iter=1000,random_state=634)).fit(raceX,family)
 count=ExtraTreesRegressor(n_estimators=120,min_samples_leaf=15,random_state=634,n_jobs=3).fit(raceX,counts)
 return {'sequence':seq,'actions':actionmodels,'favorite':fav,'winner':winner,'back':bm,'family':fam,'count':count,'policy':POLICY,'training_forecast_ids':[data[i]['forecast_id'] for i in indices],'trained_races':len(indices),'trained_through':max(data[i]['date'] for i in indices),'action_crossfit_proof':proof}

def candidate_scores(model,r,features):
 rf,rv=features;cars=sorted(rv);RX=np.asarray([rf+rv[c] for c in cars],dtype=np.float32);AS=action_scores(model['actions'],RX);act={c:AS[j].tolist() for j,c in enumerate(cars)}
 fp=model['family'].predict_proba([rf])[0];kind=KINDS[int(model['family'].classes_[int(np.argmax(fp))])]
 firsts=[(c,) for c in cars];p1=np.maximum(model['sequence'][0].predict(seq_features(r,rf,rv,firsts,kind,act)),.0001);p1/=p1.sum();P1=dict(zip(cars,p1))
 pairs=list(itertools.permutations(cars,2));p2=np.maximum(model['sequence'][1].predict(seq_features(r,rf,rv,pairs,kind,act)),.0001);P2={}
 for c in cars:
  jj=[j for j,t in enumerate(pairs) if t[0]==c];total=sum(p2[j] for j in jj)
  for j in jj:P2[pairs[j]]=p2[j]/total
 if kind.startswith('3'):
  paths=list(itertools.permutations(cars,3));p3=np.maximum(model['sequence'][2].predict(seq_features(r,rf,rv,paths,kind,act)),.0001);den=collections.Counter()
  for t,v in zip(paths,p3):den[t[:2]]+=v
  scores={t:P1[t[0]]*P2[t[:2]]*v/den[t[:2]] for t,v in zip(paths,p3)}
 else:scores={t:P1[t[0]]*P2[t] for t in pairs}
 if '複' in kind:
  grouped=collections.Counter()
  for t,v in scores.items():grouped[tuple(sorted(t))]+=v
  scores=dict(grouped)
 assert abs(sum(scores.values())-1)<1e-5
 return kind,scores,act,RX,cars

def infer(model,r,features,budget=10000):
 rf,rv=features;kind,scores,act,RX,cars=candidate_scores(model,r,features);ranked=sorted(scores,key=lambda t:(-scores[t],t));count=max(1,min(len(ranked),budget//100,int(round(model['count'].predict([rf])[0]))));chosen=ranked[:count];amounts=allocate([scores[t] for t in chosen],budget)
 tickets=[{'cars':list(t),'yen':v,'allocation_score':float(scores[t])} for t,v in zip(chosen,amounts)]
 fav=model['favorite'].predict_proba(RX)[:,1];win=model['winner'].predict_proba(RX)[:,1];back=model['back'].predict_proba(RX)[:,1]
 first=chosen[0][0];loc={c:(li,p) for li,l in enumerate(r['lines']) for p,c in enumerate(l)};li,pos=loc.get(first,(-1,-1));main=r['lines'][li] if li>=0 else [];steps=[]
 if '複' in kind:text=f"上位の組合せは{'-'.join(map(str,chosen[0]))}。着順を固定せず、この組合せを中心に置く。"
 elif pos==-1:text=f"{first}番を1着の中心に置く。ただしライン位置が未確認のため、仕掛けと追走関係は未確定。"
 elif len(main)==1:
  action='捲り' if act[first][1]>=act[first][7] else '直線伸び';steps=[{'actor':first,'action':action,'status':'model_hypothesis'}];text=f"単騎の{first}番が{'捲りで前を捉える' if action=='捲り' else '直線で伸びる'}筋を本線に置く。追走位置は固定しない。"
 else:
  lead=main[0];action='先行' if act[lead][0]>=act[lead][1] else '捲り';steps=[{'actor':lead,'action':action,'status':'model_hypothesis'}]
  if pos==0:text=f"{lead}番が{'先行で主導権を取る' if action=='先行' else '捲りを決める'}筋から、{first}番の1着を中心に組み立てる。"
  elif pos==1:steps.append({'actor':first,'action':'番手抜出','status':'model_hypothesis'});text=f"{lead}番が{'先行で運ぶ' if action=='先行' else '捲りで進出する'}展開から、番手の{first}番が抜け出す筋を本線に置く。"
  else:steps.append({'actor':first,'action':'直線伸び','status':'model_hypothesis'});text=f"{lead}番の仕掛けを追走する形から、ライン{pos+1}番手の{first}番が直線で浮上する筋を狙う。"
 if len(chosen[0])>=2 and '単' in kind:
  second=chosen[0][1]
  if second in loc and first in loc and loc[second][0]!=loc[first][0]:text+=f"2着は別線の{second}番を上位に取り、ラインをまたぐ決着を想定する。"
 alt=next((t for t in chosen if t[0]!=first),None)
 if alt and '単' in kind:text+=f"別筋は{alt[0]}番の1着で、{'-'.join(map(str,alt))}を押さえる。"
 text+=f"{kind}{count}点、合計{budget:,}円。"
 return {'race_id':r['race_id'],'date':r['date'],'kind':kind,'tickets':tickets,'budget_yen':budget,'commentary':text,'structured_hypothesis':steps,'actor_action_scores':{str(c):{a:float(v) for a,v in zip(ACTION_NAMES,act[c])} for c in cars},
  'teacher_favorite_scores':{str(c):float(v) for c,v in zip(cars,fav)},'actual_winner_scores':{str(c):float(v) for c,v in zip(cars,win)},'actual_B_scores':{str(c):float(v) for c,v in zip(cars,back)},
  'explanation_limit':'Weakly supervised hypotheses, not recovered private thought or observed actions. Commentary is original deterministic rendering. No wind, current comments or psychological facts are asserted.'}

def evaluate(model,data,features,indices,label,out):
 rows=[];fav=[];wins=[];bs=[];rec=[];mass=[];jacc=[];family=[];pointmae=[];Y=[];PY=[]
 for ii in indices:
  r=data[ii];lab=r['labels'];p=infer(model,r,features[ii]);kind=p['kind'];selected={tuple(t['cars']) for t in p['tickets']};target={tuple(t['cars']):t['yen'] for t in lab['tickets'].get(kind,[])};inter=set(target)&selected;tc=sum(map(len,lab['tickets'].values()))
  rec.append(len(inter)/tc);mass.append(sum(target[t] for t in inter)/lab['gross_stake']);jacc.append(len(inter)/(tc+len(selected)-len(inter)));pointmae.append(abs(len(selected)-tc));primary=max(lab['tickets'],key=lambda k:sum(t['yen'] for t in lab['tickets'][k]));family.append(kind==primary)
  fav.append(max(p['teacher_favorite_scores'],key=p['teacher_favorite_scores'].get)==str(lab['honmei']));winner=next((c for c,v in lab['finish'].items() if v==1),None);wins.append(max(p['actual_winner_scores'],key=p['actual_winner_scores'].get)==winner)
  if lab['back']:bs.append(int(max(p['actual_B_scores'],key=p['actual_B_scores'].get)) in lab['back'])
  finish=sorted(lab['finish'],key=lab['finish'].get);k=3 if kind.startswith('3') else 2;winning=tuple(map(int,finish[:k]));winning=tuple(sorted(winning)) if '複' in kind else winning
  void=set(lab['cancelled']);active=[t for t in p['tickets'] if not set(t['cars'])&void];spent=sum(t['yen'] for t in active);paylist=[payout(t,kind,lab) for t in active];pay=None if not lab['payments'] or any(x is None for x in paylist) else sum(paylist)
  for c,s in p['actor_action_scores'].items():
   Y.append([int(any(e['actor']==int(c) and e['action']==a and not e['negated'] for e in lab['events'])) for a in ACTION_NAMES]);PY.append([int(s[a]>=.5) for a in ACTION_NAMES])
  rows.append({'forecast_id':r['forecast_id'],'race_id':r['race_id'],'date':r['date'],'field_size':len(r['roster']),'kind':kind,'tickets':p['tickets'],'commentary':p['commentary'],'structured_hypothesis':p['structured_hypothesis'],'teacher_ticket_recall':rec[-1],'teacher_stake_coverage':mass[-1],'hit':winning in selected,'planned_stake':10000,'refunded_stake':10000-spent,'spent_stake':spent,'payout':pay})
 ev=[x for x in rows if x['payout'] is not None];stake=sum(x['spent_stake'] for x in ev);pay=sum(x['payout'] for x in ev)
 metrics={'period_label':label,'races':len(indices),'teacher_favorite_top1':float(np.mean(fav)),'teacher_ticket_recall_macro':float(np.mean(rec)),'teacher_ticket_jaccard_macro':float(np.mean(jacc)),'teacher_stake_coverage_macro':float(np.mean(mass)),'primary_family_accuracy':float(np.mean(family)),'ticket_count_MAE':float(np.mean(pointmae)),
  'actual_winner_top1':float(np.mean(wins)),'actual_B_top1':float(np.mean(bs)) if bs else None,'actor_action_label_micro_F1':float(f1_score(Y,PY,average='micro',zero_division=0)),'selected_ticket_hit_rate':float(np.mean([x['hit'] for x in rows])),'payment_evaluable':len(ev),'stake_yen':stake,'payout_yen':pay,'return_percent':100*pay/stake if stake else None,'new_untouched_test':False,'prospective':False,'note':POLICY['validation']}
 dump(out/f'{label}_metrics.json',metrics);dump(out/f'{label}_predictions.json',rows);print(json.dumps({'stage':'evaluation',**metrics},ensure_ascii=False),flush=True);return metrics

def predict_input(model,r,budget):
 allowed={'date','race_id','venue','race_no','roster','lines','unknown_cars','names'}
 if set(r)-allowed:raise ValueError('Unexpected or answer-bearing input keys')
 if r['date']<=model['history_through']:raise ValueError('Serving history is later than this input; historical predictions need a frozen historical snapshot')
 cars=r['roster'];known=[c for l in r['lines'] for c in l]
 if not 5<=len(cars)<=9 or len(set(cars))!=len(cars) or len(set(known))!=len(known) or set(known)&set(r['unknown_cars']) or set(known)|set(r['unknown_cars'])!=set(cars):raise ValueError('Invalid known/unknown line membership')
 if set(r['names'])!=set(map(str,cars)) or any(not isinstance(v,str) or not v.strip() for v in r['names'].values()):raise ValueError('Full names required for each roster entry')
 if not re.fullmatch(r'\d{12}',r['race_id']) or not r['race_id'].startswith(r['date']) or int(r['race_id'][8:10])!=r['venue'] or int(r['race_id'][10:])!=r['race_no']:raise ValueError('Race identifier mismatch')
 r=copy.deepcopy(r);r['lines']=sorted(r['lines'],key=lambda l:tuple(l));r['history_keys']=r['names'];return infer(model,r,features_for(r,model['history']),budget)

def run(out):
 out.mkdir(parents=True,exist_ok=True)
 if (out/'dataset.json.gz').exists():
  with gzip.open(out/'dataset.json.gz','rt',encoding='utf-8') as f:data=json.load(f)
 else:data=build(out)
 features,history=all_features(data);folds=[('20250930','20251231','fold_2025Q4'),('20260331','20260630','fold_2026Q2'),('20260630','20261121','fold_2026JulNov')];metrics=[];manifests=[]
 for end,until,label in folds:
  ids=[i for i,r in enumerate(data) if r['date']<=end];ev=[i for i,r in enumerate(data) if end<r['date']<=until];modelpath=out/(label+'_model.joblib')
  if modelpath.exists():model=joblib.load(modelpath)
  else:model=fit_model(data,features,ids,label);joblib.dump(model,modelpath,compress=3)
  assert model['trained_through']<min(data[i]['date'] for i in ev)
  metrics.append(evaluate(model,data,features,ev,label,out));manifests.append({'label':label,'trained_forecast_ids':[data[i]['forecast_id'] for i in ids],'evaluation_forecast_ids':[data[i]['forecast_id'] for i in ev],'trained_through':end,'evaluation_through':until,'action_crossfit':model['action_crossfit_proof']})
  dump(out/'fold_manifest.json',{'folds':manifests,'policy':POLICY})
 serving=fit_model(data,features,list(range(len(data))),'all_7126');serving['history']=history;serving['history_through']=max(r['date'] for r in data);joblib.dump(serving,out/'serving_model.joblib',compress=3)
 dump(out/'summary.json',{'all_records':len(data),'all_records_trained':serving['trained_races'],'fold_metrics':metrics,'policy':POLICY,'feature_names':{'race':RACE_NAMES,'rider':RIDER_NAMES,'action':ACTION_NAMES}})
 print(json.dumps({'stage':'complete','trained':len(data),'out':str(out)},ensure_ascii=False),flush=True)

def main():
 p=argparse.ArgumentParser();sub=p.add_subparsers(dest='command',required=True);a=sub.add_parser('train');a.add_argument('--out',default='mrt_logic_v2_all');b=sub.add_parser('predict');b.add_argument('--model',required=True);b.add_argument('--input',required=True);b.add_argument('--output',required=True);b.add_argument('--budget',type=int,default=10000);args=p.parse_args()
 if args.command=='train':run(pathlib.Path(args.out))
 else:
  if args.budget<100 or args.budget%100:raise ValueError('Budget must be a positive 100-yen multiple')
  result=predict_input(joblib.load(args.model),load(args.input),args.budget);dump(args.output,result);print(result['commentary'])

if __name__=='__main__':main()
