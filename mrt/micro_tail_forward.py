"""Fixed MICRO-TAIL V1 shadow; no production writes or actual bets."""
import argparse, collections, datetime as dt, gzip, hashlib, itertools, json, math, os, re
from pathlib import Path
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor

START='2026-11-26'
THRESHOLD=104.3407205121726
JST=dt.timezone(dt.timedelta(hours=9))
POLICY={'id':'MICRO_TAIL_V1','threshold':THRESHOLD,'start':START,'training_through':'20260630','unit':100,'max_points':[1,3],'budget':10000,'no_auto_adoption':True}
def context(r):
    cs=r['roster'];p=r['entry']['players'];lines=r['lines'];loc={c:(i,j,len(l)) for i,l in enumerate(lines) for j,c in enumerate(l)}
    if sorted(c for l in lines for c in l)!=sorted(cs) or set(p)!=set(map(str,cs)):raise ValueError('invalid lineup')
    def f(c,k):
        v=p[str(c)].get(k);return float(v) if v is not None else np.nan
    sc=np.array([f(c,'score') for c in cs]);avg=np.nanmean(sc);sd=max(1,np.nanstd(sc))
    def rider(c):
        i,pos,n=loc[c];lead=lines[i][0]
        return [(f(c,'score')-avg)/sd,pos,n,*[f(c,k) for k in ('B','H','S','nige','makuri','sashi','mark','win_rate','top2_rate','top3_rate')],(f(lead,'score')-avg)/sd,f(lead,'B'),f(c,'score')-f(lead,'score')]
    feats={c:rider(c) for c in cs}
    def pair(a,b):return [len(cs),len(lines),int(loc[a][0]==loc[b][0]),int(loc[a][1]==1 and loc[b][1]==0),f(a,'score')-f(b,'score'),*feats[a],*feats[b]]
    def third(a,b,c):return [*pair(a,b),*feats[c],int(loc[c][0]==loc[a][0]),int(loc[c][0]==loc[b][0]),f(a,'score')-f(c,'score'),f(b,'score')-f(c,'score')]
    return cs,pair,third

def train(data):
    px=[];py=[];tx=[];ty=[];wx=[];wy=[];count=0
    for r in data:
        if r['date']>POLICY['training_through']:continue
        l=r['labels'];e=r['entry'];cars=r['roster']
        if not(len(cars) in (7,9) and e.get('status')=='received' and not l['refund'] and not l['cancelled'] and not r['unknown_cars'] and len(e['players'])==len(cars) and len(l['finish'])==len(cars) and sorted(l['finish'].values())==list(range(1,len(cars)+1))):continue
        cs,pair,third=context(r);win=tuple(int(k) for k in sorted(l['finish'],key=l['finish'].get)[:3]);a,b,c=win;count+=1
        for i,j in itertools.permutations(cs,2):px.append(pair(i,j));py.append(int((i,j)==(a,b)))
        for k in cs:
            if k not in (a,b):tx.append(third(a,b,k));ty.append(int(k==c))
        p={tuple(map(int,re.findall(r'\d+',v[1]))):int(re.sub(r'\D','',v[2])) for v in l['payments'] if len(v)==4 and v[0]=='３連単'}
        if win in p:wx.append(third(*win));wy.append(math.log(p[win]))
    if (count,len(px),len(tx),len(wx))!=(4802,254694,27544,3426):raise ValueError(f'training parity mismatch: {(count,len(px),len(tx),len(wx))}')
    def fit(x,y):return HistGradientBoostingClassifier(max_iter=75,max_leaf_nodes=23,min_samples_leaf=80,l2_regularization=2,random_state=634).fit(np.array(x,dtype=np.float32),y)
    return fit(px,py),fit(tx,ty),HistGradientBoostingRegressor(max_iter=60,max_leaf_nodes=15,min_samples_leaf=60,l2_regularization=3,random_state=634).fit(np.array(wx,dtype=np.float32),wy)

def validate_base(base,cars):
    if not base or sum(t['yen'] for t in base)!=10000:raise ValueError('baseline budget mismatch')
    combos=[tuple(t['cars']) for t in base]
    if len(set(combos))!=len(combos) or any(len(q)!=3 or len(set(q))!=3 or not set(q)<=set(cars) for q in combos):raise ValueError('invalid baseline combinations')
    if any(type(t['yen']) is not int or t['yen']<100 or t['yen']%100 for t in base):raise ValueError('invalid baseline stake')

