#!/usr/bin/env node
'use strict';
/**
 * Reproduce existing engines on the *same* historical race cards.
 * Historical replay only; do not label results as time-frozen predictions.
 * Model inputs: source entries, line order, grade and race identifiers ONLY.
 * Settlements: stored trifecta results, used only after predictions.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Feed=require('../js/race-feed.js');
const Policy=require('../js/routing/policy.js');
const Router=require('../js/routing/router.js');
const B=require('../js/b-upset/engine.cjs');
const Audit=require('../js/results-audit.js');
const Eval=require('../js/b-upset/evaluation.cjs');
const BASE='https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/';
const START=process.env.FINAL_START||'2026-08-16';
const END=process.env.FINAL_END||'2026-11-07';
const MAX=Number(process.env.FINAL_MAX??240);
const OFFSET=Number(process.env.FINAL_OFFSET??0);
const TRAIN_N=240;
const EXPECTED_N=1298;
const EXPECTED_HOLDOUT=1058;
const FILE=process.env.FINAL_REPORT_NAME||'historical-20260816-20261107.json';
if(!/^[a-zA-Z0-9._-]+\.json$/.test(FILE))throw Error('Invalid report filename');
const HOLDOUT='2026-10-01';
const WAYS=['auto','physical','causal','lab_v5','line','roi_coverage','b_upset_ad','b_upset_expanded'];
const CORE=new Set(['一般','特一般','選抜','特別選抜']);
const lose=round=>/^(一般|特一般|選抜|特別選抜|特選|特秀|特優|特別優秀|敗者|順位決定)/.test(round);
const days=(a,b)=>{const out=[];for(let t=Date.parse(a+'T00:00Z');t<=Date.parse(b+'T00:00Z');t+=86400000)out.push(new Date(t).toISOString().slice(0,10));return out};
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const get=async date=>{
 for(let attempt=0;attempt<3;attempt++)try{
  const resp=await fetch(BASE+date+'.json',{signal:AbortSignal.timeout(20000),headers:{'user-agent':'TK-Keirin-Research'}});
  if(resp.status===404)return {date,missing:true};
  if(!resp.ok)throw Error('HTTP '+resp.status);
  const body=await resp.json();
  if(body.date!==date||!Array.isArray(body.races))throw Error('Invalid archive day');
  return {date,body};
 }catch(e){
  if(attempt===2)return {date,error:String(e).slice(0,160)};
  await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
 }
};
const queue=async ds=>{
 let i=0;const results=[];
 await Promise.all(Array.from({length:6},async()=>{
  while(i<ds.length){const date=ds[i++];results.push(await get(date))}
 }));
 return results.sort((a,b)=>a.date.localeCompare(b.date));
};
function asTicket(keys,result) {
 const unique=[...new Set(keys.filter(x=>/^[1-9]-[1-9]-[1-9]$/.test(x)))];
 return Eval.settle(unique,result);
}
function metric(rows){
 return Eval.metrics(rows);
}
function summary(rows){
 const compare=Object.fromEntries(WAYS.map(name=>[name,metric(rows.map(r=>r.predictions[name]).filter(Boolean))]));
 return {races:rows.length,complete:rows.filter(r=>WAYS.every(n=>r.predictions[n])).length,engines:compare};
}
function sections(rows){
 const by=(key)=>Object.fromEntries([...new Set(rows.map(key))].sort().map(k=>[k,summary(rows.filter(r=>key(r)===k))]));
 const common=rows.filter(r=>WAYS.every(n=>r.predictions[n]));
 return {
  available_case:summary(rows),
  complete_case:summary(common),
  core4_case:summary(common.filter(r=>CORE.has(r.round))),
  by_period:by(r=>r.date<HOLDOUT?'development_before_oct':'holdout_oct_nov'),
  by_cars:by(r=>String(r.cars)),
  by_grade:by(r=>r.category),
  by_grade_round:by(r=>r.category+'|'+r.round),
  by_partition:by(r=>r.partition),
  by_partition_grade:by(r=>r.partition+'|'+r.category),
  by_partition_grade_round:by(r=>r.partition+'|'+r.category+'|'+r.round),
  by_round:by(r=>r.round),
  by_month:by(r=>r.date.slice(0,7))
 };
}
async function main(){
 if(!Number.isInteger(MAX)||MAX<0||MAX>5000)throw Error('FINAL_MAX must be 0..5000');
 if(!Number.isInteger(OFFSET)||OFFSET<0||OFFSET>5000)throw Error('FINAL_OFFSET must be 0..5000');
 const inventory=days(START,END),all=await queue(inventory),missing=[],errors=[],exclusions={};
 const count=reason=>{exclusions[reason]=(exclusions[reason]||0)+1;};
 const cards=[],seen=new Set(),rounds={};
 for(const day of all){
  if(day.missing){missing.push(day.date);continue}
  if(day.error){errors.push({date:day.date,error:day.error});continue}
  for(const source of day.body.races){
   if(day.body.venue_info?.[source.venue]?.meeting_day!=='最終日')continue;
   const round=String(source.round_name||'').replace(/[\s\u3000]/g,'');
   rounds[round]=(rounds[round]||0)+1;
   if(!lose(round)){count('non_loser_round');continue}
   if(source.is_girls||source.entries?.some(e=>/^L/.test(e.class_rank||''))){count('girls');continue}
   if(![7,9].includes(source.entries?.length)){count('not_7_or_9');continue}
   if(source.cancelled||source.is_cancelled||source.refunds?.length||source.refunded_cars?.length){count('cancel_or_refund');continue}
   try{
    const raw=Feed.convert(source,{date:day.date,generated_at:''});
    // Historical cards may have been refreshed after the race: NEVER treat as
    // a contemporaneously captured prediction.
    raw.source.mode='historical-archive-replay';
    raw.source.generated_at='';
    const category=Policy.classify(raw).key;
    const observed=Audit.result(source,day.body,new Date().toISOString());
    if(!observed||observed.combos.some(c=>!Number.isInteger(c.payout)||c.payout<=0)){count('no_verified_payout');continue}
    const race_id=observed.race_id;
    if(seen.has(race_id)){count('duplicate_race');continue}
    seen.add(race_id);
    cards.push({race_id,date:day.date,venue:source.venue,race_no:Number(source.race_number),round,category,cars:source.entries.length,raw,observed});
   }catch(e){count('invalid_card_or_result:'+String(e.message).slice(0,70))}
  }
 }
 // Outcome-blind deterministic SHA256 sample; ALL engines use exact same races.
 cards.sort((a,b)=>hash(a.race_id+'|final-day-v1').localeCompare(hash(b.race_id+'|final-day-v1')));
 cards.forEach((r,i)=>{r.partition=i<TRAIN_N?'development_240':'holdout_1058';r.sample_rank=i;});
 const sample=MAX?cards.slice(OFFSET,OFFSET+MAX):cards.slice(OFFSET);
 sample.sort((a,b)=>(a.date+a.venue+String(a.race_no).padStart(2,'0')).localeCompare(b.date+b.venue+String(b.race_no).padStart(2,'0')));
 const rows=[],failures={};const fail=(key,e)=>{(failures[key]??={count:0,examples:[]}).count++;if(failures[key].examples.length<3)failures[key].examples.push(String(e).slice(0,230))};
 for(const card of sample){
  const at=Date.parse(card.date+'T'+card.raw.start+':00+09:00')-600000;
  const predictions={}; const models={};
  for(const name of WAYS.filter(n=>!n.startsWith('b_upset'))){
   try{
    const out=Router.build(card.raw,{}, {asOf:at,engine:name});
    if(out.race_id!==card.race_id)throw Error('Race id mismatch');
    predictions[name]=asTicket(out.tickets.map(t=>t.key),card.observed);
    models[name]=out.model?.model_id||null;
   }catch(e){fail(name,e.message)}
  }
  try{
   const out=B.build(card.raw,{asOf:at,replay:true});
   if(out.race_id!==card.race_id)throw Error('B-UPSET race mismatch');
   predictions.b_upset_ad=asTicket(out.research.ad.map(t=>t.key),card.observed);
   predictions.b_upset_expanded=asTicket(out.research.expanded.map(t=>t.key),card.observed);
   models.b_upset_ad=out.model?.model_id||null;models.b_upset_expanded=models.b_upset_ad;
  }catch(e){fail('b_upset',e.message)}
  rows.push({race_id:card.race_id,date:card.date,venue:card.venue,race_no:card.race_no,round:card.round,category:card.category,cars:card.cars,partition:card.partition,sample_rank:card.sample_rank,
   predictions,models});
  if(rows.length%20===0)console.log('replayed',rows.length,'/',sample.length,'complete',rows.filter(r=>WAYS.every(n=>r.predictions[n])).length);
 }
 const fixedRules={'A級_7':'causal','S級_7':'physical','S級_9':'b_upset_ad','チャレンジ_7':'b_upset_expanded'};
 const evaluateFixed=part=>{
  const selected=part.filter(r=>r.predictions[fixedRules[r.category]]);
  return {races:part.length,evaluated:selected.length,missing:part.length-selected.length,metrics:metric(selected.map(r=>r.predictions[fixedRules[r.category]])),by_category:Object.fromEntries([...new Set(part.map(r=>r.category))].sort().map(k=>{const rs=part.filter(r=>r.category===k),ok=rs.filter(r=>r.predictions[fixedRules[k]]);return [k,{races:rs.length,mode:fixedRules[k]||null,evaluated:ok.length,missing:rs.length-ok.length,metrics:metric(ok.map(r=>r.predictions[fixedRules[k]]))}]}))};
 };
 const report={
  schema:'tk-keirin-final-day-loser-replay/v1',
  generated_at:new Date().toISOString(),
  scope:{start:START,end:END,requested_days:inventory.length,available_days:all.filter(x=>x.body).length,
   missing_days:missing,fetch_errors:errors,eligible:cards.length,selected:sample.length,offset:OFFSET,
   expected_eligible:EXPECTED_N,expected_development:TRAIN_N,expected_holdout:EXPECTED_HOLDOUT,
   exact_1298_reconstructed:cards.length===EXPECTED_N,
   holdout_partition_verified:cards.length===EXPECTED_N&&cards.slice(TRAIN_N).length===EXPECTED_HOLDOUT,
   final_day_source:'venue_info[venue].meeting_day === 最終日',included_rounds:rounds,
   exclusions,sampled_days:new Set(sample.map(x=>x.date)).size,
   sample_rule:'SHA256(race_id | final-day-v1) ascending; OFFSET '+OFFSET+'; '+(MAX?'cap '+MAX:'all remaining'),
   partition_rule:'Original 240 are SHA256-ranked 0..239; untouched 1,058 are 240..1297. Both use identical original 20261115 inventory criteria.'},
  engines:WAYS,
  methodology:{
   input:'Historical public basic start cards only: entries, rider ranks/scores/styles, lineup and race identifiers; no current form, s_counts, EX or post-race signals',
   model_time:'Present repository engine revision replayed on old cards; NOT stored before-race forecasts',
   odds:'100JPY per distinct trifecta ticket; outcome payout records used only for settlement',
   core4:[...CORE],additional_loser_rounds:'特選/特秀/特優/特別優秀/敗者/順位決定',
   fairness:'complete_case contains races where every compared engine returned a valid ticket set, with no outcome-based filtering',
   risks:'Public archive feed is not independently official-verified; rules and model revisions were built with historical information, so in-sample bias persists; models with different ticket counts have different spend. If current model IDs differ from earlier replay, 240 vs 1,058 cannot claim same fixed version.'},
  stats:sections(rows),
  fixed_240_rule:{rules:fixedRules,development:evaluateFixed(rows.filter(r=>r.partition==='development_240')),holdout:evaluateFixed(rows.filter(r=>r.partition==='holdout_1058'))},
  failures,
  races:rows.map(r=>({...r,predictions:Object.fromEntries(Object.entries(r.predictions).map(([key,val])=>[key,{points:val.points,stake:val.stake,payout:val.payout,hit:val.hit}]))}))
 };
 const dir=path.resolve(__dirname,'../reports/final-day');
 fs.mkdirSync(dir,{recursive:true});
 const f=path.join(dir,FILE);
 fs.writeFileSync(f,JSON.stringify(report,null,2)+'\n');
 console.log('RESULT',JSON.stringify({scope:report.scope,complete_case:report.stats.complete_case,fixed_240_rule:report.fixed_240_rule,failures:report.failures}).slice(0,14000));
}
main().catch(e=>{console.error(e);process.exitCode=1});
