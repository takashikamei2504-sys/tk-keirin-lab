#!/usr/bin/env node
'use strict';
// Retrospective racecard replay only. Not evidence of original pre-race capture.
// Fixed weights are trained on Jun-Aug 2026; never fit to Sep-Nov outcomes.
const fs=require('node:fs/promises'),path=require('node:path');
const archive=require('./mansha-study.cjs'),study=require('./mansha-crossline-pair-third.cjs');
const START='2026-05-08',END='2026-11-07',MODEL='crossline-halfyear-v2';
const SOURCE_COMMIT='fd30ca7515c7fbccbed2de77bd4be557387eb9c7'; // Public archive snapshot before 54 old days were removed on Nov 13
const HISTORICAL_BASE='https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/'+SOURCE_COMMIT+'/';
async function fetchPinnedDay(date){
 for(let attempt=0;attempt<3;attempt++)try{
  const r=await fetch(HISTORICAL_BASE+date+'.json',{signal:AbortSignal.timeout(20000),headers:{'user-agent':'TK-KEIRIN-LAB-halfyear-replay'}});
  if(r.status===404)return {date,missing:true};
  if(r.status===429||r.status>=500){await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));continue;}
  if(!r.ok)return {date,error:'HTTP '+r.status};
  const j=await r.json();if(!Array.isArray(j.races))return {date,error:'No races array'};
  return {date,data:j.races};
 }catch(e){if(attempt===2)return {date,error:String(e).slice(0,220)};await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));}
 return {date,error:'All retries exhausted'};
}
const MODES=['baseline8','hybrid8','cross4','cross2full','cross1full','score4'];
const sum=(a,f)=>a.reduce((n,x)=>n+f(x),0);
function cols(x,c,first=null,second=null){
 const max=c.n-1;
 return [x.scoreZ,(max-x.rankIndex)/max,+(x.role===1),+(x.role===2),+(x.role>=3),
 +(x.lineSize===1),+(x.lineSize>=3),+(x.style==='逃'),+(x.style==='追'),
 +(x.line===first?.line),+(x.line===second?.line),
 +(!!first&&!!second&&x.line!==first.line&&x.line!==second.line)];
}
const dot=(a,w)=>sum(a.map((x,i)=>x*w[i]),x=>x);
function logsoft(x){const m=Math.max(...x),den=Math.log(sum(x,z=>Math.exp(z-m)));return x.map(z=>z-m-den);}
function syntheticBase8(c,w){
 const e=c.e,win=logsoft(e.map(x=>dot(cols(x,c),w.regular.winner.weights))),second=logsoft(e.map(x=>dot(cols(x,c),w.regular.second.weights))),arr=[];
 for(let i=0;i<e.length;i++)for(let j=0;j<e.length;j++)if(i!==j){
  const third=e.filter((_,k)=>k!==i&&k!==j),prob=logsoft(third.map(x=>dot(cols(x,c,e[i],e[j]),w.third.weights)));
  for(let k=0;k<third.length;k++)arr.push({key:[e[i].no,e[j].no,third[k].no].join('-'),score:win[i]+second[j]+prob[k]});
 }
 arr.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key,'en'));return arr.slice(0,8).map(x=>x.key);
}
function predict(c,w){
 const cross4=[...study.tickets(c,'regular',2,'trained2',w).t];
 const cross2full=[...study.tickets(c,'regular',2,'all',w).t];
 const cross1full=[...study.tickets(c,'regular',1,'all',w).t];
 const score4=[...study.tickets(c,'score',2,'trained2',w).t];
 const baseline8=syntheticBase8(c,w),hybrid8=baseline8.slice(0,6);
 for(const key of cross4)if(hybrid8.length<8&&!hybrid8.includes(key))hybrid8.push(key);
 for(const key of baseline8)if(hybrid8.length<8&&!hybrid8.includes(key))hybrid8.push(key);
 return {baseline8,hybrid8,cross4,cross2full,cross1full,score4};
}
function identify(c){
 const [a,b,d]=c.finish.map(no=>c.byNo.get(no));
 if(!a||!b||!d)throw Error('Inconsistent result');
 return {structure:(a.line===b.line?'same':'cross')+'_'+(d.line===a.line?'first':d.line===b.line?'second':'thirdline'),
 roles:(a.role===1?'leader':a.role===2?'second':'later')+'_'+(b.role===1?'leader':b.role===2?'second':'later')};
}
function score(c,w){
 const p=predict(c,w),winner=c.finish.join('-'),structure=identify(c),views={};
 for(const mode of MODES){const keys=p[mode],hit=keys.includes(winner);views[mode]={stake:keys.length*100,payout:hit?c.payout:0,hit,points:keys.length};}
 const pairs=study.orderedPairs(c,'regular',w).slice(0,2).map(p=>[p.a.no,p.b.no].join('-'));
 return {id:[c.date,c.venue,c.raceNo].join(':'),date:c.date,cat:c.cat,structure:structure.structure,roles:structure.roles,band:c.payout>=30000?'300+':c.payout>=10000?'100-300':c.payout>=5000?'50-100':'under50',highrisk:!!c.riskPriority,payout:c.payout,actual:winner,topPairs:pairs,correctPair:pairs.includes(c.finish.slice(0,2).join('-')),views};
}
function summary(rows){
 const o={races:rows.length,cross12:rows.filter(r=>r.structure.startsWith('cross_')).length,threeLine:rows.filter(r=>r.structure==='cross_thirdline').length,correctPairs:rows.filter(r=>r.correctPair).length};
 for(const mode of MODES){
  const stake=sum(rows,r=>r.views[mode].stake),payout=sum(rows,r=>r.views[mode].payout),hits=sum(rows,r=>+r.views[mode].hit),points=sum(rows,r=>r.views[mode].points);
  const top=rows.slice().sort((a,b)=>b.views[mode].payout-a.views[mode].payout);
  const trim=k=>{const s=stake-sum(top.slice(0,k),x=>x.views[mode].stake);return s?(payout-sum(top.slice(0,k),x=>x.views[mode].payout))/s:null;};
  let wealth=0,peak=0,drawdown=0;
  for(const r of rows){wealth+=r.views[mode].payout-r.views[mode].stake;peak=Math.max(peak,wealth);drawdown=Math.max(drawdown,peak-wealth);}
  o[mode]={races:rows.length,points,stake,payout,net:payout-stake,hits,hitRate:rows.length?hits/rows.length:null,roi:stake?payout/stake:null,trim1:top.length&&top[0].views[mode].payout>0?trim(1):null,trim3:top.length>=3&&top[2].views[mode].payout>0?trim(3):null,maxDrawdown:drawdown,mid50to100:rows.filter(r=>r.band==='50-100'&&r.views[mode].hit).length,over100:rows.filter(r=>r.payout>=10000&&r.views[mode].hit).length};
 }
 return o;
}
function group(rows,selector){const a={};for(const r of rows)(a[selector(r)]??=[]).push(r);return Object.fromEntries(Object.entries(a).sort(([x],[y])=>x.localeCompare(y)).map(([k,v])=>[k,summary(v)]));}
function bootstrap(rows,rep=1000){
 const days=Object.values((()=>{const a={};for(const r of rows)(a[r.date]??=[]).push(r);return a;})());if(days.length<5)return null;
 let state=15341;const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const draws=[];for(let i=0;i<rep;i++){let base=0,hybrid=0,stake=0;for(let j=0;j<days.length;j++){for(const r of days[Math.floor(rand()*days.length)]){base+=r.views.baseline8.payout;hybrid+=r.views.hybrid8.payout;stake+=r.views.baseline8.stake;}}draws.push((hybrid-base)/stake);}
 draws.sort((a,b)=>a-b);return {days:days.length,rep,unit:'hybrid8 minus baseline8 ROI',p025:draws[Math.floor(rep*.025)],p50:draws[Math.floor(rep*.5)],p975:draws[Math.floor(rep*.975)]};
}
function evaluate(cards,w){
 const rows=cards.slice().sort((a,b)=>a.date.localeCompare(b.date)||a.venue.localeCompare(b.venue)||a.raceNo-b.raceNo).map(c=>score(c,w)),split={
  train:rows.filter(r=>r.date<'2026-09-01'),
  validation:rows.filter(r=>r.date>='2026-09-01'&&r.date<'2026-10-01'),
  holdout:rows.filter(r=>r.date>='2026-10-01')};
 const result={schema:MODEL,start:START,end:END,notes:[
  'Retrospective replay from public historical racecards. Historical source may have been updated after the start; no live pre-race freeze claim.',
  'baseline8 is a SYNTHETIC 8-ticket model assembled from archived fitted weights; NOT the historical actual TK KEIRIN LAB production picks.',
  'Weights trained on Jun-Aug 2026. train is IN SAMPLE. Validation Sep and holdout Oct-Nov were examined in prior research; optimization on those dates needs new future evaluation.',
  'Actual race winner, payout, and line topology are read for scoring ONLY; no labels enter the prediction function.',
  'Outcome-topology group ROI is post-event descriptive, not a feasible pre-race filtering strategy.'
 ],definitions:{baseline8:'Top 8 ordered triples ranked by fitted winner/second/third likelihood (synthetic)',hybrid8:'Top 6 baseline8 plus first 2 unbought cross4 candidate triples',cross4:'Top 2 cross-line ordered pairs x top 2 independently ranked thirds',cross2full:'Top 2 cross-line pairs x all thirds',cross1full:'Top cross-line pair x all thirds',score4:'Score-ranked top 2 cross-line pairs x trained top 2 thirds'},
 overall:summary(rows),by_period:Object.fromEntries(Object.entries(split).map(([k,v])=>[k,summary(v)])),
 by_period_cat:Object.fromEntries(Object.entries(split).map(([k,v])=>[k,group(v,r=>r.cat)])),
 by_period_highrisk:Object.fromEntries(Object.entries(split).map(([k,v])=>[k,group(v,r=>r.highrisk?'highrisk':'other')])),
 by_month:group(rows,r=>r.date.slice(0,7)),by_topology:group(rows,r=>r.structure),holdout_topology:group(split.holdout,r=>r.structure),holdout_roles:group(split.holdout,r=>r.roles),holdout_bootstrap:bootstrap(split.holdout),hardest_highpayout:split.holdout.filter(r=>r.payout>=30000&&!r.views.hybrid8.hit).sort((a,b)=>b.payout-a.payout).slice(0,20).map(r=>({id:r.id,actual:r.actual,payout:r.payout,structure:r.structure,topPairs:r.topPairs,baseHit:r.views.baseline8.hit,crossHit:r.views.cross4.hit}))};
 return {result,rows};
}
async function run({fetchDay=fetchPinnedDay,start=START,end=END,models=null}={}){
 const w=models||JSON.parse(await fs.readFile(path.join(__dirname,'../reports/mansha/crossline-pair-third-v1.json'),'utf8')).models;
 if(!w?.regular?.winner?.weights||!w?.regular?.second?.weights||!w?.third?.weights)throw Error('Missing immutable pretrained weights');
 const dates=archive.dateList(start,end),days=[],errors=[],missing=[],available=[],excluded={size:0,girls_or_unclassified:0,pending_or_invalid_result:0,multiple_results:0,invalid_prelude:0},cards=[];let index=0;
 async function worker(){while(index<dates.length){const date=dates[index++];days.push(await fetchDay(date));}}
 await Promise.all(Array.from({length:8},worker));days.sort((a,b)=>a.date.localeCompare(b.date));
 for(const d of days){if(d.error){errors.push({date:d.date,error:d.error});continue}if(d.missing){missing.push(d.date);continue}available.push(d.date);for(const raw of d.data){const c=study.createCard(raw,d.date,excluded);if(c&&['S7','S9','A7','C7'].includes(c.cat))cards.push(c);}}
 if(errors.length)throw Error('Archive fetch incomplete '+JSON.stringify(errors.slice(0,6)));
 if(start===START&&end===END&&(available.length!==139||cards.length!==8736))throw Error('Archived source drift: expected 139 days/8736 races; got '+available.length+'/'+cards.length);
 const {result,rows}=evaluate(cards,w);result.available_days=available.length;result.missing_days=missing;result.excluded=excluded;result.source_url=HISTORICAL_BASE;result.source_commit=SOURCE_COMMIT;result.created_at=new Date().toISOString();
 const dir=path.join(__dirname,'../reports/mansha');await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(path.join(dir,'crossline-halfyear-v2.json'),JSON.stringify(result,null,2)+'\n');
 const csv=['race_id,date,category,actual,payout,structure,highrisk,top_pairs,baseline8_stake,baseline8_payout,hybrid8_stake,hybrid8_payout,cross4_stake,cross4_payout,cross2full_stake,cross2full_payout,cross1full_stake,cross1full_payout,score4_stake,score4_payout'];
 for(const r of rows)csv.push([r.id,r.date,r.cat,r.actual,r.payout,r.structure,+r.highrisk,r.topPairs.join('|'),...MODES.flatMap(m=>[r.views[m].stake,r.views[m].payout])].join(','));
 await fs.writeFile(path.join(dir,'crossline-halfyear-v2-ledger.csv'),csv.join('\n')+'\n');
 const pct=x=>x==null?'-':(x*100).toFixed(1)+'%',md=['# 別線決着・過去半年レース事後予想の比較','','- 2026-05-08〜11-07、取得'+available.length+'日、対象'+rows.length+'R。欠損'+missing.length+'日。','- 注意：再構成8点は実際の本番エンジンではなく、同じ特徴量を用いる比較用合成ベンチマーク。','- 学習期間はインサンプル。後半の期間も過去の研究で閲覧済みであり、将来の回収率を保証しない。','', '| 期間 | R | 比較基準8点 | ハイブリッド8点 | 別線4点 | 別線2ペア全通り |','|---|---:|---:|---:|---:|---:|'];
 for(const [k,label] of [['train','6〜8月（学習内）'],['validation','9月'],['holdout','10月〜11/7']]){const o=result.by_period[k];md.push('|'+label+'|'+o.races+'|'+pct(o.baseline8.roi)+'|'+pct(o.hybrid8.roi)+'|'+pct(o.cross4.roi)+'|'+pct(o.cross2full.roi)+'|');}
 md.push('','','## 10月〜11月7日の級班・車立て別','','| 区分 | R | 基準8点 | ハイブリッド8点 | 別線4点 | ハイブリッド最大配当除外 |','|---|---:|---:|---:|---:|---:|');
 for(const [k,o] of Object.entries(result.by_period_cat.holdout))md.push('|'+k+'|'+o.races+'|'+pct(o.baseline8.roi)+'|'+pct(o.hybrid8.roi)+'|'+pct(o.cross4.roi)+'|'+pct(o.hybrid8.trim1)+'|');
 md.push('','','詳細：reports/mansha/crossline-halfyear-v2.json、個別レース台帳：reports/mansha/crossline-halfyear-v2-ledger.csv。');
 await fs.writeFile(path.join(dir,'crossline-halfyear-v2.md'),md.join('\n')+'\n');
 if(start===START&&end===END&&available.length===139&&cards.length===8736){
  const phase4=await require('./crossline-phase4-replay.cjs').run(cards,w,{dir});
  console.log('PHASE4_RETRO='+JSON.stringify({train:phase4.report.periods.train,sep:phase4.report.periods.sep,octnov:phase4.report.periods.octnov,selected:phase4.report.selected_phase3}));
 }
 console.log('HALFYEAR_REPLAY='+JSON.stringify({available:available.length,missing:missing.length,eligible:rows.length,train:result.by_period.train,validation:result.by_period.validation,holdout:result.by_period.holdout,byHoldoutCat:result.by_period_cat.holdout,bootstrap:result.holdout_bootstrap}));
 return {result,rows};
}
if(require.main===module)run().catch(e=>{console.error(e.stack||e);process.exitCode=1});
module.exports={syntheticBase8,predict,score,evaluate,summary,bootstrap,fetchPinnedDay,SOURCE_COMMIT,run};
