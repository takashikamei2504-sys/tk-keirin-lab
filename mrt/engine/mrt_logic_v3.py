"""Archived-entry inputs and B-conditioned outcome scenarios, research V3.
Entry pages are acquired after the race, not certified pre-start captures.
"""
import copy,gzip,hashlib,itertools,json,pathlib,re,time
import joblib,numpy as np
import mrt_logic_v2 as v2
from mrt_logic_engine import allocate,payout

ROOT=pathlib.Path(__file__).resolve().parent;OUT=ROOT/'mrt_logic_v3';OUT.mkdir(exist_ok=True)
ORIGINAL_ACTIONS=list(v2.ACTION_NAMES)
v2.ACTIONS['進出候補']=r'浮上|上位進出|迫る|展開利|有利'
v2.ACTION_NAMES=ORIGINAL_ACTIONS+['条件:先行','条件:捲り','条件:番手抜出','否定:先行','否定:捲り','否定:番手抜出','傾向:捲り','進出候補']
STAT_KEYS=['score','S','H','B','nige','makuri','sashi','mark','wins','seconds','thirds','out','win_rate','top2_rate','top3_rate','gear']
POLICY={'asof_start_verified':False,'source':'Race-specific general entry page, retrieved retrospectively; marks are not parsed as features.','unknown_lineup':'Missing/unconfirmed cars retain unknown positions; never invented singles.','result_conditioning':'Actual B is a TRAINING label. Inference enumerates every proposed B holder and integrates predicted scenario weights. No current B/outcome input.','distillation_weight':.25,'validation':'Previously examined historical development period, not an untouched TEST.','scenario_limit':'Final-back holder and conditional finish are modeled. Full early-lap physical transitions and private expert thought are not reconstructed.'}

def dump(p,x):v2.dump(p,x)
def branches(text,aliases):
 contexts=[];previous=None;unresolved=0
 for si,s in enumerate(re.split(r'[。\n]+',text)):
  if not s.strip():continue
  events,_,_,_=v2.extract_events(s,aliases);m=re.search(r'場合|なら|なれば|としても|とすれば',s)
  if re.search(r'^\s*(そうなれば|その場合|その展開なら)',s):
   if previous:contexts.append({'scenario_id':f's{si}','inherits':previous['scenario_id'],'guard':previous['guard'],'effects':[{'actor':e['actor'],'action':e['action'],'negated':e['negated']} for e in events],'sentence_sha256':hashlib.sha256(s.encode()).hexdigest(),'resolution':'explicit_reference_to_previous_guard'})
   else:unresolved+=1
  elif m:
   prefix=s[:m.start()];guards,_,mentioned,_=v2.extract_events(prefix,aliases)
   tactical={'先行','捲り','カマシ','突っ張り','番手抜出','切替','追走懸念','直線伸び','競り','中団','不発','前受け','番手捲り','飛びつき','牽制ブロック','脚消耗','追走'}
   guards=[e for e in guards if e['action'] in tactical]
   if re.search(r'先行争いを避け|先行しない|先行を避け',prefix):
    for e in guards:
     if e['action']=='先行':e['negated']=True
   if not guards:unresolved+=1;previous=None;continue
   gkeys={(e['actor'],e['action']) for e in guards};effects=[e for e in events if (e['actor'],e['action']) not in gkeys]
   missing=sorted(set(mentioned)-{e['actor'] for e in guards});profile=bool(re.search(r'主体|タイプ|型',prefix) and '相手' in prefix)
   previous={'scenario_id':f's{si}','guard_type':'opponent_profile' if profile else 'action_condition','guard':[{'actor':e['actor'],'action':e['action'],'negated':e['negated']} for e in guards], 'effects':[{'actor':e['actor'],'action':e['action'],'negated':e['negated']} for e in effects], 'unresolved_guard_actors':missing,'complete_guard':not missing,'sentence_sha256':hashlib.sha256(s.encode()).hexdigest(),'resolution':'explicit_conditional_candidate'};contexts.append(previous)
 return contexts,unresolved