def select(candidates,n):
    ranked=sorted(candidates,key=lambda t:(-t['prob'],tuple(t['cars'])))
    return [dict(t,yen=100) for t in ranked[:n] if t['prob']*t['payout_proxy']>=THRESHOLD]

def predict(entry,base,model):
    cs,pair,third=context(entry);validate_base(base,cs);pm,tm,wm=model
    pairs=list(itertools.permutations(cs,2));trips=list(itertools.permutations(cs,3));pp=pm.predict_proba(np.array([pair(*q) for q in pairs],np.float32))[:,1];pp=pp/pp.sum();pd=dict(zip(pairs,pp));x=np.array([third(*q) for q in trips],np.float32);q3=tm.predict_proba(x)[:,1];pred=np.exp(wm.predict(x));den=collections.Counter()
    for q,v in zip(trips,q3):den[q[:2]]+=v
    orig={tuple(t['cars']) for t in base};op={q[:2] for q in orig}
    cand=[{'cars':list(q),'prob':float(pd[q[:2]]*v/den[q[:2]]),'payout_proxy':float(w)} for q,v,w in zip(trips,q3,pred) if q not in orig and q[:2] in op]
    if any(not math.isfinite(t['prob']*t['payout_proxy']) for t in cand):raise ValueError('nonfinite signal')
    return {str(n):select(cand,n) for n in (1,3)}

