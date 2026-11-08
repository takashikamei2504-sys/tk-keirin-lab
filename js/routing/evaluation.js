/* Accounting for immutable automatic forecasts. Never used as prediction input. */
(function(root){'use strict';
const P=typeof module!=='undefined'?require('../model-provenance.js'):root.ModelProvenance;
const A=typeof module!=='undefined'?require('../results-audit.js'):root.ResultsAudit;
const H=typeof module!=='undefined'?require('./history.js'):root.RoutedHistory;
const excluded=category=>({status:'excluded',category});
function evaluate(record,observed){try{
 const o=record.out,r=o.input,expected=H.snapshot(o,record.saved_at);
 if(!expected||record.schema!==expected.schema||record.race_id!==A.raceKey(r)||o.race_id!==record.race_id||record.requested!=='auto'||o.selection.requested!=='auto'||record.model_id!==o.model.model_id||record.policy_version!==o.selection.policy_version||record.cutoff!==o.cutoff||Date.parse(o.cutoff)!==A.startAt(r)||record.input_sha256!==o.input_sha256||record.output_sha256!==P.sha256(o))return excluded('保存予想の時刻・識別子・ハッシュが不一致');
 const ids=r.riders.map(x=>x.no),tickets=o.tickets,valid=t=>Array.isArray(t.trio)&&t.trio.length===3&&new Set(t.trio).size===3&&t.trio.every(n=>Number.isInteger(n)&&ids.includes(n))&&t.key===t.trio.join('-');
 if(![7,9].includes(ids.length)||new Set(ids).size!==ids.length||!tickets.length||tickets.length>8||new Set(tickets.map(t=>t.key)).size!==tickets.length||!tickets.every(valid))return excluded('保存買い目が不正');
 if(!observed)return {status:'pending',category:'結果待ち'};
 if(observed.accounting_hold)return excluded(observed.accounting_hold);
 if(observed.race_id!==record.race_id||A.raceKey(observed.race)!==record.race_id||JSON.stringify(A.identity(observed.race))!==JSON.stringify(observed.identity)||JSON.stringify(A.identity(r))!==JSON.stringify(observed.identity)||r.start!==observed.race.start)return excluded('出走者・発走時刻が保存時から変化');
 if(!(Date.parse(observed.source_updated_at)>A.startAt(r)&&Date.parse(observed.collected_at)>=Date.parse(observed.source_updated_at))||!observed.combos?.length||new Set(observed.combos.map(t=>t.key)).size!==observed.combos.length||!observed.combos.every(valid))return excluded('結果の時刻・組合せが不正');
 const base=A.evaluate({pre_race:true,cutoff:o.cutoff,saved_at:record.saved_at,race_id:record.race_id,input:r,identity:A.identity(r),chosen:tickets,ranked_keys:tickets.map(t=>t.key),version:o.version,model_id:record.model_id},observed);
 // Do not turn missing payouts into zero, even when the forecast lost.
 if(observed.combos.some(t=>!Number.isInteger(t.payout)||t.payout<=0))return {...base,status:'awaiting_payout',category:'払戻待ち'};
 const keys=new Set(tickets.map(t=>t.key)),stake=tickets.length*100,payout=observed.combos.filter(t=>keys.has(t.key)).reduce((n,t)=>n+t.payout,0);
 return {...base,stake,payout,net:payout-stake,story_verified:false};
 }catch(_){return excluded('保存記録の形式が不正');}}
function summarize(rows){
 const s={races:rows.length,saved:0,evaluated:0,hits:0,stake:0,payout:0,net:0,pending:0,awaiting_payout:0,excluded:0,missed:0,error:0,misses:{}};
 for(const r of rows){if(r.saved_at)s.saved++;const e=r.evaluation;s[e.status]=(s[e.status]||0)+1;if(e.status==='evaluated'){s.hits+=Number(e.hit);s.stake+=e.stake;s.payout+=e.payout;if(!e.hit)s.misses[e.category]=(s.misses[e.category]||0)+1;}}
 // evaluated was incremented above. All amounts assume 100 yen per ticket.
 s.net=s.payout-s.stake;s.hit_rate=s.evaluated?s.hits/s.evaluated:null;s.roi=s.stake?s.payout/s.stake:null;
 const settled=rows.filter(r=>r.evaluation.status==='evaluated'),top=settled.slice().sort((a,b)=>b.evaluation.payout-a.evaluation.payout)[0];
 s.without_max=top?{race_id:top.race_id,evaluated:s.evaluated-1,stake:s.stake-top.evaluation.stake,payout:s.payout-top.evaluation.payout}:null;
 if(s.without_max)s.without_max.roi=s.without_max.stake?s.without_max.payout/s.without_max.stake:null;
 return s;
}
function group(rows,key){const bins={};for(const row of rows){const k=key(row);(bins[k]||(bins[k]=[])).push(row);}return Object.fromEntries(Object.entries(bins).sort().map(([k,v])=>[k,summarize(v)]));}
const api={evaluate,summarize,group};if(typeof module!=='undefined')module.exports=api;root.RoutedEvaluation=api;
})(typeof globalThis!=='undefined'?globalThis:this);