def prepare():
 with gzip.open(ROOT/'mrt_logic_v2_all/dataset.json.gz','rt') as f:data=json.load(f)
 month=None;raw={};structured=[]
 for r in data:
  ym=r['date'][:6]
  if ym!=month:
   raw={x['forecast_id']:x for x in v2.load(ROOT/f'mrt_{ym[:4]}_{ym[4:]}'/'records.json')};month=ym
  text=raw[r['forecast_id']].get('view','');sentences=re.split(r'[。\n]+',text)
  aliases={int(c):[n] for c,n in r['names'].items()};bs,u=branches(text,aliases);r['labels']['condition_scenarios']=bs;r['labels']['unresolved_conditions']=u
  extra,_,_,_=v2.extract_events(text,aliases)
  original=r['labels']['events']+[e for e in extra if e['action']=='進出候補'];r['labels']['source_actor_events']=copy.deepcopy(original);transformed=[]
  for e in original:
   q=copy.deepcopy(e)
   sentence=sentences[e['sentence_index']] if e['sentence_index']<len(sentences) else ''
   if e['action']=='先行' and re.search(r'先行争いを避け|先行しない|先行を避け',sentence) and len({x['actor'] for x in original if x['sentence_index']==e['sentence_index'] and x['action']=='先行'})==1:q['negated']=True
   if e['action']=='捲り' and '捲り主体' in sentence and not re.search(r'捲りを決|捲りが|捲りで|捲って|捲りを狙|捲りに回',sentence):q['action']='傾向:捲り';q['negated']=False
   if q['action'] in ['先行','捲り','番手抜出']:
    if q['negated']:q['action']='否定:'+q['action'];q['negated']=False
    elif q['conditional']:q['action']='条件:'+q['action']
   transformed.append(q)
  r['labels']['events']=transformed
  path=ROOT/'mrt_inputs/cards'/(r['race_id']+'.json');card=v2.load(path) if path.exists() else {'status':'missing','players':{},'lines':[]};r['entry']=card
  independent=card.get('lines',[]);flat=[c for l in independent for c in l]
  if len(flat)==len(set(flat)) and set(flat)<=set(r['roster']):r['lines']=sorted(independent,key=lambda l:tuple(l));r['unknown_cars']=sorted(set(r['roster'])-set(flat))
  else:r['lines']=[];r['unknown_cars']=list(r['roster'])
  # A source-issued rider ID eliminates abbreviation/full-name history collisions.
  r['history_keys']={str(c):card.get('players',{}).get(str(c),{}).get('rider_id') for c in r['roster']}
  structured.append({'forecast_id':r['forecast_id'],'race_id':r['race_id'],'scenarios':bs,'unresolved_conditions':u})
 with gzip.open(OUT/'dataset.json.gz','wt',encoding='utf-8') as f:json.dump(data,f,ensure_ascii=False)
 with gzip.open(OUT/'conditional_teacher.json.gz','wt',encoding='utf-8') as f:json.dump(structured,f,ensure_ascii=False)
 return data

def enrich(r,basic):
  rf,rv=copy.deepcopy(basic)
  entry=r['entry'];title=entry.get('title','');category=entry.get('race_class') or '';meeting=entry.get('meeting_day') or ''
  rf=rf+[int(x in category) for x in ['特選','決勝','準決','選抜','一般','予選','チャレンジ','Ｓ級','Ａ級']]+[int('最終' in meeting),int('初日' in meeting),float(re.search(r'(\d+)日目',meeting)[1]) if re.search(r'(\d+)日目',meeting) else 1 if '初日' in meeting else 0]
  cards=entry.get('players',{});scores=[p['score'] for p in cards.values() if p.get('score') is not None];average=float(np.mean(scores)) if scores else 0
  leader={c:l[0] for l in r['lines'] for c in l};leadB=[cards.get(str(l[0]),{}).get('B') or 0 for l in r['lines']]
  for c,x in rv.items():
   p=cards.get(str(c),{});comment=p.get('comment','');lead=cards.get(str(leader.get(c,c)),{})
   x.extend([float(p.get(k) or 0) for k in STAT_KEYS]+[int(p.get(k) is None) for k in STAT_KEYS]+[int(p.get('style')==s) for s in ['逃','両','追']]+[int(x in comment) for x in ['自力','自在','番手','後ろ','マーク','単騎','三番手','3番手']]+[(p.get('score') or 0)-average if p.get('score') else 0,lead.get('score') or 0,lead.get('B') or 0,(p.get('B') or 0)-max(leadB,default=0)])
  return rf,rv

