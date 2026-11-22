"""Research imitation engine. No current teacher answer is an inference feature."""
import os
os.environ.setdefault('OMP_NUM_THREADS', '3')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '3')
import argparse, collections, datetime as dt, gzip, hashlib, html, itertools, json
import pathlib, re, sys, unicodedata
import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor, HistGradientBoostingClassifier, ExtraTreesRegressor
from sklearn.metrics import mean_absolute_error, f1_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression

ROOT=pathlib.Path(__file__).resolve().parent
KINDS=['3連単','2車単','3連複','2車複']
TAGS={'主導権':r'先行|主導権','番手':r'番手','単騎':r'単騎','競り':r'競り|競って','切替':r'切り替|切替','追走懸念':r'離れ|追走|千切','調子':r'近況|状態|調子','人気・妙味':r'オッズ|人気|妙味','前受け・突っ張り':r'前受け|突っ張','カマシ':r'カマシ|カマし|カマして','捲り':r'捲','心理・関係':r'地元|先輩|同県|連れる','条件分岐':r'場合|なら|一方|としても'}
POLICY={'train_end':'20260331','valid_end':'20260630','test_end':'20261121','seed':634,
 'forbidden_inputs':['current_teacher_marks','current_teacher_scores','current_teacher_tickets','current_teacher_text','current_result','current_payout','current_actual_B'],
 'line_provenance':'Teacher page lineup, canonicalized; independent pre-race lineup agreement is NOT verified.',
 'history_policy':'Only previous calendar dates. All races on the same date share the same history snapshot. Held-out results may update history for later dates; fitted weights never use held-out labels.',
 'probability_limit':'Ticket scores represent imitation allocation weights, not calibrated finish probabilities. Tactical tag scores predict article keyword labels, not actual tactical events.'}

def dump(p,x): pathlib.Path(p).write_text(json.dumps(x,ensure_ascii=False,indent=2),encoding='utf-8')
def norm(s): return unicodedata.normalize('NFKC',s)
def cash(s):
 m=re.search(r'([\d,]+)円',norm(s));return int(m[1].replace(',','')) if m else None

def parse_tickets(rows):
 """Expand regular, formation and box entries; ignore annotations after the stake."""
 out=collections.defaultdict(lambda:collections.Counter()); errors=[]
 for row in rows:
  typ=norm(row[0]);kind=next((k for k in KINDS if typ.startswith(k)),None)
  if kind is None: errors.append({'type':typ,'reason':'unsupported'});continue
  k=3 if kind.startswith('3') else 2; body=norm(' '.join(row[1:])); amount=cash(body)
  tickets=[]
  if '通常' in typ:
   m=re.search(r'([1-9])\s*[>＞-]\s*([1-9])(?:\s*[>＞-]\s*([1-9]))?',body)
   if m: tickets=[tuple(int(x) for x in m.groups() if x)]
  elif 'フォーメーション' in typ:
   groups=re.findall(r'[123]着\s*([1-9]+)',body)
   if len(groups)==k:tickets=[x for x in itertools.product(*[list(map(int,g)) for g in groups]) if len(set(x))==k]
  elif 'ボックス' in typ:
   m=re.match(r'\s*([1-9]+)',body)
   if m:
    cars=list(map(int,m[1]));tickets=list(itertools.combinations(cars,k) if '複' in kind else itertools.permutations(cars,k))
  if not tickets or amount is None or any(len(x)!=k for x in tickets): errors.append({'type':typ,'reason':'parse_failed'});continue
  for t in tickets:
   if '複' in kind:t=tuple(sorted(t))
   if len(set(t))!=k: errors.append({'type':typ,'reason':'repeated_car'});continue
   out[kind][t]+=amount
 return {k:dict(v) for k,v in out.items()},errors

def diag_names(source):
 m=re.search(r'<section class="DeployYoso"[^>]*>(.*?)</section>',source,re.S)
 if not m:return {}
 return {int(n):html.unescape(re.sub('<[^>]*>','',s)).strip() for n,s in re.findall(r'class="[^"<>]*Shaban_Num"[^>]*>([1-9])</span>(.*?)</div>',m[1],re.S)}