def debit(base,n):
    if n==0:return [dict(t) for t in base]
    av=np.array([t['yen']//100-1 for t in base]);total=av.sum()
    if n>total:raise ValueError('no available budget')
    q=av*n/total;u=np.floor(q).astype(int)
    for i in sorted(range(len(base)),key=lambda i:(-(q[i]-u[i]),i))[:n-u.sum()]:u[i]+=1
    return [dict(t,yen=t['yen']-100*int(u[i])) for i,t in enumerate(base)]

def settle(base,extra,pays):
    def pay(ts):return sum(pays.get('-'.join(map(str,t['cars'])),0)*t['yen']//100 for t in ts)
    b=pay(base);a=pay(extra);combined=pay(debit(base,len(extra)))+a
    return {'points':len(extra),'additional_stake':100*len(extra),'additional_payout':a,'base_payout':b,'combined_payout':combined,'delta':combined-b}

def load_model(root):
    import sklearn
    manifest=json.loads((root/'mrt/research_seed_manifest.json').read_text());raw=(root/'mrt/research_seed.json.gz').read_bytes();sha=hashlib.sha256(raw).hexdigest()
    if sha!='6989dae451f7e21a4b7228c8c6763a4586f25da8282350dcca0df54d50301f12' or sha!=manifest['sha256']:raise ValueError('seed mismatch')
    if sklearn.__version__!='1.8.0':raise ValueError('sklearn version mismatch')
    data=json.loads(gzip.decompress(raw));model=train(data)
    protocol=hashlib.sha256(Path(__file__).read_bytes()+json.dumps(POLICY,sort_keys=True).encode()+sha.encode()).hexdigest()[:18]
    return model,protocol

def freeze_one(p,model,protocol,at,clock):
    from .research_data import verify_snapshot
    entry=verify_snapshot(p);close=dt.datetime.fromisoformat(p['sales_close_at'])
    if not START.replace('-','')<=entry['date'] or entry['date']!=at.astimezone(JST).strftime('%Y%m%d') or not dt.datetime.fromisoformat(p['generated_at'])<=at<close:raise ValueError('not current pre-close race')
    if p['model_id']!='MRT_V3_7126' or entry.get('unknown_cars') or entry['entry'].get('status')!='received':raise ValueError('ineligible input')
    base=p['automatic']['tickets'];extra=predict(entry,base,model);finished=clock()
    if not at<=finished<close:raise ValueError('finished after close')
    return {'schema':'tk-mrt-micro-tail-forward/v1','policy':POLICY,'protocol_id':protocol,'race_id':p['race_id'],'date':entry['date'],'identity_sha256':p['identity_sha256'],'model_sha256':p['model_sha256'],'roster':{str(c):str(v['rider_id']) for c,v in entry['entry']['players'].items()},'field_size':len(entry['roster']),'race_class':entry['entry'].get('race_class'),'meeting_day':entry['entry'].get('meeting_day'),'generated_at':finished.isoformat(),'original_generated_at':p['generated_at'],'sales_close_at':p['sales_close_at'],'base':base,'additional':extra,'frozen':True,'pre_race':True,'automatic_promotion':False}

def freeze(root,model,protocol):
    from .micro_forward import _dump_immutable
    date=dt.datetime.now(JST).date().isoformat();folder=root/'data/mrt'/date;dest=root/'data/mrt_research/micro_tail_forward/snapshots';status={'date':date,'frozen':0,'already':0,'rejected':[]}
    if date<START or not (folder/'index.json').exists():return status
    for row in json.loads((folder/'index.json').read_text()).get('races',[]):
        rid=row['race_id'];target=dest/(rid+'.json')
        if target.exists():status['already']+=1;continue
        try:
            name=row.get('file');assert name and Path(name).name==name and name.startswith(rid+'-')
            p=json.loads((folder/name).read_text());assert p['race_id']==rid and p['identity_sha256']==row['identity_sha256']
            s=freeze_one(p,model,protocol,dt.datetime.now(dt.timezone.utc),lambda:dt.datetime.now(dt.timezone.utc));_dump_immutable(target,s);status['frozen']+=1
        except (ValueError,KeyError,TypeError,OSError,AssertionError) as e:status['rejected'].append({'race_id':rid,'reason':str(e)})
    return status

def evaluate(root):
    from .micro_forward import _result_map
    dest=root/'data/mrt_research/micro_tail_forward';results=_result_map(root);groups=collections.defaultdict(list);excluded=[]
    for f in sorted((dest/'snapshots').glob('*.json')):
        s=json.loads(f.read_text());r=results.get(s['race_id']);
        if not r or r.get('roster')!=s['roster'] or not r.get('payouts') or not s.get('frozen') or not s.get('pre_race') or dt.datetime.fromisoformat(s['generated_at'])>=dt.datetime.fromisoformat(s['sales_close_at']):excluded.append(f.stem);continue
        groups[s['protocol_id']].append({'race_id':s['race_id'],'date':s['date'],'field_size':s['field_size'],'race_class':s['race_class'],'meeting_day':s['meeting_day'],'methods':{n:settle(s['base'],s['additional'][n],r['payouts']) for n in ('1','3')}})
    def summary(rows,n):
        v=[r['methods'][n] for r in rows];st=sum(x['additional_stake'] for x in v);p=sum(x['additional_payout'] for x in v);b=sum(x['base_payout'] for x in v);co=sum(x['combined_payout'] for x in v);wins=sorted((x['additional_payout'] for x in v),reverse=True);return {'races':len(v),'active':sum(x['points']>0 for x in v),'hits':sum(x['additional_payout']>0 for x in v),'additional_stake':st,'additional_payout':p,'additional_roi':100*p/st if st else None,'base_roi':b/len(v)/100 if v else None,'combined_roi':co/len(v)/100 if v else None,'delta_yen':co-b,'exclude_realized_keep_cost':{str(k):100*(p-sum(wins[:k]))/st if st else None for k in (1,3,5)}}
    out={}
    for protocol,rows in groups.items():
        days=(dt.datetime.strptime(max(r['date'] for r in rows),'%Y%m%d')-dt.datetime.strptime(min(r['date'] for r in rows),'%Y%m%d')).days+1
        out[protocol]={'rows':rows,'summary':{n:summary(rows,n) for n in ('1','3')},'days':days,'review_ready':len(rows)>=200 and days>=28,'breakdown':{k:{str(v):{n:summary([r for r in rows if r[k]==v],n) for n in ('1','3')} for v in set(r[k] for r in rows)} for k in ('field_size','race_class','meeting_day','date')}}
    return {'schema':'tk-mrt-micro-tail-score/v1','protocols':out,'excluded':excluded,'race_ids':[f.stem for f in sorted((dest/'snapshots').glob('*.json'))],'automatic_promotion':False,'adoption':'human_decision_required'}

def main():
    p=argparse.ArgumentParser();p.add_argument('--mode',required=True,choices=('dry-run','freeze','evaluate'));p.add_argument('--root',default=str(Path(__file__).resolve().parents[1]));args=p.parse_args();root=Path(args.root).resolve();dest=root/'data/mrt_research/micro_tail_forward'
    if args.mode=='evaluate':out=evaluate(root)
    else:
        model,protocol=load_model(root);out={'protocol_id':protocol,'trained':True} if args.mode=='dry-run' else freeze(root,model,protocol)
    if args.mode!='dry-run':
        dest.mkdir(parents=True,exist_ok=True);(dest/('latest.json' if args.mode=='evaluate' else 'freeze_status.json')).write_text(json.dumps(out,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
    print(json.dumps(out,ensure_ascii=False))
if __name__=='__main__':main()