def build_features(data):
 # v2 history updates exclude cancellations and use only previous dates.
 basic,hist=v2.all_features(data)
 return [enrich(r,f) for r,f in zip(data,basic)],hist

def predict_input(model,r,budget=10000,manual_b_line=None,b_line_mode='leader'):
 allowed={'race_id','date','venue','race_no','roster','lines','unknown_cars','names','entry'}
 if set(r)-allowed:raise ValueError('Unexpected or answer-bearing input keys')
 if r['date']<=model['history_through']:raise ValueError('Historical input requires a historical model/history snapshot')
 cars=r['roster']
 if not 5<=len(cars)<=9 or len(cars)!=len(set(cars)) or any(type(c)!=int or not 1<=c<=9 for c in cars):raise ValueError('Invalid roster')
 if set(map(str,r['roster']))!=set(r['entry'].get('players',{})):raise ValueError('Serving input requires a complete independently retrieved entry roster')
 ids=[p.get('rider_id') for p in r['entry']['players'].values()]
 if not all(ids) or len(ids)!=len(set(ids)):raise ValueError('Invalid or duplicate rider IDs')
 if not re.fullmatch(r'\d{12}',r['race_id']) or not r['race_id'].startswith(r['date']) or int(r['race_id'][8:10])!=r['venue'] or int(r['race_id'][10:])!=r['race_no']:raise ValueError('Race identifier mismatch')
 known=[c for l in r['lines'] for c in l]
 if not all(r['lines']) or len(r['unknown_cars'])!=len(set(r['unknown_cars'])) or len(known)!=len(set(known)) or set(known)&set(r['unknown_cars']) or set(known)|set(r['unknown_cars'])!=set(r['roster']):raise ValueError('Invalid line membership')
 r=copy.deepcopy(r);r['lines']=sorted(r['lines'],key=lambda l:tuple(l));r['history_keys']={str(c):r['entry']['players'][str(c)]['rider_id'] for c in r['roster']}
 return infer(model,r,enrich(r,v2.features_for(r,model['history'])),budget,manual_b_line,b_line_mode)

def resolve_B_selection(r,manual_b_line=None,b_line_mode='leader'):
 if b_line_mode not in ['leader','members']:raise ValueError('B line mode must be leader or members')
 if manual_b_line is None:return {'mode':'automatic','line':None,'B_holder_rule':'model_weights','weight_interpretation':'research_prediction_weights'}
 if isinstance(manual_b_line,str):
  text=v2.normalize(manual_b_line).strip()
  if not re.fullmatch(r'[1-9](?:-[1-9])*',text):raise ValueError('Specify a known ordered line, for example 4-5')
  line=[int(x) for x in text.split('-')]
 elif isinstance(manual_b_line,(list,tuple)):
  line=list(manual_b_line)
 else:raise ValueError('B line must be an ordered list of car numbers or a hyphen-separated string')
 if not line or any(type(c)!=int or not 1<=c<=9 for c in line) or len(line)!=len(set(line)):raise ValueError('Invalid manual B line')
 if line not in r['lines']:raise ValueError('Manual B line must exactly match a confirmed line, including order')
 return {'mode':'manual_line','line':line,'B_holder_rule':'line_leader' if b_line_mode=='leader' else 'within_line_model_weights','weight_interpretation':'user_condition_not_estimated_B_confidence'}

def apply_B_selection(cars,weights,selection):
 if selection['mode']=='automatic':return weights
 allowed={selection['line'][0]} if selection['B_holder_rule']=='line_leader' else set(selection['line'])
 result=np.asarray([v if c in allowed else 0. for c,v in zip(cars,weights)],dtype=float)
 if result.sum()<=0:raise ValueError('Manual B line has no supported B candidate')
 return result/result.sum()

def winners(lab):
 # Official payment rows capture every winning triple in dead heats.
 result=[];active=False
 for row in lab['payments']:
  first=v2.normalize(row[0])
  if first.startswith('3連単'):active=True;key=row[1]
  elif re.fullmatch(r'[1-9]>[1-9]>[1-9]',first) and active:key=first
  else:active=False;continue
  t=tuple(map(int,re.findall('[1-9]',key)))
  if len(t)==3:result.append(t)
 if result:return result
 # When measurement data is absent the actual-B task is masked anyway.
 f=lab['finish'];cs=sorted(f,key=f.get)
 return [tuple(map(int,cs[:3]))] if len(cs)>=3 else []

