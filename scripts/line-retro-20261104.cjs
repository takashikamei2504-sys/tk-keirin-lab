'use strict';
// One-off research replay. Pre-race frozen inputs only; actual outcomes are joined
// strictly after all V1.3.7 forecasts have been generated.
const fs=require('node:fs'),path=require('node:path');
const Engine=require('../js/line/engine.js');
const base='data/line_history/2026-11-04',files=fs.readdirSync(base).filter(x=>x.endsWith('.json'));
const eligible=new Map(),scanned={files:files.length,broken:0,not_s:0,not_prerace:0,duplicate:0};
const startUTC=(r,cutoff)=>Date.parse(cutoff);
for(const filename of files){
 let item;
 try { item=JSON.parse(fs.readFileSync(path.join(base,filename),'utf8')); }
 catch(err){ scanned.broken++; continue; }
 const out=item.out,r=out?.input?.race,at=Date.parse(out?.input?.as_of),saved=Date.parse(item.saved_at),cutoff=startUTC(r,out?.input?.cutoff);
 if(!r||r.date!=='2026-11-04'||out.mode!=='pre-race'||!Number.isFinite(at)||!Number.isFinite(saved)||!Number.isFinite(cutoff)||!(at<=saved&&saved<cutoff)){
  scanned.not_prerace++;continue;
 }
 if(!r.riders?.length||!r.riders.every(x=>/^S(?:S|1|2)/.test(String(x.meta?.rank||'')))){scanned.not_s++;continue;}
 const key=item.race_id,prev=eligible.get(key);
 if(!prev||saved<Date.parse(prev.saved_at))eligible.set(key,item);
 else scanned.duplicate++;
}
const chosen=[...eligible.values()].sort((a,b)=>a.race_id.localeCompare(b.race_id,'ja'));
const predicted=[],failures=[];
for(const original of chosen){
 const race=original.out.input.race,pack=original.out.input.replay_pack||{},asOf=Date.parse(original.out.input.as_of);
 try {
  const calc=Engine.build(race,{intelligence:pack},{asOf,replay:true});
  const tickets=calc.tickets.map(t=>t.key);
  const alts=calc.alternatives.map(x=>({pair:x.finish?.pair,mode:x.finish?.mode,score:x.score})).slice(0,3);
  const out={race_id:original.race_id,start:race.start,grade:race.grade,class:race.class,
    pre_race_as_of:original.out.input.as_of,pre_race_saved_at:original.saved_at,
    original_model_id:original.out.provenance?.model?.model_id,
    replay_model_id:calc.provenance.model.model_id,
    lineup:race.lineup,main:calc.main.finish?.pair?.join('-'),mode:calc.main.finish?.mode,
    top_tickets:tickets,compressed:calc.compressed.map(x=>x.text),alternatives:alts,
    winner_candidates:[...new Set(tickets.map(x=>Number(x.split('-')[0])))],
    main_scenario:calc.main.scenes?.map(s=>({phase:s.phase,control:s.control,events:s.events?.map(e=>e.action)}))
  };
  predicted.push(out);
  console.log('LINE_FORECAST '+JSON.stringify({race:out.race_id,asof:out.pre_race_as_of,main:out.main,mode:out.mode,tickets:out.top_tickets,alternatives:alts.map(x=>x.pair?.join('-'))}));
 }catch(err){
  failures.push({race_id:original.race_id,error:String(err?.stack||err).slice(0,1200)});
  console.log('LINE_FAILED '+JSON.stringify({race:original.race_id,error:String(err?.message||err)}));
 }
}
// Actual outcomes must not be loaded until all forecasts above are finalized.
const actuals=JSON.parse(fs.readFileSync('data/lab_history/2026-11-04/results.json','utf8'));
const byRace=new Map((actuals.results||[]).map(x=>[x.race_id,x]));
let evaluated=0,hits=0,winnerMatched=0,pairMatched=0,pending=0,invalidResult=0;
for(const pred of predicted){
 const actual=byRace.get(pred.race_id);
 if(!actual?.combos?.length){pred.result={status:'pending'};pending++;continue;}
 const actualCombo=actual.combos[0],key=actualCombo.key,sequence=actualCombo.trio;
 if(!Array.isArray(sequence)||sequence.length!==3||!sequence.every(Number.isInteger)){pred.result={status:'unverified_result'};invalidResult++;continue;}
 pred.result={status:'compared',trio:key,hit:pred.top_tickets.includes(key),
   winner_in_tickets:pred.winner_candidates.includes(sequence[0]),
   ordered_pair_in_tickets:pred.top_tickets.some(t=>t.startsWith(sequence.slice(0,2).join('-')+'-')),
   payout:actualCombo.payout,source_verified:actual.verification||'public_feed_unverified'};
 evaluated++;hits+=Number(pred.result.hit);winnerMatched+=Number(pred.result.winner_in_tickets);pairMatched+=Number(pred.result.ordered_pair_in_tickets);
 console.log('LINE_COMPARE '+JSON.stringify({race:pred.race_id,main:pred.main,result:key,hit:pred.result.hit,winner_hit:pred.result.winner_in_tickets,pair_hit:pred.result.ordered_pair_in_tickets}));
}
const report={date:'2026-11-04',scope:'S級男子: first genuinely frozen pre-race input replayed with LINE V1.3.7; not an authentic V1.3.7 pre-race prediction',model_version:Engine.VERSION,
 created_at:new Date().toISOString(),scanned,selected:chosen.length,generated:predicted.length,errors:failures,
 summary:{evaluated,hits,winnerMatched,pairMatched,pending,invalidResult},predictions:predicted};
fs.mkdirSync('reports/line',{recursive:true});
fs.writeFileSync('reports/line/retro-20261104.json',JSON.stringify(report,null,2)+'\n');
console.log('LINE_RETRO_SUMMARY '+JSON.stringify({scanned,selected:chosen.length,generated:predicted.length,failed:failures.length,...report.summary}));