def prep(out):
 rs=json.loads((ROOT/'mrt_2026_11/cumulative_structured_records.json').read_text()); data=[]; rejected=[]
 for month in sorted(set(r['date'][:6] for r in rs)):
  sub=[r for r in rs if r['date'].startswith(month)]
  raw={x['forecast_id']:x for x in json.loads((ROOT/f'mrt_{month[:4]}_{month[4:]}'/'records.json').read_text())}
  for r in sub:
   fid=r['forecast_id'];src=(ROOT/f'mrt_{month[:4]}_{month[4:]}'/(fid+'.html')).read_text()
   lines=sorted([list(x) for x in r['prediction_facts']['published_lines']],key=lambda x:tuple(x));cars=sorted(x for l in lines for x in l)
   ts,err=parse_tickets(r['tickets']); expected=cash(r['amounts'].get('合計',''));total=sum(sum(v.values()) for v in ts.values())
   names=diag_names(src)
   if err or total!=expected or len(cars)!=len(set(cars)) or not 5<=len(cars)<=9 or set(names)!=set(cars) or any(set(t)-set(cars) for v in ts.values() for t in v):
    rejected.append({'forecast_id':fid,'errors':err,'parsed_stake':total,'listed_stake':expected,'field':cars,'names':list(names)});continue
   finish={int(x[2]):int(x[0]) for x in r['finish_rows'] if x[0].isdigit()}
   measured=r.get('measured_result',{});full_names={int(x[2]):x[3].split()[0] for x in measured.get('finish_rows',[])}
   scores={x['car']:x['score'] for x in r['prediction_facts']['marked_riders'] if x['score'] is not None}
   # These are labels/update-only; none of this dict is passed to feature().
   labels={'tickets':{k:[{'cars':list(t),'yen':v} for t,v in d.items()] for k,d in ts.items()},'honmei':next((x['car'] for x in r['prediction_facts']['marked_riders'] if x['mark']=='Honmei'),None),
    'finish':finish,'back':measured.get('back_cars',[]) if measured.get('status')=='result_received' else None,
    'scores_after_race':scores,'full_names_identity_only':full_names,'tags':r['logic_tags'],
    'payments':measured.get('payment_rows',[]),'stake':total,'teacher_payout':cash(r['amounts'].get('払い戻し金額',''))}
   race_id=r['race_ids'][0]
   data.append({'forecast_id':fid,'race_id':race_id,'date':r['date'],'venue':int(race_id[8:10]),'race_no':int(race_id[10:]),'lines':lines,'names':names,'source_url':r['source_url'],'source_sha256':r['sha256'],'labels':labels})
  print(json.dumps({'stage':'prepare','month':month,'included':len(data),'rejected':len(rejected)}),flush=True)
 # Normalize mapping keys exactly as they will appear in the portable JSON dataset.
 data=json.loads(json.dumps(data,ensure_ascii=False))
 data.sort(key=lambda r:(r['date'],r['race_id']))
 dump(out/'data_audit.json',{'raw_records':len(rs),'usable_records':len(data),'rejected':rejected,'policy':POLICY})
 with gzip.open(out/'learning_dataset.json.gz','wt',encoding='utf-8') as f:json.dump(data,f,ensure_ascii=False)
 return data

HISTORY_FIELDS=['prior_starts','prior_win_rate','prior_top3_rate','prior_rank_strength','prior_B_rate','prior_B_starts','prior_score','prior_score_missing','prior_score_age_days']
RACE_FIELDS=['field_size','line_count','single_count','longest_line','venue','race_no','year_month_sin','year_month_cos']+[f'line_len_{i}' for i in range(5)]
RIDER_FIELDS=['car','position','line_len','is_leader','is_second','is_single']+HISTORY_FIELDS+['score_vs_field','strength_vs_field']

def daynum(s):return dt.datetime.strptime(s,'%Y%m%d').date().toordinal()
def race_features(r):
 lengths=sorted([len(x) for x in r['lines']],reverse=True);month=int(r['date'][4:6])
 return [sum(lengths),len(lengths),lengths.count(1),max(lengths),r['venue'],r['race_no'],float(np.sin(month*np.pi/6)),float(np.cos(month*np.pi/6))]+(lengths+[0]*5)[:5]

def hist_vector(h,day):
 n=h.get('n',0);b=h.get('bn',0);score=h.get('score',0)
 return [n,(h.get('win',0)+1)/(n+7),(h.get('top3',0)+3)/(n+7),(h.get('strength',0)+3.5)/(n+7),(h.get('B',0)+1)/(b+7),b,score,0 if score else 1,min(999,day-h.get('score_day',day)) if score else 999]

def rider_features(r,hist):
 day=daynum(r['date']); d={}
 for line in r['lines']:
  for pos,c in enumerate(line):
   key=r.get('history_keys',r['names']).get(str(c))
   h=hist_vector(hist.get(key,{}) if key else {},day)
   d[c]=[c,pos,len(line),int(pos==0),int(pos==1),int(len(line)==1)]+h
 scores=[x[12] for x in d.values() if x[12]>0];avg=float(np.mean(scores)) if scores else 0; strength=float(np.mean([x[9] for x in d.values()]))
 for c in d:d[c]+=[d[c][12]-avg if d[c][12]>0 else 0,d[c][9]-strength]
 return d

def update_history(r,hist):
 lab=r['labels'];date=daynum(r['date']);n=sum(map(len,r['lines']))
 for car,name in r['names'].items():
  key=r.get('history_keys',r['names']).get(car)
  if not key:continue
  c=int(car);h=hist.setdefault(key,{});rank=lab['finish'].get(car)
  if rank:
   h['n']=h.get('n',0)+1;h['win']=h.get('win',0)+int(rank==1);h['top3']=h.get('top3',0)+int(rank<=3);h['strength']=h.get('strength',0)+(n-rank)/(n-1)
  if lab['back'] is not None:h['bn']=h.get('bn',0)+1;h['B']=h.get('B',0)+int(c in lab['back'])
  score=lab['scores_after_race'].get(car)
  if score is not None:h['score']=score;h['score_day']=date