def sf(r,rf,rv,paths):
 # The first element is proposed B holder, not an observed inference field.
 zeros={c:[0.] for c in rv};return v2.seq_features(r,rf,rv,paths,'3連単',zeros)

def fit_scenario(data,features,ids,base):
 XX=[[],[],[]];YY=[[],[],[]];WW=[[],[],[]];used=0
 for i in ids:
  r=data[i];lab=r['labels'];B=lab['back']
  if not B:continue
  ws=winners(lab)
  if not ws:continue
  used+=1;rf,rv=features[i];cars=sorted(rv);teacher=lab['tickets'].get('3連単',[]);td=v2.ordered_target(teacher,'3連単') if teacher else {};fm={c:sum(v for t,v in td.items() if t[0]==c) for c in cars}
  for b in B:
   if b not in rv:continue
   for win in ws:
    if not set(win)<=set(cars):continue
    weight=1/len(B)/len(ws);paths=[(b,c) for c in cars];target=[.75*int(c==win[0])+.25*fm[c] if td else int(c==win[0]) for c in cars];XX[0].append(sf(r,rf,rv,paths));YY[0].extend(target);WW[0].extend([weight/len(cars)]*len(paths))
    paths=[(b,win[0],c) for c in cars if c!=win[0]];den=fm[win[0]];second={c:sum(v for t,v in td.items() if t[:2]==(win[0],c))/den if den else 0 for c in cars};XX[1].append(sf(r,rf,rv,paths));YY[1].extend(.75*int(t[-1]==win[1])+.25*second[t[-1]] if den else int(t[-1]==win[1]) for t in paths);WW[1].extend([weight/len(paths)]*len(paths))
    paths=[(b,win[0],win[1],c) for c in cars if c not in win[:2]];den=sum(v for t,v in td.items() if t[:2]==win[:2]);XX[2].append(sf(r,rf,rv,paths));YY[2].extend(.75*int(t[-1]==win[2])+.25*td.get(t[1:],0)/den if den else int(t[-1]==win[2]) for t in paths);WW[2].extend([weight/len(paths)]*len(paths))
 models=[]
 for j in range(3):
  x=np.concatenate(XX[j]);w=np.asarray(WW[j]);w/=w.mean();models.append(v2.reg().fit(x,np.asarray(YY[j])*100,sample_weight=w));print(json.dumps({'stage':'B_conditional_fit','position':j+1,'rows':len(w)}),flush=True)
 return {'base':base,'finish_given_B':models,'policy':POLICY,'training_forecast_ids':[data[i]['forecast_id'] for i in ids],'trained_races':len(ids),'B_condition_evaluable_training_races':used,'trained_through':max(data[i]['date'] for i in ids),'action_names':v2.ACTION_NAMES}

def probabilities(model,r,features,manual_b_line=None,b_line_mode='leader'):
 selection=resolve_B_selection(r,manual_b_line,b_line_mode)
 rf,rv=features;cars=sorted(rv);rx=np.asarray([rf+rv[c] for c in cars],dtype=np.float32);back=np.maximum(model['base']['back'].predict_proba(rx)[:,1],.00001);back/=back.sum();back=apply_B_selection(cars,back,selection);n=len(cars)
 firstpaths=[(b,c) for b in cars for c in cars];first=np.maximum(model['finish_given_B'][0].predict(sf(r,rf,rv,firstpaths)),.0001).reshape(n,n);first/=first.sum(axis=1,keepdims=True)
 pairs=list(itertools.permutations(cars,2));secondpaths=[(b,)+t for b in cars for t in pairs];second=np.maximum(model['finish_given_B'][1].predict(sf(r,rf,rv,secondpaths)),.0001).reshape(n,len(pairs))
 for i in range(n):
  for c in cars:
   jj=[j for j,t in enumerate(pairs) if t[0]==c];second[i,jj]/=second[i,jj].sum()
 triples=list(itertools.permutations(cars,3));thirdpaths=[(b,)+t for b in cars for t in triples];third=np.maximum(model['finish_given_B'][2].predict(sf(r,rf,rv,thirdpaths)),.0001).reshape(n,len(triples));pindex={t:i for i,t in enumerate(pairs)};carindex={c:i for i,c in enumerate(cars)}
 for i in range(n):
  for pair in pairs:
   jj=[j for j,t in enumerate(triples) if t[:2]==pair];third[i,jj]/=third[i,jj].sum()
 contribution=np.zeros((n,len(triples)))
 for i,b in enumerate(cars):
  for j,t in enumerate(triples):contribution[i,j]=back[i]*first[i,carindex[t[0]]]*second[i,pindex[t[:2]]]*third[i,j]
 total=contribution.sum(axis=0);assert abs(total.sum()-1)<1e-5
 return triples,total,contribution,cars,back

