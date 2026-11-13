#!/usr/bin/env node
'use strict';
// Phase4 retrospective evaluator. Outcomes ONLY score frozen ticket sets; training
// sees Jun-Aug labels and never inspects September-November target labels.
const fs=require('node:fs/promises'),path=require('node:path');
const Phase4=require('./crossline-phase4.cjs');
const Gate=require('./crossline-phase3-gate.cjs');
const MODES=['legacy4','conditional_pair4','cross_third4','conditional_joint4','blend25_4','blend50_4'];
const sum=(rows,fn)=>rows.reduce((a,r)=>a+fn(r),0);
function summarize(rows){
 const cross=rows.filter(r=>r.cross12),pairRecall={};
 for(const key of ['legacy','conditional']){
  const correct=cross.filter(r=>r.pairHit[key]);
  pairRecall[key]={cross_races:cross.length,correct_pairs:correct.length,recall:cross.length?correct.length/cross.length:null,
   third_hit_given_pair:correct.length?sum(correct,r=>+r.views[key==='legacy'?'legacy4':'conditional_joint4'].hit)/correct.length:null};
 }
 const strategies={};
 for(const m of MODES){
  const stake=sum(rows,r=>r.views[m].stake),payout=sum(rows,r=>r.views[m].payout);
  const best=rows.slice().sort((a,b)=>b.views[m].payout-a.views[m].payout);
  const trim=n=>{const part=best.slice(0,n),money=stake-sum(part,r=>r.views[m].stake);return money?(payout-sum(part,r=>r.views[m].payout))/money:null;};
  strategies[m]={races:rows.length,stake,payout,net:payout-stake,hit:sum(rows,r=>+r.views[m].hit),roi:stake?payout/stake:null,trim1:best.length&&best[0].views[m].payout?trim(1):null,trim3:best.length>=3&&best[2].views[m].payout?trim(3):null,trim5:best.length>=5&&best[4].views[m].payout?trim(5):null};
 }
 return {races:rows.length,cross12:cross.length,thirdline:cross.filter(r=>r.thirdline).length,pairRecall,strategies};
}
function group(rows,field){const g={};for(const r of rows)(g[field(r)]??=[]).push(r);return Object.fromEntries(Object.entries(g).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,summarize(x)]));}
function evaluate(cards,base,model){
 if(!Phase4.weightsOK(model))throw Error('Phase4 weights invalid');
 const scored=cards.map(c=>{
  const p=Phase4.predict(c,base,model),key=c.finish.join('-'),pair=c.finish.slice(0,2).join('-');
  const views=Object.fromEntries(MODES.map(m=>{
   const keys=p.tickets[m],hit=keys.includes(key);
   return [m,{stake:keys.length*100,payout:hit?c.payout:0,hit}];
  }));
  const selected=Gate.select({category:c.cat,highrisk:!!c.riskPriority,pairs:p.pairs.legacy}).eligible;
  const a=c.byNo.get(c.finish[0]),b=c.byNo.get(c.finish[1]),d=c.byNo.get(c.finish[2]);
  return {id:[c.date,c.venue,c.raceNo].join(':'),date:c.date,category:c.cat,highrisk:!!c.riskPriority,selected,
   cross12:a.line!==b.line,thirdline:a.line!==b.line&&d.line!==a.line&&d.line!==b.line,
   pairHit:{legacy:p.pairs.legacy.includes(pair),conditional:p.pairs.conditional.includes(pair)},
   actual:key,payout:c.payout,legacy_pairs:p.pairs.legacy.join('|'),conditional_pairs:p.pairs.conditional.join('|'),views};
 });
 const train=scored.filter(r=>r.date<Phase4.TRAIN_END),sep=scored.filter(r=>r.date>=Phase4.TRAIN_END&&r.date<'2026-10-01'),later=scored.filter(r=>r.date>='2026-10-01');
 const periods={train,sep,octnov:later};
 const report={schema:'crossline-phase4-replay/v1',model:Phase4.SCHEMA,periods:Object.fromEntries(Object.entries(periods).map(([k,v])=>[k,summarize(v)])),
  by_period_category:Object.fromEntries(Object.entries(periods).map(([k,v])=>[k,group(v,r=>r.category)])),
  by_period_risk:Object.fromEntries(Object.entries(periods).map(([k,v])=>[k,group(v,r=>r.highrisk?'highrisk':'other')])),
  selected_phase3:Object.fromEntries(Object.entries(periods).map(([k,v])=>[k,summarize(v.filter(r=>r.selected))])),
  selected_by_category:Object.fromEntries(Object.entries(periods).map(([k,v])=>[k,group(v.filter(r=>r.selected),r=>r.category)])),
  notes:[
   'All model weights trained only on June-August 2026 historical result labels.',
   'Top-two forecast pairs and four-ticket predictions are computed without using actual outcome or payout.',
   'Sep and Oct-Nov already observed in previous studies; not a virgin holdout. Future pre-race shadow test required.',
   'Phase3 selection here uses fixed historic highrisk and old predicted pairs, avoiding target information.',
   'No real pre-close odds supplied. ROI is retrospective payout/stake, NOT a calibrated EV estimate.',
   'Blends at 25% and 50% were selected before this replay and are research-only ablations, not optimized against observed returns.',
   'No production forecasts, ticket rankings, or purchase logic changed.'
  ]};
 return {report,rows:scored};
}
async function run(cards,base,{dir=path.join(__dirname,'../reports/mansha')}={}){
 const train=cards.filter(c=>c.date<Phase4.TRAIN_END);
 const model=Phase4.fit(train);
 const {report,rows}=evaluate(cards,base,model);
 await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(path.join(dir,'crossline-phase4-model.json'),JSON.stringify(model,null,2)+'\n');
 await fs.writeFile(path.join(dir,'crossline-phase4-evaluation.json'),JSON.stringify(report,null,2)+'\n');
 const columns=['id','date','category','highrisk','phase3_selected','actual','payout','cross12','thirdline','old_pair_hit','conditional_pair_hit','legacy_pairs','conditional_pairs'];
 for(const m of MODES)columns.push(m+'_stake',m+'_payout');
 const lines=[columns.join(',')];
 for(const r of rows)lines.push([r.id,r.date,r.category,+r.highrisk,+r.selected,r.actual,r.payout,+r.cross12,+r.thirdline,+r.pairHit.legacy,+r.pairHit.conditional,r.legacy_pairs,r.conditional_pairs,...MODES.flatMap(m=>[r.views[m].stake,r.views[m].payout])].join(','));
 await fs.writeFile(path.join(dir,'crossline-phase4-ledger.csv'),lines.join('\n')+'\n');
 const fmt=x=>x?.roi==null?'-':(x.roi*100).toFixed(1)+'%';
 const md=['# Phase4: conditional runner-up and third line research','',
 'Caution: retrospective only; all model training restricted to June-August 2026. Subsequent dates were previously inspected in other studies. No production rollout.','',
 '| Evaluation period | races | old 4 tickets | conditional 2nd only | conditional 3rd only | both conditional | blend 25% | blend 50% |',
 '|---|---:|---:|---:|---:|---:|---:|'];
 for(const [key,label] of [['train','June-Aug train'],['sep','September diagnostic'],['octnov','Oct-Nov diagnostic']]){
  const x=report.periods[key],n=x.strategies;
  md.push('|'+label+'|'+x.races+'|'+fmt(n.legacy4)+'|'+fmt(n.conditional_pair4)+'|'+fmt(n.cross_third4)+'|'+fmt(n.conditional_joint4)+'|'+fmt(n.blend25_4)+'|'+fmt(n.blend50_4)+'|');
 }
 md.push('','## Phase 3 pre-race-selected A7/C7 high-risk non-reverse subset','');
 for(const [key,label] of [['sep','September'],['octnov','Oct-Nov']]){
  const x=report.selected_phase3[key];
  md.push('- '+label+': '+x.races+' races. Old 4='+fmt(x.strategies.legacy4)+', conditional joint 4='+fmt(x.strategies.conditional_joint4)+', blend25='+fmt(x.strategies.blend25_4)+', blend50='+fmt(x.strategies.blend50_4)+'.');
 }
 md.push('','## 1st/2nd pair capture (among actual cross-line first-two finishes)','');
 for(const key of ['sep','octnov']){
  const x=report.periods[key];md.push('- '+key+': '+x.cross12+' actual cross-line races. Legacy '+x.pairRecall.legacy.correct_pairs+'; conditional '+x.pairRecall.conditional.correct_pairs+'.');
 }
 md.push('','The ROI needs prospective confirmation, top-payout trimming, and genuine pre-close odds for EV. Results and payouts are scoring-only.');
 await fs.writeFile(path.join(dir,'crossline-phase4-findings.md'),md.join('\n')+'\n');
 return {report,model,rows};
}
module.exports={MODES,summarize,evaluate,run};