def candidates(r,kind):
 cars=sorted(int(c) for c in r['names']);k=3 if kind.startswith('3') else 2
 return list(itertools.combinations(cars,k) if '複' in kind else itertools.permutations(cars,k))

def ticket_features(r,rf,rv,ts,kind):
 where={c:(i,p) for i,l in enumerate(r['lines']) for p,c in enumerate(l)};result=[]
 for t in ts:
  x=rf+[int(kind==k) for k in KINDS]
  for i in range(3):x+=rv[t[i]] if i<len(t) else [0]*len(RIDER_FIELDS)
  for a,b in [(0,1),(0,2),(1,2)]:
   if b<len(t):
    la,pa=where[t[a]];lb,pb=where[t[b]];x += [int(la==lb),pb-pa if la==lb else 0,int(la==lb and pb==pa+1)]
   else:x += [0,0,0]
  result.append(x)
 return np.asarray(result,dtype=np.float32)

def make_features(data):
 hist={};features=[]
 for date,grp in itertools.groupby(data,key=lambda r:r['date']):
  batch=list(grp)
  for r in batch:features.append((race_features(r),rider_features(r,hist)))
  for r in batch:update_history(r,hist)
 return features,hist

def model_reg(leaves=15,iters=70):return HistGradientBoostingRegressor(max_iter=iters,max_leaf_nodes=leaves,learning_rate=.08,l2_regularization=3,early_stopping=False,random_state=634)
def model_cls():return HistGradientBoostingClassifier(max_iter=90,max_leaf_nodes=15,l2_regularization=3,early_stopping=False,random_state=634)

def fit(data,features,indices,leaves,stage):
 X=[];Y=[];W=[];RX=[];hon=[];wins=[];backs=[];Binds=[];raceX=[];counts=[];families=[];tagY=[]
 for ii in indices:
  r=data[ii];rf,rv=features[ii];lab=r['labels'];raceX.append(rf);tagY.append([int(t in lab['tags']) for t in TAGS])
  bykind=lab['tickets'];dominant=max(bykind,key=lambda k:sum(t['yen'] for t in bykind[k]));families.append(KINDS.index(dominant));counts.append(len(bykind[dominant]))
  for c in sorted(rv):
   RX.append(rf+rv[c]);hon.append(int(c==lab['honmei']));wins.append(int(lab['finish'].get(str(c))==1))
   if lab['back'] is not None:Binds.append(len(RX)-1);backs.append(int(c in lab['back']))
  for kind,tt in bykind.items():
   ts=candidates(r,kind);target={tuple(t['cars']):t['yen'] for t in tt};total=sum(target.values());xs=ticket_features(r,rf,rv,ts,kind)
   X.append(xs);Y.extend([target.get(t,0)/total for t in ts]);W.extend([1/len(ts)]*len(ts))
 X=np.concatenate(X);Y=np.asarray(Y,dtype=np.float32);W=np.asarray(W,dtype=np.float32);RX=np.asarray(RX,dtype=np.float32);raceX=np.asarray(raceX,dtype=np.float32)
 print(json.dumps({'stage':stage,'races':len(indices),'candidate_rows':len(Y),'leaves':leaves}),flush=True)
 # Rescale mean allocation to help regression; mean across possible tickets is ~1/N.
 ticket=model_reg(leaves);ticket.fit(X,Y*100,sample_weight=W*len(W)/len(indices));del X,Y,W
 favorite=model_cls().fit(RX,hon);winner=model_cls().fit(RX,wins)
 back=model_cls().fit(RX[Binds],backs) if Binds else None
 # Multiclass tree Newton updates are unstable for the very rare mixed-ticket
 # families. Use a strongly regularized multinomial classifier (chosen on VALID).
 family=make_pipeline(StandardScaler(),LogisticRegression(C=.05,max_iter=500,random_state=634)).fit(raceX,families)
 count=ExtraTreesRegressor(n_estimators=120,min_samples_leaf=15,max_features=.9,random_state=634,n_jobs=3).fit(raceX,np.log1p(counts))
 tags=[];tagY=np.asarray(tagY)
 for j in range(len(TAGS)):
  if len(set(tagY[:,j]))==1:tags.append(float(tagY[0,j]))
  else:tags.append(model_cls().fit(raceX,tagY[:,j]))
 return {'ticket':ticket,'favorite':favorite,'winner':winner,'back':back,'family':family,'count':count,'tags':tags,'leaves':leaves,'policy':POLICY,'trained_races':len(indices)}

def allocate(scores,budget):
 units=budget//100
 if units<len(scores):raise ValueError('Budget is below the number of 100-yen ticket units')
 weights=np.maximum(np.asarray(scores),1e-9);rest=units-len(weights);raw=rest*weights/weights.sum();u=1+np.floor(raw).astype(int)
 for i in np.argsort(-(raw-np.floor(raw)))[:units-int(u.sum())]:u[i]+=1
 return [int(x*100) for x in u]

