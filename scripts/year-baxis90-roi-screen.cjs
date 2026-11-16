#!/usr/bin/env node
'use strict';
// Research-only lookback 30d, test next 5d, original 5745R B-AXIS v0.6 + 8 engines.
// Beware: historical input and current models were collected/developed after target dates.
const fs=require('node:fs'),path=require('node:path'),R=path.resolve(__dirname,'../reports/year-race-type');
const base=JSON.parse(fs.readFileSync(path.join(R,'complete90-eight-engine-audit.json'),'utf8'));
const SHA='4588ec938a2fec9e81216d3fd3423329805aa3d5';
if(base.races.length!==5745||base.source.pinned_commit!==SHA)throw Error('Baseline source mismatch');
const byId=new Map(base.races.map(x=>[x.race_id,x])),rows=[],seen=new Set();
if(byId.size!==5745)throw Error('Duplicate baseline ID');
const TIE=new Map([['2026-08-22:松戸:3|lab_v5',180],['2026-08-22:松戸:3|line',180],['2026-08-22:松戸:3|roi_coverage',180],['2026-08-26:玉野:6|b_upset_ad',1590]]);
for(let j=0;j<18;j++){
 const v=JSON.parse(fs.readFileSync(path.join(R,'baxis90-shards','part-'+j+'.json'),'utf8'));
 if(v.schema!=='tk-keirin-90day-baxis-v06-shard/v1'||v.shard!==j||v.model!=='LAB_B_AXIS_V0.6.0'||v.expected!==v.completed||v.incomplete!==0)throw Error('Incomplete shard '+j);
 for(const [d,sha] of Object.entries(v.source_day_sha256))if(base.source.day_sha256[d]!==sha)throw Error('Day digest mismatch '+d);
 for(const r of v.rows){
  const b=byId.get(r.id);
  if(!b||seen.has(r.id)||r.category!==b.category||r.date!==b.date||r.meeting_day!==b.meeting_day||r.stage!==b.stage||r.cars!==b.cars)throw Error('Identity '+r.id);
  seen.add(r.id);
  const pred={...r.settlement};
  for(const e of ['auto','physical','causal','lab_v5','line','roi_coverage','b_upset_ad','b_upset_expanded']){
   const x=b.predictions[e],pay=x.payout+(TIE.get(r.id+'|'+e)||0);
   pred[e]={stake:x.stake,points:x.points,payout:pay};
  }
  for(const [e,x] of Object.entries(pred))if(x.stake!==100*x.points||x.payout<0||x.stake<0)throw Error('Bad settlement '+e);
  const d=Math.round((Date.parse(r.date+'T00:00:00Z')-Date.parse('2026-08-18T00:00:00Z'))/86400000);
  if(d<0||d>=90||!Number.isFinite(r.b_axis_margin))throw Error('Invalid time/proxy');
  rows.push({id:r.id,day:d,date:r.date,period:Math.floor(d/30)+1,stage:r.stage,grade:r.category,meeting:r.meeting_day,cars:r.cars,agree:r.agreement,nonfav:r.proxy_nonfavorite,margin:r.b_axis_margin,pred});
 }
}
if(rows.length!==5745||seen.size!==5745)throw Error('Missing shared race');
rows.sort((a,b)=>a.day-b.day||a.id.localeCompare(b.id));
const RULES={
 auto:'AUTO全件',b3:'B-AXIS上位3点全件',b5:'B-AXIS上位5点全件',
 agree_auto:'B予測一致のAUTO',agree_b3:'B予測一致のB3',
 nonfav_auto:'非有力B候補のAUTO',nonfav_b3:'非有力B候補のB3',
 switch:'一致AUTO・不一致B3',margin_b3:'一致・B支持差上位30%のB3',
 meeting_gate:'開催日程・AUTO過去30日ゲート',
 stage_gate:'番組種別・AUTO過去30日ゲート',
 grade_gate:'級班・AUTO過去30日ゲート',
 grade_stage_gate:'級班×番組・AUTO過去30日ゲート',
 margin_gate:'B支持差別・AUTO過去30日ゲート',
 grade_router:'級班別・AUTO/B3過去30日切替'
};
const GATES={
 meeting_gate:{key:r=>r.meeting,min:50,roi:.80},
 stage_gate:{key:r=>r.stage,min:55,roi:.70},
 grade_gate:{key:r=>r.grade,min:70,roi:.80},
 grade_stage_gate:{key:r=>r.grade+'|'+r.stage,min:45,roi:.80},
 margin_gate:{key:(r,c)=>r.margin>=c.median?'high':'low',min:120,roi:.85},
 grade_router:{key:r=>r.grade,min:100,delta:.12}
};
const group=(rs,func,c)=>{let out=new Map();for(const r of rs){let key=func(r,c);if(!out.has(key))out.set(key,[]);out.get(key).push(r)}return out};
const trim1=(rs,e)=>{const sorted=rs.map(r=>r.pred[e]).sort((a,b)=>b.payout-a.payout).slice(1),stake=sorted.reduce((s,x)=>s+x.stake,0);return stake?sorted.reduce((s,x)=>s+x.payout,0)/stake:null};
const quant=(rs,q)=>{const a=rs.slice().sort((a,b)=>a-b);return a[Math.floor((a.length-1)*q)]};
const choose=(name,r,c)=>{
 if(name==='auto')return'auto';if(name==='b3')return'baxis_3';if(name==='b5')return'baxis_5';
 if(name==='agree_auto')return r.agree?'auto':null;if(name==='agree_b3')return r.agree?'baxis_3':null;
 if(name==='nonfav_auto')return r.nonfav?'auto':null;if(name==='nonfav_b3')return r.nonfav?'baxis_3':null;
 if(name==='switch')return r.agree?'auto':'baxis_3';
 if(name==='margin_b3')return r.agree&&r.margin>=c.q70?'baxis_3':null;
 const g=GATES[name],xs=c.groups[name].get(g.key(r,c))||[];
 if(name==='grade_router'){
  if(xs.length<g.min)return'auto';
  const a=trim1(xs,'auto'),b=trim1(xs,'baxis_3');
  return a!==null&&b!==null&&b>=a+g.delta?'baxis_3':'auto';
 }
 return xs.length>=g.min&&(trim1(xs,'auto')??0)>=g.roi?'auto':null;
};
const selected=Object.fromEntries(Object.keys(RULES).map(k=>[k,[]])),folds=[];
for(let d=30;d<90;d+=5){
 const train=rows.filter(r=>r.day>=d-30&&r.day<d),test=rows.filter(r=>r.day>=d&&r.day<d+5);
 const c={median:quant(train.map(r=>r.margin),.5),q70:quant(train.map(r=>r.margin),.7),groups:{}};
 for(const [key,rule] of Object.entries(GATES))c.groups[key]=group(train,rule.key,c);
 const buys={};
 for(const key of Object.keys(RULES)){
  buys[key]=0;
  for(const r of test){
   const engine=choose(key,r,c);
   if(engine){selected[key].push({id:r.id,date:r.date,day:r.day,engine,...r.pred[engine]});buys[key]++}
  }
 }
 folds.push({train_first:train[0].date,train_last:train[train.length-1].date,test_first:test[0].date,test_last:test[test.length-1].date,train_n:train.length,test_n:test.length,buys});
}
const heldout=rows.filter(r=>r.day>=30);
function stats(rs){
 const stake=rs.reduce((n,x)=>n+x.stake,0),pay=rs.reduce((n,x)=>n+x.payout,0),s=rs.slice().sort((a,b)=>b.payout-a.payout);
 const cut=k=>{const left=s.slice(k),t=left.reduce((n,x)=>n+x.stake,0);return t?+(100*left.reduce((n,x)=>n+x.payout,0)/t).toFixed(2):null};
 let net=0,peak=0,drawdown=0;for(const x of rs){net+=x.payout-x.stake;peak=Math.max(peak,net);drawdown=Math.max(drawdown,peak-net)}
 return{races:rs.length,points:rs.reduce((n,x)=>n+x.points,0),hits:rs.filter(x=>x.payout>0).length,
  stake_yen:stake,payout_yen:pay,net_yen:pay-stake,roi_pct:stake?+(100*pay/stake).toFixed(2):null,
  trim1_roi_pct:cut(1),trim5_roi_pct:cut(5),max_one_payout:s[0]?.payout||0,
  max_drawdown_yen:drawdown};
}
function bootstrap(a,b){
 const blocks=Array.from({length:12},()=>[0,0,0,0]);
 for(const x of a){const q=blocks[Math.floor((x.day-30)/5)];q[0]+=x.stake;q[1]+=x.payout}
 for(const x of b){const q=blocks[Math.floor((x.day-30)/5)];q[2]+=x.stake;q[3]+=x.payout}
 let seed=20261116;const rand=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296};
 let vals=[];for(let k=0;k<3500;k++){
  const t=[0,0,0,0];for(let j=0;j<12;j++){const z=blocks[Math.floor(rand()*12)];for(let h=0;h<4;h++)t[h]+=z[h]}
  if(t[0]>0&&t[2]>0)vals.push(100*t[1]/t[0]-100*t[3]/t[2]);
 }
 if(!vals.length)return null;
 vals.sort((a,b)=>a-b);
 return{diff95:[+vals[Math.floor(vals.length*.025)].toFixed(1),+vals[Math.floor(vals.length*.975)].toFixed(1)],n:vals.length};
}
const summaries={};
for(const key of Object.keys(RULES)){
 const rs=selected[key],overall=stats(rs);
 summaries[key]={name:RULES[key],all:overall,coverage_pct:+(100*rs.length/heldout.length).toFixed(1),
  period2:stats(rs.filter(r=>r.day<60)),period3:stats(rs.filter(r=>r.day>=60)),
  difference_bootstrap:key==='auto'?null:bootstrap(rs,selected.auto)};
}
const leaders=Object.entries(summaries).filter(([k,x])=>k!=='auto'&&x.coverage_pct>=20&&x.all.roi_pct!==null).sort((a,b)=>b[1].all.roi_pct-a[1].all.roi_pct);
const strict=leaders.filter(([k,x])=>x.all.roi_pct>=100&&x.all.trim5_roi_pct>=100&&x.period2.roi_pct>=100&&x.period3.roi_pct>=100);
const out={schema:'tk-keirin-baxis90-roi-gate-v1',period:'2026-08-18..2026-11-15',
  original_n:5745,train_days:30,heldout_days:60,heldout_n:heldout.length,lookback_days:30,step_days:5,
  historical_model:'B-AXIS v0.6 and original eight-way 2026-11 replays',
  rules_count:Object.keys(RULES).length,baseline:summaries.auto,strategies:summaries,folds,
  criteria:{coverage_min:20,overall_roi_min:100,trim5_roi_min:100,each_30day_roi_min:100},
  strict_survivors:strict.map(([key])=>key),
  limitations:['These November 2026 model outputs and original racecards were not frozen before historical start times.',
   'Historical period already explored; candidate rules are exploratory and not independent prospective testing.',
   'Multiple comparisons 14 alternatives; bootstrap intervals are unadjusted.',
   'Market odds were not frozen; EV / Kelly strategies cannot be evaluated faithfully.',
   'Higher no-bet rate reduces absolute losses in negative-ROI baseline but does not prove profitable bets.',
   'Same historical 5745 cohort as original; no blending with selected 661R or observed B 84R.',
   'No production, Railway or notification change']};