def infer(model,r,features,budget=10000,manual_b_line=None,b_line_mode='leader'):
 if type(budget)!=int or budget<100 or budget%100:raise ValueError('Budget must be a positive integer multiple of 100')
 selection=resolve_B_selection(r,manual_b_line,b_line_mode)
 triples,scores,contrib,cars,bprob=probabilities(model,r,features,manual_b_line,b_line_mode);order=np.argsort(-scores,kind='stable');count=max(1,min(budget//100,len(order),int(round(model['base']['count'].predict([features[0]])[0]))));chosen=order[:count];yen=allocate(scores[chosen],budget);scenes=[{'scenario_id':f'B{c}','proposed_B_holder':c,'scenario_weight':float(p)} for c,p in sorted(zip(cars,bprob),key=lambda x:-x[1]) if selection['mode']=='automatic' or p>0]
 tickets=[{'cars':list(triples[j]),'yen':v,'allocation_score':float(scores[j]),'scenario_id':f'B{cars[int(np.argmax(contrib[:,j]))]}','scenario_contribution':float(contrib[:,j].max())} for j,v in zip(chosen,yen)]
 t=tickets[0];b=int(t['scenario_id'][1:]);first,second,third=t['cars'];loc={c:(li,p) for li,l in enumerate(r['lines']) for p,c in enumerate(l)}
 prefix=''
 if selection['mode']=='manual_line':
  line='-'.join(map(str,selection['line']));rule=f"先頭の{selection['line'][0]}番がBを取る" if selection['B_holder_rule']=='line_leader' else 'ライン内のB取得者はモデルで配分'
  prefix=f"手動Bライン{line}（{rule}）を指定条件とする。"
 text=prefix+f"最終バックを{b}番が取る仮説から、{first}-{second}-{third}を本線に置く。"
 if first==b:text+=f"{b}番が先頭を維持してゴールする筋。"
 elif first in loc and b in loc and loc[first][0]==loc[b][0] and loc[first][1]>loc[b][1]:text+=f"同じラインを進む{first}番の抜け出しを想定する。"
 else:text+=f"{b}番の主導権から、別の選手である{first}番が1着に入る決着を評価する。仕掛けの具体的なタイミングは未確定。"
 alt=next((x for x in tickets if x['scenario_id']!=t['scenario_id']),None)
 if alt:text+=f"別展開は{alt['scenario_id'][1:]}番のB取得で、{'-'.join(map(str,alt['cars']))}を採用する。"
 text+=f"三連単{count}点、合計{budget:,}円。"
 return {'race_id':r['race_id'],'date':r['date'],'kind':'3連単','B_selection':selection,'scenarios':scenes,'tickets':tickets,'commentary':text,'budget_yen':budget,'policy':POLICY,'scope':'Scenario research branch; output currently restricted to 3連単. Base imitation component learns all ticket types.'}

def evaluate(model,data,features,ids,label):
 rows=[];recall=[];mass=[]
 for index,i in enumerate(ids):
  r=data[i];p=infer(model,r,features[i]);lab=r['labels'];chosen={tuple(t['cars']) for t in p['tickets']};teacher={tuple(t['cars']):t['yen'] for t in lab['tickets'].get('3連単',[])};inter=set(teacher)&chosen;recall.append(len(inter)/sum(map(len,lab['tickets'].values())));mass.append(sum(teacher[t] for t in inter)/lab['gross_stake']);active=[t for t in p['tickets'] if not set(t['cars'])&set(lab['cancelled'])];spent=sum(t['yen'] for t in active);paid=[payout(t,'3連単',lab) for t in active];pay=sum(paid) if lab['payments'] and all(x is not None for x in paid) else None
  rows.append({'forecast_id':r['forecast_id'],'race_id':r['race_id'],'date':r['date'],'tickets':p['tickets'],'scenarios':p['scenarios'],'commentary':p['commentary'],'teacher_ticket_recall':recall[-1],'teacher_stake_coverage':mass[-1],'spent_stake':spent,'payout':pay,'hit':pay>0 if pay is not None else None})
  if (index+1)%200==0:print(json.dumps({'stage':'evaluation','done':index+1,'expected':len(ids)}),flush=True)
 valid=[p for p in rows if p['payout'] is not None];stake=sum(p['spent_stake'] for p in valid);pay=sum(p['payout'] for p in valid);metrics={'races':len(rows),'teacher_ticket_recall':float(np.mean(recall)),'teacher_stake_coverage':float(np.mean(mass)),'hit_rate':float(np.mean([p['hit'] for p in valid])),'stake':stake,'payout':pay,'return_percent':100*pay/stake,'new_untouched_test':False,'asof_start_verified':False,'model_trained_through':model['trained_through']}
 dump(OUT/(label+'_predictions.json'),rows);dump(OUT/(label+'_metrics.json'),metrics);print(json.dumps({'stage':'evaluation_finished',**metrics}),flush=True)

def run(dataset=None):
 if dataset:
  with gzip.open(dataset,'rt',encoding='utf-8') as f:data=json.load(f)
 else:
  progress=v2.load(ROOT/'mrt_inputs/progress.json')
  if progress['state']!='complete':raise RuntimeError('All-period card collection must complete or be explicitly classified before training')
  data=prepare()
 dataset_hash=hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
 features,history=build_features(data);train=[i for i,r in enumerate(data) if r['date']<='20260630'];test=[i for i,r in enumerate(data) if r['date']>'20260630']
 basepath=OUT/'evaluation_imitation.joblib'
 base=joblib.load(basepath) if basepath.exists() else None
 if base is None or base.get('training_dataset_sha256')!=dataset_hash:base=v2.fit_model(data,features,train,'entry_enriched_imitation')
 base['training_dataset_sha256']=dataset_hash
 joblib.dump(base,basepath,compress=3)
 v2.evaluate(base,data,features,test,'entry_enriched_imitation',OUT)
 model=fit_scenario(data,features,train,base);joblib.dump(model,OUT/'evaluation_model.joblib',compress=3);evaluate(model,data,features,test,'historical_development')
 full=v2.fit_model(data,features,list(range(len(data))),'all_7126_entry_enriched');joblib.dump(full,OUT/'serving_imitation.joblib',compress=3);model=fit_scenario(data,features,list(range(len(data))),full);model['history']=history;model['history_through']='20261121';joblib.dump(model,OUT/'serving_model.joblib',compress=3);dump(OUT/'training_manifest.json',{'trained_ids':[r['forecast_id'] for r in data],'trained':len(data),'evaluation_ids':[data[i]['forecast_id'] for i in test],'policy':POLICY,'action_names':v2.ACTION_NAMES});print('V3 complete',flush=True)

if __name__=='__main__':
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--predict');parser.add_argument('--dataset');parser.add_argument('--model',default=str(OUT/'serving_model.joblib'));parser.add_argument('--output',default='prediction.json');parser.add_argument('--budget',type=int,default=10000);parser.add_argument('--b-line',help='Confirmed ordered B line, e.g. 4-5; omitted means automatic');parser.add_argument('--b-line-mode',choices=['leader','members'],default='leader');args=parser.parse_args()
 if not args.predict and (args.b_line is not None or args.b_line_mode!='leader'):parser.error('--b-line and --b-line-mode require --predict')
 if args.predict:
  if args.budget<100 or args.budget%100:raise ValueError('Budget must be a positive multiple of 100')
  result=predict_input(joblib.load(args.model),v2.load(args.predict),args.budget,args.b_line,args.b_line_mode);dump(args.output,result);print(result['commentary'])
 else:run(args.dataset)