def blend_scores(score,ts,kind,favorite,power):
 if not power:return score
 if '単' in kind:factor=np.asarray([favorite[t[0]] for t in ts])
 else:factor=np.asarray([np.prod([favorite[c] for c in t])**(1/len(t)) for t in ts])
 return score*np.maximum(factor,.005)**power

def select_postprocessing(model,data,features,indices,out):
 """Select count calibration on MAE, then favorite stacking on teacher coverage.
 Only VALID labels are read; no TEST predictions or outcomes participate.
 """
 rf=[features[i][0] for i in indices];base=np.expm1(model['count'].predict(rf));truth=np.asarray([sum(map(len,data[i]['labels']['tickets'].values())) for i in indices])
 scales=[.7,1.,1.3,1.6,2.];mae=[float(np.mean(abs(np.maximum(1,np.rint(base*s))-truth))) for s in scales];scale=scales[int(np.argmin(mae))]
 cache=[]
 for j,i in enumerate(indices):
  r=data[i];rx,rv=features[i];cars=sorted(rv);fp=model['favorite'].predict_proba(np.asarray([rx+rv[c] for c in cars],dtype=np.float32))[:,1];favorite=dict(zip(cars,fp))
  f=model['family'].predict_proba([rx])[0];kind=KINDS[int(model['family'].classes_[np.argmax(f)])];ts=candidates(r,kind);score=np.maximum(model['ticket'].predict(ticket_features(r,rx,rv,ts,kind)),0)
  if not score.sum():score=np.ones(len(ts))
  target={tuple(t['cars']):t['yen'] for t in r['labels']['tickets'].get(kind,[])};count=max(1,min(len(ts),100,int(round(base[j]*scale))))
  cache.append((ts,score,favorite,kind,target,r['labels']['stake'],count))
 powers=[0.,.5,1.,2.];coverage=[]
 for power in powers:
  values=[]
  for ts,score,fav,kind,target,total,k in cache:
   s=blend_scores(score,ts,kind,fav,power);order=np.argsort(-s,kind='stable')[:k];values.append(sum(target.get(ts[j],0) for j in order)/total)
  coverage.append(float(np.mean(values)))
 power=powers[int(np.argmax(coverage))];model['count_scale']=scale;model['favorite_power']=power
 result={'validation_races':len(indices),'count_scale_candidates':scales,'count_MAE':mae,'selected_count_scale':scale,'favorite_power_candidates':powers,'teacher_stake_coverage':coverage,'selected_favorite_power':power,'test_used':False,'note':'Count scale chosen on count MAE, not return or overlap. Favorite stack then chosen on teacher stake coverage. No actual-result ROI criterion.'}
 dump(out/'postprocessing_selection.json',result);print(json.dumps({'stage':'validated_postprocessing',**result}),flush=True)
 return model