fs.writeFileSync(path.join(R,'baxis90-roi-gates-walkforward-20261116.json'),JSON.stringify(out,null,2)+'\n');
const f=x=>x===null?'—':x.toFixed(1)+'%';
const md=['# 回収率改善：事後予想に15購入方策を当てはめた時系列検証','',
 '対象：2026-08-18〜2026-11-15の男子5,745R。最初の30日を学習に用い、後半60日'+heldout.length+'Rに5日単位で適用。',
 '推定モデルは現在の2026年11月版。結果・払戻は選択に使わないが、本来の発走前凍結予想ではない。','',
 '| 方策 | 対象R | 対象比 | 回収率 | 上位1件除外 | 上位5件除外 | 第2期 | 第3期 |','|---|---:|---:|---:|---:|---:|---:|---:|'];
for(const [key,x] of Object.entries(summaries))md.push('| '+x.name+' | '+x.all.races+' | '+f(x.coverage_pct)+' | '+f(x.all.roi_pct)+' | '+f(x.all.trim1_roi_pct)+' | '+f(x.all.trim5_roi_pct)+' | '+f(x.period2.roi_pct)+' | '+f(x.period3.roi_pct)+' |');
md.push('','## 探索的上位候補');
for(const [k,x]of leaders.slice(0,4))md.push('- '+x.name+': '+x.all.races+'R、ROI '+f(x.all.roi_pct)+'、上位5件除外 '+f(x.all.trim5_roi_pct)+'、第2期 '+f(x.period2.roi_pct)+'、第3期 '+f(x.period3.roi_pct)+'、5日ブロックCI '+JSON.stringify(x.difference_bootstrap?.diff95));
md.push('','厳格基準（20%以上の対象率・全体/最大5件除外/2つの検証期間すべて100%以上）合格：**'+strict.length+'件**。','',
 '## 結論と留意点','',
 '- 14候補の最高値は複数比較による後知恵の優位性を含む。採用には未使用の将来データが必要。',
 '- オッズ付きの全120通り確率・EVが保存されていないため期待値最適化は次の課題。',
 '- 過去のB候補一致度やライン構成だけでは勝てる買い目を保証しない。',
 '- 本番main/Railway/通知は未変更。','',
 '詳しい期間別判定・収支・差の区間は同名JSON参照。');
fs.writeFileSync(path.join(R,'baxis90-roi-gates-walkforward-20261116-ja.md'),md.join('\n')+'\n');
console.log('BAXIS_ROI_GATE_DONE',JSON.stringify({heldout:heldout.length,baseline:summaries.auto.all,
 top:leaders.slice(0,7).map(([k,x])=>({key:k,roi:x.all.roi_pct,trim5:x.all.trim5_roi_pct,p2:x.period2.roi_pct,p3:x.period3.roi_pct,coverage:x.coverage_pct,ci:x.difference_bootstrap?.diff95})),
 strict:out.strict_survivors}).slice(0,11000));
