'use strict';
/* Outcome-only stage. Never called by predictor or EX collector; future-prediction
 * records are immutable, and outcomes enter ONLY after race start.
 */
const fs=require('node:fs'),path=require('node:path');
const Audit=require('../js/roi/audit.cjs');
const Shadow=require('../js/ex-roi/shadow.cjs');
const {save}=require('./roi-audit.cjs');
const ROOT=path.join(__dirname,'..');
function read(file,fallback){return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback;}
function pairedRows(data){
 const base=path.join(data,'ex_roi','forecasts');
 if(!fs.existsSync(base))return [];
 const records=[];
 for(const date of fs.readdirSync(base).filter(s=>/^\d{4}-\d{2}-\d{2}$/.test(s)).sort()){
  const folder=path.join(base,date);
  const modern=read(path.join(data,'lab_history',date,'results.json'),{results:[]});
  const legacy=read(path.join(data,'lab_history',date+'.json'),{results:[]});
  const results=new Map([...(legacy.results||[]),...(modern.results||[])].map(r=>[r.race_id,r]));
  for(const file of fs.readdirSync(folder).filter(x=>/^[a-f0-9]{64}\.json$/.test(x)).sort()){
   const p=read(path.join(folder,file),null),result=results.get(p?.race_id);
   if(!p||p.schema!=='tk-ex-roi-ab-forecast/v1'||
      !Number.isFinite(Date.parse(p.saved_at))||
      !(Date.parse(p.as_of)<=Date.parse(p.saved_at)&&Date.parse(p.saved_at)<Date.parse(p.cutoff))||
      !Array.isArray(p.applied)||!p.applied.length||
      p.applied.some(a=>!(Date.parse(a.collected_at)<=Date.parse(p.as_of)&&Date.parse(a.collected_at)<Date.parse(p.cutoff)))||
      p.tickets_per_arm!==Shadow.TICKETS||
      !Array.isArray(p.baseline)||!Array.isArray(p.ex)||
      p.baseline.length!==Shadow.TICKETS||p.ex.length!==Shadow.TICKETS||
      new Set(p.baseline.map(t=>t.key)).size!==Shadow.TICKETS||
      new Set(p.ex.map(t=>t.key)).size!==Shadow.TICKETS)continue;
   const template={race_id:p.race_id,input:p.input,identity:p.identity,cutoff:p.cutoff,model_id:p.model_id};
   if(!result){records.push({model_id:p.model_id,race_id:p.race_id,status:'pending',
     as_of:p.as_of});continue;}
   const previous=Audit.settle({...template,chosen:p.baseline},result);
   const candidate=Audit.settle({...template,chosen:p.ex},result);
   if(previous.status!=='evaluated'||candidate.status!=='evaluated'){
    records.push({model_id:p.model_id,race_id:p.race_id,status:'excluded',reason:previous.status!=='evaluated'?previous.status:candidate.status});
    continue;
   }
   records.push({model_id:p.model_id,race_id:p.race_id,status:'evaluated',
     date:p.date,baseline:previous,ex:candidate,changed:!p.delta?.same,
     ex_rider_count:p.applied.length,original_ex_metrics:p.observed_ex_metrics,
     paired_net_delta:candidate.wins.reduce((n,v)=>n+v,0)-previous.wins.reduce((n,v)=>n+v,0)});
  }
 }
 return records;
}
function lowerDailyDelta(rows){
 const day=new Map();
 for(const r of rows){
  const entry=day.get(r.date)||{sum:0,n:0};
  entry.sum+=r.paired_net_delta;entry.n++;day.set(r.date,entry);
 }
 const samples=[...day.values()].map(v=>v.sum/v.n),n=samples.length;
 if(n<2)return {days:n,lower_per_race_yen:null,mean_per_race_yen:null};
 const mean=samples.reduce((s,v)=>s+v,0)/n,
   variance=samples.reduce((s,x)=>s+(x-mean)**2,0)/(n-1),
   lower=mean-2.2*Math.sqrt(variance/n);
 return {days:n,mean_per_race_yen:Math.round(mean*100)/100,
   lower_per_race_yen:Math.round(lower*100)/100};
}
function summarize(records,currentModel){
 const relevant=records.filter(x=>x.model_id===currentModel),
   evaluated=relevant.filter(x=>x.status==='evaluated'),n=evaluated.length;
 const baseline=Audit.summarize(evaluated.map(x=>x.baseline)),
   ex=Audit.summarize(evaluated.map(x=>x.ex));
 const delta={roi:baseline.roi===null||ex.roi===null?null:ex.roi-baseline.roi,
   payout_yen:ex.payout-baseline.payout,net_yen:ex.net-baseline.net,
   hit_rate:baseline.hit_rate===null||ex.hit_rate===null?null:ex.hit_rate-baseline.hit_rate,
   first_capture:baseline.first_capture===null||ex.first_capture===null?null:ex.first_capture-baseline.first_capture,
   pair_capture:baseline.pair_capture===null||ex.pair_capture===null?null:ex.pair_capture-baseline.pair_capture};
 const lower=lowerDailyDelta(evaluated);
 const ready=n>=200&&lower.days>=14&&lower.lower_per_race_yen>0&&
   delta.pair_capture>=0&&ex.trimmed?.[1]>=baseline.trimmed?.[1]&&ex.net>baseline.net;
 const reduce=a=>({evaluated:a.evaluated,purchased:a.purchased,stake:a.stake,payout:a.payout,
   net:a.net,roi:a.roi,hits:a.hits,hit_rate:a.hit_rate,first_capture:a.first_capture,
   pair_capture:a.pair_capture,max_drawdown:a.max_drawdown,trimmed_top1_roi:a.trimmed?.[1],
   without_top_race:a.without_top_race});
 return {schema:'tk-ex-roi-paired-report/v1',model_id:currentModel,
   generated_at:new Date().toISOString(),evaluated:n,
   pending:relevant.filter(r=>r.status==='pending').length,
   excluded:relevant.filter(r=>r.status==='excluded').length,
   changed_races:evaluated.filter(r=>r.changed).length,
   same_stake_per_arm_per_race_yen:Shadow.TICKETS*100,
   first_record_at:relevant.map(x=>x.as_of).filter(Boolean).sort()[0]||null,
   baseline:reduce(baseline),ex:reduce(ex),delta,confidence:lower,
   ready_for_review:ready,auto_buy_enabled:false,
   policy:{minimum_races:200,minimum_independent_days:14,
     cluster_daily_lower_net_positive:true,no_pair_capture_regression:true,
     no_trimmed_top1_roi_regression:true,
     review_only:'Prospective evidence can nominate an EX model for review, but never automatically authorize EV betting.'},
   method:'Same immutable pre-race input, EX-only difference; 8 tickets per arm at 100 yen each. Settled against recorded official-result proxy with identity and publication-time checks; no hindsight and no retroactive EX.',
   caveat:'EX-on ROI improvement is not demonstrated unless evaluated paired races pass preregistered gates. No licensed probability calibration; do not infer profit from ranking scores.'};
}
function evaluate(data=path.join(ROOT,'data'),modelId){
 const rows=pairedRows(data);
 const currentModel=modelId||require('./ex-ab-freeze.cjs').model();
 const report=summarize(rows,currentModel);
 const folder=path.join(data,'ex_roi');
 fs.mkdirSync(folder,{recursive:true});
 save(path.join(folder,'evaluation.json'),report);
 return report;
}
if(require.main===module){
 try{const r=evaluate();console.log('EX_AB_EVALUATION '+JSON.stringify({
  evaluated:r.evaluated,pending:r.pending,changed:r.changed_races,baseline_roi:r.baseline.roi,
  ex_roi:r.ex.roi,delta_pair:r.delta.pair_capture,ready:r.ready_for_review,auto_buy:r.auto_buy_enabled}));}
 catch(e){console.error('EX_AB_EVALUATION_ERROR '+e.message);process.exitCode=1;}
}
module.exports={pairedRows,lowerDailyDelta,summarize,evaluate};