def infer(model,r,features,budget=10000,force_kind=None):
 rf,rv=features;cars=sorted(rv);RX=np.asarray([rf+rv[c] for c in cars],dtype=np.float32)
 fav=model['favorite'].predict_proba(RX)[:,1];win=model['winner'].predict_proba(RX)[:,1]
 back=model['back'].predict_proba(RX)[:,1] if model['back'] else np.ones(len(cars))
 fp=model['family'].predict_proba([rf])[0];kind=force_kind or KINDS[int(model['family'].classes_[np.argmax(fp)])]
 ts=candidates(r,kind);score=np.maximum(model['ticket'].predict(ticket_features(r,rf,rv,ts,kind)),0)
 if score.sum()<=0:score=np.ones(len(ts))
 score=blend_scores(score,ts,kind,dict(zip(cars,fav)),model.get('favorite_power',0))
 order=np.argsort(-score,kind='stable');k=max(1,min(len(ts),budget//100,int(round(np.expm1(model['count'].predict([rf])[0])*model.get('count_scale',1)))))
 chosen=order[:k];yen=allocate(score[chosen],budget)
 tagscore={t:float(m if isinstance(m,float) else m.predict_proba([rf])[0,1]) for t,m in zip(TAGS,model['tags'])}
 tickets=[{'cars':list(ts[i]),'yen':v,'allocation_score':float(score[i]/score.sum())} for i,v in zip(chosen,yen)]
 lines=r['lines'];loc={c:(j,pos) for j,l in enumerate(lines) for pos,c in enumerate(l)}
 best=tickets[0]['cars'];first=best[0];li,pos=loc[first];main=lines[li];lead=main[0]
 where='先頭' if pos==0 else '番手' if pos==1 else f'{pos+1}番手'
 premise=f"{ '-'.join(map(str,main)) }のラインを軸に、{first}番の{where}からの進出を中心に組み立てる。"
 if '単' in kind and pos==1:premise=f"{lead}番がライン先頭で運ぶ形から、番手の{first}番が交わす筋を本線に置く。"
 elif '単' in kind and pos==0:premise=f"{first}番を先頭とするラインの決着を上位に評価し、{first}番の押し切り・捲り切りを本線に置く。"
 if len(main)==1:premise=f"単騎の{first}番が上位へ進出する筋を中心に置く。位置取りは未確認のため、他ラインへの追走位置までは決めつけない。"
 hist=rv[first];past=int(hist[6]);strength=hist[9]
 evidence=f"この研究対象内で昨日以前に記録した{first}番の出走は{past}件。" if past else f"{first}番の過去出走は研究対象内で未蓄積。ライン構成を中心とした暫定評価になる。"
 alt=next((t for t in tickets if '単' in kind and t['cars'][0]!=first),None)
 alt_text=f"別筋は{alt['cars'][0]}番の頭で、{'-'.join(map(str,alt['cars']))}を押さえる。" if alt else '別の1着を広げず、採用した組合せの範囲で配分する。'
 text=premise+evidence+alt_text+f"{kind}{len(tickets)}点、合計{budget:,}円。現時点で風・近況コメント・当日の動きは入力していないため、その根拠は付け加えない。"
 return {'race_id':r['race_id'],'date':r['date'],'engine':'TK_MRT_LOGIC_RESEARCH_V1','kind':kind,'tickets':tickets,'budget_yen':budget,'main_ticket':'-'.join(map(str,best)),
  'commentary':text,'explanation_type':'Original deterministic rendering of learned ticket ranking and observable input facts; not article reconstruction or recovered hidden thought.',
  'teacher_favorite_model':{str(c):float(p) for c,p in zip(cars,fav)},'actual_winner_model_uncalibrated':{str(c):float(p) for c,p in zip(cars,win)},'actual_B_model_uncalibrated':{str(c):float(p) for c,p in zip(cars,back)},
  'article_keyword_model':tagscore,'input_limit':POLICY['line_provenance']}

def payout(ticket,kind,labels):
 """Return official published per-100-yen payoff; None if no result payment data."""
 if not labels['payments']:return None
 active=None;total=0
 for row in labels['payments']:
  a=norm(row[0]);family=next((k for k in KINDS if a.startswith(k)),None)
  if family:active=family;key=row[1] if len(row)>1 else '';amount=row[2] if len(row)>2 else ''
  elif re.fullmatch(r'[1-9][-＞>][1-9](?:[-＞>][1-9])?',a):key=row[0];amount=row[1] if len(row)>1 else ''
  else:active=None;continue
  if active!=kind:continue
  nums=tuple(map(int,re.findall('[1-9]',key)))
  if '複' in kind:nums=tuple(sorted(nums))
  if nums==tuple(ticket['cars']):total+=(cash(amount) or 0)*ticket['yen']//100
 return total

def evaluate(model,data,features,indices,label,out=None):
 results=[];favok=[];winok=[];bok=[];fams=[];recall=[];jacc=[];mass=[];counts=[];dist=[];hit=[];pays=[];stakes=[];examples=[];actual_tags=[];pred_tags=[]
 for ii in indices:
  r=data[ii];lab=r['labels'];pred=infer(model,r,features[ii]);kind=pred['kind'];tt=lab['tickets'].get(kind,[]);target={tuple(x['cars']):x['yen'] for x in tt};primary=max(lab['tickets'],key=lambda k:sum(t['yen'] for t in lab['tickets'][k]))
  selected={tuple(t['cars']) for t in pred['tickets']};union=selected|set(target);inter=selected&set(target)
  fams.append(kind==primary);favok.append(max(pred['teacher_favorite_model'],key=pred['teacher_favorite_model'].get)==str(lab['honmei']))
  winner=next((c for c,v in lab['finish'].items() if v==1),None);winok.append(max(pred['actual_winner_model_uncalibrated'],key=pred['actual_winner_model_uncalibrated'].get)==winner)
  if lab['back']:bok.append(int(max(pred['actual_B_model_uncalibrated'],key=pred['actual_B_model_uncalibrated'].get)) in lab['back'])
  # All-race metrics penalize choosing the wrong family; target is all teacher coupons.
  total_teacher_count=sum(len(x) for x in lab['tickets'].values());total_teacher_stake=lab['stake']
  recall.append(len(inter)/total_teacher_count);jacc.append(len(inter)/(len(selected)+total_teacher_count-len(inter)));mass.append(sum(target[t] for t in inter)/total_teacher_stake)
  counts.append(abs(len(pred['tickets'])-total_teacher_count))
  finish=sorted(lab['finish'],key=lambda c:lab['finish'][c]);k=3 if kind.startswith('3') else 2;winning=tuple(map(int,finish[:k])) if len(finish)>=k else ()
  if '複' in kind:winning=tuple(sorted(winning))
  hit.append(winning in selected)
  pay=[payout(t,kind,lab) for t in pred['tickets']];paytotal=None if any(x is None for x in pay) else sum(pay)
  if paytotal is not None:pays.append(paytotal);stakes.append(pred['budget_yen'])
  actual_tags.append([int(t in lab['tags']) for t in TAGS]);pred_tags.append([int(pred['article_keyword_model'][t]>=.5) for t in TAGS])
  results.append({'forecast_id':r['forecast_id'],'race_id':r['race_id'],'date':r['date'],'kind':kind,'ticket_count':len(selected),'teacher_overlap':len(inter),'teacher_recall':recall[-1],'teacher_stake_coverage':mass[-1],'hit':hit[-1],'stake':pred['budget_yen'],'payout':paytotal,'tickets':pred['tickets'],'commentary':pred['commentary']})
  if len(examples)<4:examples.append(pred)
 metrics={'split':label,'races':len(indices),'teacher_favorite_top1':float(np.mean(favok)),'actual_winner_top1':float(np.mean(winok)),'actual_B_top1':float(np.mean(bok)) if bok else None,'actual_B_evaluable':len(bok),'primary_family_accuracy':float(np.mean(fams)),
  'teacher_ticket_recall_macro':float(np.mean(recall)),'teacher_ticket_jaccard_macro':float(np.mean(jacc)),'teacher_stake_coverage_macro':float(np.mean(mass)),'ticket_count_MAE':float(np.mean(counts)),
  'article_keyword_micro_F1':float(f1_score(actual_tags,pred_tags,average='micro',zero_division=0)),'selected_ticket_hit_rate':float(np.mean(hit)),
  'result_payment_evaluable':len(stakes),'stake_yen':sum(stakes),'payout_yen':sum(pays),'return_percent':100*sum(pays)/sum(stakes) if stakes else None,
  'fees_included':False,'prospective_proof':False,'source_lineup_independent':False}
 print(json.dumps({'stage':'evaluate',**metrics}),flush=True)
 if out:
  dump(out/f'{label}_metrics.json',metrics);dump(out/f'{label}_predictions.json',results);dump(out/f'{label}_examples.json',examples)
 return metrics

def validate_input(r,history):
 # Explicit allowlist ensures result/teacher fields cannot be smuggled into inference.
 allowed={'date','race_id','venue','race_no','lines','names'}
 if set(r)-allowed:raise ValueError('Unsupported input keys: '+str(sorted(set(r)-allowed)))
 if not re.fullmatch(r'\d{8}',r['date']):raise ValueError('date must be YYYYMMDD')
 if r['date']<=history['through_date']:raise ValueError('Use a date later than the serving history cutoff; historical prediction needs its own historical snapshot')
 lines=r['lines'];cars=[c for l in lines for c in l]
 if not all(lines) or not 5<=len(cars)<=9 or len(cars)!=len(set(cars)) or any(type(c)!=int or not 1<=c<=9 for c in cars):raise ValueError('Invalid field/line membership')
 if set(map(str,cars))!=set(r['names']) or len(set(r['names'].values()))!=len(cars):raise ValueError('Full roster names must match every car uniquely')
 if not r['race_id'].startswith(r['date']):raise ValueError('race_id/date mismatch')
 if not re.fullmatch(r'\d{12}',r['race_id']) or int(r['race_id'][8:10])!=r['venue'] or int(r['race_id'][10:])!=r['race_no']:raise ValueError('race_id/venue/race number mismatch')
 if not all(isinstance(n,str) and n.strip() for n in r['names'].values()):raise ValueError('Every full name must be a nonempty string')
 r=dict(r);r['lines']=sorted(lines,key=lambda l:tuple(l));return r

def train(out,dataset=None):
 out.mkdir(parents=True,exist_ok=True)
 cache=pathlib.Path(dataset) if dataset else ROOT/'mrt_logic_v1'/'learning_dataset.json.gz'
 if dataset or (out.name!='mrt_logic_v1' and cache.exists()):
  with gzip.open(cache,'rt',encoding='utf-8') as f:data=json.load(f)
  import shutil
  if cache.resolve()!=(out/'learning_dataset.json.gz').resolve():shutil.copy2(cache,out/'learning_dataset.json.gz')
  if (cache.parent/'data_audit.json').resolve()!=(out/'data_audit.json').resolve():shutil.copy2(cache.parent/'data_audit.json',out/'data_audit.json')
 else:data=prep(out)
 # Short display names collide (e.g. several distinct riders are shown as 佐々木).
 # Use full roster identity, never the current teacher's selected-rider list.
 # Before separate result rosters are available, disable rider history entirely.
 alias=collections.defaultdict(set)
 for r in data:
  full=r['labels']['full_names_identity_only']
  r['history_keys']={c:full.get(c) for c in r['names']}
  for c,n in r['names'].items():
   if c in full:alias[n].add(full[c])
 dump(out/'identity_audit.json',{'ambiguous_display_names':{k:sorted(v) for k,v in alias.items() if len(v)>1},'policy':'Full roster names used only as identity keys. Unresolved identities have no rider history. Current teacher selection is never used to resolve identities. Serving inputs must use full names.'})
 with gzip.open(out/'learning_dataset.json.gz','wt',encoding='utf-8') as f:json.dump(data,f,ensure_ascii=False)
 features,hist=make_features(data)
 trainids=[i for i,r in enumerate(data) if r['date']<=POLICY['train_end']];validids=[i for i,r in enumerate(data) if POLICY['train_end']<r['date']<=POLICY['valid_end']];testids=[i for i,r in enumerate(data) if r['date']>POLICY['valid_end']]
 original=ROOT/'mrt_2026_11/cumulative_structured_records.json'
 manifest={'policy':POLICY,'splits':{k:{'count':len(ids),'first':data[ids[0]]['date'],'last':data[ids[-1]]['date'],'forecast_ids':[data[i]['forecast_id'] for i in ids]} for k,ids in [('train',trainids),('valid',validids),('test',testids)]},'source_sha256':hashlib.sha256((original if original.exists() else cache).read_bytes()).hexdigest(),'source_hash_kind':'original_cumulative_records' if original.exists() else 'portable_learning_dataset'}
 dump(out/'split_manifest.json',manifest)
 best=None;bestmetric=-1;trials=[]
 for leaves in [15,31]:
  m=fit(data,features,trainids,leaves,'train_candidate');met=evaluate(m,data,features,validids,f'valid_leaves_{leaves}');trials.append({'leaves':leaves,'metrics':met})
  if met['teacher_stake_coverage_macro']>bestmetric:bestmetric=met['teacher_stake_coverage_macro'];best=m
 dump(out/'validation_selection.json',{'objective':'teacher_stake_coverage_macro','candidates':trials,'selected_leaves':best['leaves'],'test_used_for_selection':False})
 best=select_postprocessing(best,data,features,validids,out)
 joblib.dump(best,out/'evaluation_model.joblib',compress=3)
 valid=evaluate(best,data,features,validids,'valid',out);test=evaluate(best,data,features,testids,'test',out)
 # Baseline: teacher pattern prior conditional only on canonical line roles/car numbers.
 # Its model is deliberately limited to a constant per-feature family prior; compare
 # favorite score with a deterministic second-car-of-longest-line heuristic.
 baseline=[]
 for i in testids:
  r=data[i];long=max(r['lines'],key=lambda l:(len(l),-l[0]));c=long[1] if len(long)>1 else long[0];baseline.append(c==r['labels']['honmei'])
 dump(out/'baseline.json',{'longest_line_second_favorite_accuracy':float(np.mean(baseline)),'test_races':len(testids)})
 allmodel=fit(data,features,list(range(len(data))),best['leaves'],'refit_all_for_serving')
 allmodel['count_scale']=best.get('count_scale',1);allmodel['favorite_power']=best.get('favorite_power',0)
 allmodel['history']={'through_date':max(r['date'] for r in data),'riders':hist};joblib.dump(allmodel,out/'serving_model.joblib',compress=3)
 dump(out/'feature_schema.json',{'race_features':RACE_FIELDS,'rider_features':RIDER_FIELDS,'policy':POLICY,'names':'Full roster names for history keys. Display abbreviations are not used to join histories; unresolved names receive missing histories.'})
 example={k:data[-1][k] for k in ['date','race_id','venue','race_no','lines','names']};example['names']={c:data[-1]['history_keys'].get(c) or n for c,n in example['names'].items()};example['date']='20261122';example['race_id']='20261122'+example['race_id'][8:];dump(out/'input_format_example_NOT_REAL_RACE.json',example)
 report(out,data,manifest,valid,test,best['leaves'],float(np.mean(baseline)))
 print(json.dumps({'stage':'finished','output':str(out),'usable':len(data),'test':test}),flush=True)

def report(out,data,manifest,valid,test,leaves,baseline):
 audit=json.loads((out/'data_audit.json').read_text());text=f'''# TK MRT LOGIC RESEARCH V1 学習報告

対象：2025年4月14日〜2026年11月21日の公開予想7,126件。利用可能{len(data):,}件、除外{len(audit['rejected'])}件。除外理由はdata_audit.json。

## 実施した学習
買い目の券種・組合せ・金額を通常/フォーメーション/BOXから展開し、列挙した全候補への配分を勾配ブースティングで学習。本命印、実際の1着、実測Bは別分類器。券種、点数、記事キーワード分類も学習した。解説は買い目の順位、ライン位置、実在する過去履歴だけを根拠に独自文章へ整形する。記事本文の復元、本人の非公開思考の解明、自由文章モデルのファインチューニングはしていない。

## 入力と漏洩防止
現在レースの印・選択された選手の得点・買い目・記事・結果・B・払戻は特徴量に使用しない。ライン順序は車番で正規化。ライン内の順序は保持する。現在レースの並びと選手略名は予想ページ由来であり、独立した発走前出走表との一致は未確認。このため試験は「与えられた並びを条件とする事後収集データ上の検証」であり、前向き実証ではない。

履歴は前日以前のみ。同日全レースを予測後に履歴を更新する。過去得点は、その過去レースの予想ページで得点が得られた場合だけ翌日から更新する。履歴はこの予想家の対象レース内に限り、全競走の戦績ではない。表示略名の衝突を確認したため、履歴は別結果ページの全選手氏名を識別子として結合する。氏名は出走者の識別にのみ使用し、氏名文字列自体はモデル特徴量に入れない。初期1,558件など氏名を解決できない出走では選手履歴を欠損扱いにし、現在の印付き選手リストによる識別補完は行わない。氏名の同姓同名・表記揺れの問題は選手IDでの再取得前には残る。初期B等の欠損を補造しない。事後取得ページのため、各フィールドの当時の掲載時刻を保証するログはない。

## 時系列分割
TRAIN：{manifest['splits']['train']['first']}〜{manifest['splits']['train']['last']}、{manifest['splits']['train']['count']:,}件。
VALID：{manifest['splits']['valid']['first']}〜{manifest['splits']['valid']['last']}、{manifest['splits']['valid']['count']:,}件。
TEST：{manifest['splits']['test']['first']}〜{manifest['splits']['test']['last']}、{manifest['splits']['test']['count']:,}件。
候補葉数15/31からVALIDの買い目配分カバー率で{leaves}を選択。TESTは選択に不使用。過去のTEST結果は翌日以降の履歴として使用するが、評価用の重みは固定。TEST評価後、採用構造を全期間で再学習したserving_modelを別保存。全期間再学習モデルを未学習TEST精度と混同しない。

## 未学習TEST結果
|指標|値|
|---|---:|
|本命印の一致率|{test['teacher_favorite_top1']:.2%}|
|最長ライン番手を本命とする比較基準|{baseline:.2%}|
|券種主分類の一致率|{test['primary_family_accuracy']:.2%}|
|買い目再現率（レース平均）|{test['teacher_ticket_recall_macro']:.2%}|
|買い目Jaccard（レース平均）|{test['teacher_ticket_jaccard_macro']:.2%}|
|Mr.T配分額のカバー率（レース平均）|{test['teacher_stake_coverage_macro']:.2%}|
|点数の平均絶対誤差|{test['ticket_count_MAE']:.2f}点|
|実際の1着モデル Top1|{test['actual_winner_top1']:.2%}|
|実際のBモデル Top1|{test['actual_B_top1']:.2%}|
|生成買い目の的中率|{test['selected_ticket_hit_rate']:.2%}|
|回収率（結果別ページあり）|{test['return_percent']:.2f}%|

配分額カバー率は、採用した同一券種・同一組合せにMr.Tが配分した金額/全配分額。複数券種の残りや券種違いは不一致扱い。Jaccardは積集合/和集合。券種を当てても買い目が一致するとは限らない。記事キーワードF1は単純キーワード教師の一致であり、展開の正しさを測らない。実際の決着成績と模倣成績を混同しない。

回収率は各レース1万円、各点100円単位。点数は学習予測値、配分は学習スコアを正規化。予想料を含めない。過去確定払戻による事後評価でオッズを使った選別はしない。1点スコアや分類器出力は校正済み的中確率ではない。回収率優位性やMr.T超えは、この検証だけでは証明できない。

## 実行
Pythonとrequirementsの環境で `python mrt_logic_engine.py train --output mrt_logic_v1`。
`python mrt_logic_engine.py predict --model mrt_logic_v1/serving_model.joblib --input race.json --output prediction.json --budget 10000`。
入力はdate/YYYYMMDD、race_id、venue（場コード数値）、race_no、lines（二重配列）、names（車番文字列→フルネーム）。入力例は形式説明用の架空レース。実在レースの予想と混同しない。serving履歴日より後の日付だけ受理。

## 現時点の結論
買い目と根拠に対応した独自解説を出す研究モデルを実際に学習し保存した。内面の予想ロジックの完全再現は未達。全選手の発走前得点・脚質・B本数・コメント・風・開催局面等の入力を加える前の初期モデルであり、次段階は独立出走表での照合と前向き評価。説明は根拠のない選手心理や実際の仕掛けを断定しない。
'''
 (out/'REPORT.md').write_text(text,encoding='utf-8')

def main():
 p=argparse.ArgumentParser();sub=p.add_subparsers(dest='cmd',required=True);a=sub.add_parser('train');a.add_argument('--output',default='mrt_logic_v1');a.add_argument('--dataset');b=sub.add_parser('predict');b.add_argument('--model',required=True);b.add_argument('--input',required=True);b.add_argument('--output',required=True);b.add_argument('--budget',type=int,default=10000);args=p.parse_args()
 if args.cmd=='train':train(pathlib.Path(args.output),args.dataset)
 else:
  if args.budget<100 or args.budget%100:raise ValueError('Budget must be a positive multiple of 100')
  model=joblib.load(args.model);r=validate_input(json.loads(pathlib.Path(args.input).read_text()),model['history']);rv=rider_features(r,model['history']['riders']);pred=infer(model,r,(race_features(r),rv),args.budget);dump(args.output,pred);print(pred['commentary'])

if __name__=='__main__':main()
