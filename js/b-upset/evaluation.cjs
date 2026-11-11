'use strict';
const P=require('../model-provenance.js');
const A=require('../results-audit.js');
const Patterns=require('./patterns.cjs');

function settle(keys, observed) {
  const unique=[...new Set(keys)];
  const paid=observed.combos.filter(t => unique.includes(t.key));
  const stake=unique.length*100,payout=paid.reduce((s,t)=>s+t.payout,0);
  return {points:unique.length,stake,payout,net:payout-stake,hit:paid.length>0,winning_keys:paid.map(t=>t.key)};
}

function evaluate(record, observed, actualB) {
  try {
    const o=record.out;
    const time=Date.parse(record.saved_at),cutoff=Date.parse(o.cutoff);
    if (record.schema!=='tk-b-upset-frozen/v2' || o.mode!=='pre-race' ||
        !(Date.parse(o.input.source.generated_at)<=Date.parse(o.as_of) && Date.parse(o.as_of)<=time && time<cutoff) ||
        record.race_id!==o.race_id || o.race_id!==A.raceKey(o.input) ||
        cutoff!==A.startAt(o.input) || o.input.source.mode!=='live-public-feed' ||
        record.output_sha256!==P.sha256(o) || o.input_sha256!==P.sha256(o.input)) throw Error('発走前保存・ハッシュ不一致');
    if (!observed) return {status:'pending',actual_b:null};
    if (observed.accounting_hold) throw Error(observed.accounting_hold);
    if (observed.race_id!==o.race_id || JSON.stringify(A.identity(o.input))!==JSON.stringify(observed.identity) ||
        o.input.start!==observed.race.start || !(Date.parse(observed.source_updated_at)>cutoff)) throw Error('出走者・結果時刻・発走時刻不一致');
    if (observed.combos.some(t=>!Number.isInteger(t.payout)||t.payout<=0)) return {status:'awaiting_payout',actual_b:null};
    const views={};
    for (const key of ['ad','expanded','all_candidates','third_all']) {
      views[key]=settle(o.research[key].map(t=>typeof t==='string'?t:t.key),observed);
    }
    views.roi_ev=settle(o.recommendation.tickets.map(t=>t.key),observed);
    const patterns={};
    for(const pattern of Object.keys(Patterns.LABELS)){
      const keys=o.research.expanded.filter(t=>t.pattern===pattern).map(t=>t.key);
      patterns[pattern]=settle(keys,observed);
    }
    let actual=null;
    if (actualB && actualB.verified_identity===true && actualB.race_id===o.race_id &&
        actualB.combos?.some(k=>observed.combos.some(c=>c.key===k)) &&
        JSON.stringify(actualB.identity)!==undefined &&
        JSON.stringify(actualB.identity)===JSON.stringify(observed.identity)) {
      const map=Patterns.membership(o.input.lineup),line=map.get(actualB.b_no)?.line_id;
      if(line) actual={no:actualB.b_no,line_id:line,source_url:actualB.source_url,
        primary_correct:o.scenarios[0]?.b_no===actualB.b_no,
        candidate_line_hit:o.scenarios.some(s=>s.b_line===line),
        nonfavorite:line!==o.ranking.favorite,
        patterns:line===o.ranking.favorite?[]:observed.combos.map(c=>Patterns.classify(c.trio,o.input.lineup,o.ranking.favorite,line))};
    }
    return {status:'evaluated',views,patterns,actual_b:actual};
  } catch(e) { return {status:'excluded',reason:e.message,actual_b:null}; }
}

function metrics(rows) {
  const n=rows.length,stake=rows.reduce((s,r)=>s+r.stake,0),payout=rows.reduce((s,r)=>s+r.payout,0);
  const hits=rows.filter(r=>r.hit),winners=hits.slice().sort((a,b)=>b.payout-a.payout);
  const trim=k=>{
    const removed=winners.slice(0,k),s=stake-removed.reduce((v,r)=>v+r.stake,0),p=payout-removed.reduce((v,r)=>v+r.payout,0);
    return s?p/s:null;
  };
  let balance=0,peak=0,drawdown=0;
  for(const r of rows){balance+=r.net;peak=Math.max(peak,balance);drawdown=Math.max(drawdown,peak-balance);}
  return {n,purchased:rows.filter(r=>r.points>0).length,hits:hits.length,hit_rate:n?hits.length/n:null,
    points:rows.reduce((s,r)=>s+r.points,0),avg_points:n?rows.reduce((s,r)=>s+r.points,0)/n:null,
    stake,payout,net:payout-stake,roi:stake?payout/stake:null,max_drawdown:drawdown,
    trim1:trim(1),trim5:trim(5),max_payout:winners[0]?.payout||0,
    top1_dependency:payout?(winners[0]?.payout||0)/payout:null};
}

function summarize(rows) {
  const settled=rows.filter(r=>r.evaluation.status==='evaluated').sort((a,b)=>(a.date+'T'+a.start).localeCompare(b.date+'T'+b.start)||a.race_id.localeCompare(b.race_id));
  const views={},patterns={};
  for(const name of ['ad','expanded','all_candidates','third_all','roi_ev'])views[name]=metrics(settled.map(r=>r.evaluation.views[name]));
  for(const pattern of Object.keys(Patterns.LABELS))patterns[pattern]=metrics(settled.map(r=>r.evaluation.patterns[pattern]));
  const known=settled.map(r=>r.evaluation.actual_b).filter(Boolean);
  return {saved:rows.length,evaluated:settled.length,pending:rows.filter(r=>r.evaluation.status==='pending').length,
    excluded:rows.filter(r=>r.evaluation.status==='excluded').length,actual_b_known:known.length,
    b_correct:known.filter(r=>r.primary_correct).length,candidate_b_hit:known.filter(r=>r.candidate_line_hit).length,
    nonfavorite_b:known.filter(r=>r.nonfavorite).length,views,patterns};
}

module.exports={settle,evaluate,metrics,summarize};
