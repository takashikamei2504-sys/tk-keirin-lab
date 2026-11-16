#!/usr/bin/env node
'use strict';
/* Exhaustive, fixed-ref retrospective replay for all usable published male 7/9-car races
   in Aug 18 - Nov 15, 2026. This is a complete 90-day historical SOURCE window,
   never an inference for missing Nov 2025 - Aug 2026 full-year racecards.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Feed=require('../js/race-feed.js'),Policy=require('../js/routing/policy.js');
const Router=require('../js/routing/router.js'),B=require('../js/b-upset/engine.cjs');
const Audit=require('../js/results-audit.js'),Eval=require('../js/b-upset/evaluation.cjs');
const ARCHIVE_SHA='4588ec938a2fec9e81216d3fd3423329805aa3d5';
const BASE='https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/'+ARCHIVE_SHA+'/';
const WAYS=['auto','physical','causal','lab_v5','line','roi_coverage','b_upset_ad','b_upset_expanded'];
const SHARD=Number(process.env.YEAR_FULL_SHARD||0);
if(!Number.isInteger(SHARD)||SHARD<0||SHARD>8)throw Error('Expected shard 0..8');
const ROOT=new Date('2026-08-18T00:00:00Z').getTime(),MAX_DAY=new Date('2026-11-15T00:00:00Z').getTime(),DAY=86400000;
const dayString=offset=>new Date(ROOT+offset*DAY).toISOString().slice(0,10);
const dates=[];
for(let i=SHARD*10;i<Math.min(SHARD*10+10,90);i++){if(ROOT+i*DAY<=MAX_DAY)dates.push(dayString(i));}
if(!dates.length)throw Error('No dates in shard');
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const stage=(round,meeting)=>{
 const n=String(round||'').normalize('NFKC').replace(/[\s\u3000]/g,'');
 if(/準決|準々決|一次予選|二次予選|[一二]予選|特予選|予選|勝上/.test(n))return '勝ち上がり戦';
 if(/決勝/.test(n))return '決勝';
 if(meeting==='初日'&&/^(選抜|初日特選|初特選|特選|特別選抜)$/.test(n))return '初日特選';
 if(/特選|特秀|特優|特別優秀|特別選抜/.test(n))return '特選等';
 if(/一般|特一般|選抜|敗者|順位/.test(n))return '敗者戦';
 return 'その他';
};
for(const [r,day,expected] of [['準決勝','二日目','勝ち上がり戦'],['決勝','最終日','決勝'],['選抜','初日','初日特選'],['選抜','最終日','敗者戦']]){
 if(stage(r,day)!==expected)throw Error('Stage-classification regression '+r);
}
async function get(date){
 for(let i=0;i<3;i++)try{
  const resp=await fetch(BASE+date+'.json',{headers:{'user-agent':'tk-keirin-lab/research-pinned-historical-archive'},signal:AbortSignal.timeout(30000)});
  if(!resp.ok)throw Error('HTTP '+resp.status);
  const buf=Buffer.from(await resp.arrayBuffer()),day=JSON.parse(buf.toString('utf8'));
  if(day.date!==date||!Array.isArray(day.races))throw Error('Bad daily data '+date);
  return {date,day,sha256:sha(buf)};
 }catch(e){
  if(i===2)throw Error('Historical archive '+date+': '+e.message);
  await new Promise(resolve=>setTimeout(resolve,700*(i+1)));
 }
}
async function main(){
 const all=[]; // bounded 10 pinned public GitHub raw objects per job
 for(let i=0;i<dates.length;i+=3){
  const batch=await Promise.all(dates.slice(i,i+3).map(get));all.push(...batch);
 }
 const counts={},count=k=>{counts[k]=(counts[k]||0)+1};
 const seen=new Set(),cards=[],failures={};
 const fail=(k,e)=>{if(!failures[k])failures[k]={count:0,examples:[]};failures[k].count++;if(failures[k].examples.length<3)failures[k].examples.push(String(e).slice(0,220))};
 for(const d of all){
  for(const src of d.day.races){
   count('all_program_races');
   if(src.is_girls||src.entries?.some(e=>String(e.class_rank||'').startsWith('L'))){count('girls');continue}
   if(![7,9].includes(src.entries?.length)){count('other_car_count');continue}
   count('male_seven_nine');
   if(src.cancelled||src.is_cancelled||src.refunds?.length||src.refunded_cars?.length){count('cancel_refund');continue}
   try{
    const raw=Feed.convert(src,{date:d.date,generated_at:''});
    raw.source.mode='historical-archive-replay';raw.source.generated_at='';
    const category=Policy.classify(raw).key;
    const observed=Audit.result(src,d.day,new Date().toISOString());
    if(!observed||!observed.combos.length||observed.combos.some(c=>!Number.isInteger(c.payout)||c.payout<=0)){count('no_valid_trifecta');continue}
    const rid=observed.race_id;
    if(seen.has(rid))throw Error('duplicate race '+rid);
    seen.add(rid);
    cards.push({id:rid,category,date:d.date,venue:src.venue,meeting:String(d.day.venue_info?.[src.venue]?.meeting_day||'不明'),
      round:String(src.round_name||''),stage:stage(src.round_name,d.day.venue_info?.[src.venue]?.meeting_day),
      cars:src.entries.length,raw,observed,source_digest:d.sha256});
   }catch(e){count('invalid_card_or_result');fail('source_validation',e.message);}
  }
 }
 cards.sort((a,b)=>(a.date+a.id).localeCompare(b.date+b.id));
 const rows=[];
 for(const c of cards){
  const asOf=Date.parse(c.date+'T'+c.raw.start+':00+09:00')-600000;
  const predictions={};const models={};
  for(const name of WAYS.filter(k=>!k.startsWith('b_upset'))){
   try{
    const o=Router.build(c.raw,{}, {asOf,engine:name});
    if(o.race_id!==c.id)throw Error('Unexpected race id '+o.race_id+' vs '+c.id);
    predictions[name]=Eval.settle(o.tickets.map(t=>t.key),c.observed);
    models[name]=o.model?.model_id||null;
   }catch(e){fail(name,e.message)}
  }
  try{
   const o=B.build(c.raw,{asOf,replay:true});
   if(o.race_id!==c.id)throw Error('B-upset race mismatch');
   predictions.b_upset_ad=Eval.settle(o.research.ad.map(t=>t.key),c.observed);
   predictions.b_upset_expanded=Eval.settle(o.research.expanded.map(t=>t.key),c.observed);
   models.b_upset_ad=o.model?.model_id||null;models.b_upset_expanded=models.b_upset_ad;
  }catch(e){fail('b_upset',e.message)}
  rows.push({race_id:c.id,date:c.date,venue:c.venue,meeting_day:c.meeting,
    round:c.round,stage:c.stage,category:c.category,cars:c.cars,predictions,models});
  if(rows.length%40===0)console.log('REPLAY_PROGRESS',SHARD,rows.length,'/',cards.length);
 }
 const ncomplete=rows.filter(r=>WAYS.every(k=>r.predictions[k])).length;
 const sourceDigest=Object.fromEntries(all.map(x=>[x.date,x.sha256]));
 const data={schema:'tk-keirin-90day-complete-eight-way-replay-shard/v1',
   created_at:new Date().toISOString(),
   scope:{start:dates[0],end:dates[dates.length-1],shard:SHARD,days:dates.length,
    archive_commit:ARCHIVE_SHA,day_sha256:sourceDigest,
    outcome_blind_sampling:'none, every valid male 7/9-car settled race in fixed date window',
    program_seen:counts,male_candidate:counts.male_seven_nine||0,
    eligible:cards.length,rows:rows.length,complete:ncomplete},
   limitations:['This is exhaustive for the 90-day source only, not a one-year replay.',
    'Historical source contains posted line prediction; original pre-race capture time is not verifiable.',
    'All 8 engines are current revision retrospectively applied, not race-day frozen.',
    'No estimated missing payouts or lines; source validation failures counted.'],
   models:WAYS,failures,rows};
 const output=path.resolve(__dirname,'../reports/year-race-type/complete90-shards');
 fs.mkdirSync(output,{recursive:true});
 fs.writeFileSync(path.join(output,'part-'+SHARD+'.json'),JSON.stringify(data));
 console.log('COMPLETE90_SHARD',JSON.stringify({scope:data.scope,failures}).slice(0,12000));
 if(ncomplete!==rows.length||Object.keys(failures).some(x=>x!=='source_validation'))process.exitCode=2;
}
main().catch(e=>{console.error(e);process.exitCode=1});
