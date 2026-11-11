'use strict';

const Input = require('../line/input.js');
const BAxis = require('../b-axis/engine.js');
const Policy = require('../routing/policy.js');
const Patterns = require('./patterns.cjs');
const P = require('../model-provenance.js');
const Build = require('./build.json');
const Value = require('../roi/value.cjs');

function rankLines(race, asOf) {
  const riders = new Map(race.riders.map(r => [r.no,r]));
  const lines = race.lineup.map((members,index) => {
    const scores = members.map(no => riders.get(no).score);
    return {id:'L'+index, members:members.slice(), strength:scores[0]*.6+Math.max(...scores)*.25+(scores[1] ?? scores[0])*.15};
  }).sort((a,b) => b.strength-a.strength || a.id.localeCompare(b.id));
  return {
    basis:'pre_race_strength', market_rank:null, as_of:asOf,
    formula:'先頭得点×0.60＋ライン最高得点×0.25＋番手得点×0.15',
    source:race.source, lines:lines.map((l,i) => ({...l,strength_rank:i+1})), favorite:lines[0].id
  };
}

function variants(pool, limit=10) {
  const unique = new Map();
  for (const t of pool.slice().sort((a,b) => b.support-a.support || a.key.localeCompare(b.key))) {
    if (!unique.has(t.key)) unique.set(t.key,t);
  }
  const all = [...unique.values()].filter(t => t.pattern !== 'Z');
  // A-D are studied separately. No pattern receives a fixed point allocation.
  const expanded = all.slice(0,limit);
  const ad = all.filter(t => 'ABCD'.includes(t.pattern)).slice(0,limit);
  const thirdAll = new Set();
  return {ad, expanded, all_candidates:all, thirdAll, z:[...unique.values()].filter(t => t.pattern==='Z')};
}

function build(raw, {asOf=Date.now(), ex=null, context=null, packs={}, replay=false, normal=false}={}) {
  Policy.classify(raw);
  if (!replay && !(asOf < Date.parse(raw.date+'T'+raw.start+':00+09:00'))) throw Error('発走後の新規予想');
  const prepared = Input.prepare(raw,packs,asOf);
  prepared.bAxisEx = ex;
  prepared.bAxisExContext = context;
  const race = prepared.race;
  const ranking = rankLines(race,prepared.as_of);
  const candidates = BAxis.candidates(prepared);
  const favorite = ranking.favorite;
  const scenarios = [], errors = [], pool = [];
  for (const line of ranking.lines.filter(l => normal ? l.id===favorite : l.id!==favorite)) {
    const leader = race.riders.find(r => r.no===line.members[0]);
    if (!['逃','両'].includes(leader.style)) {
      errors.push({line_id:line.id,reason:'追込型だけのライン先頭は主導権候補から除外'});
      continue;
    }
    const b = candidates.find(c => c.no===leader.no);
    for (const tactic of BAxis.tacticsFor(prepared,leader.no)) {
      try {
        const out = BAxis.build(prepared,{bNo:leader.no,tactic,limit:10});
        const audit = BAxis.Phases.audit(out.b,{complete:true});
        if (!audit.passed) throw Error(audit.failures.join(' / '));
        const back = out.b.phases.find(p => p.id==='back');
        if (back.leader!==leader.no) throw Error('B先頭条件不一致');
        const opposition = candidates.find(c => c.no===ranking.lines[0].members[0]);
        const resistance = (opposition?.weight || b.weight)/b.weight;
        const id = line.id+'-'+tactic;
        const scenario = {
          id, b_line:line.id, b_members:line.members, b_no:leader.no, tactic,
          tactic_label:BAxis.TACTICS[tactic], strength_rank:line.strength_rank,
          b_support:b.weight, b_probability:null,
          assessment:resistance>1.65?'成立条件が厳しい':'主導権候補',
          reasons:b.basis, counter_evidence:['F先頭の主導権支持／B候補の比 '+resistance.toFixed(2),
            ...out.b.interactions.attackers.map(a => a.no+'番の追い上げ・捲り '+(a.chaseFeasible?'到達可能':'到達条件が厳しい'))],
          audit, phases:out.b.phases, states:out.b.states,
          detachment:out.b.interactions.detachment, contests:out.b.interactions.markerContests,
          ex_used:race.riders.flatMap(r => ['tsuppari','kamashi','chigiri','chigirarare','tobitsuki','seri'].map(k => BAxis.Ex.evidence(prepared,r,k)).filter(Boolean))
        };
        scenarios.push(scenario);
        for (const t of out.tickets) {
          // Normal B comparator keeps the same physical simulator but selects F for B.
          const classification = normal ? null : Patterns.classify(t.trio,race.lineup,favorite,line.id);
          pool.push({key:t.key,trio:t.trio, ...classification,
            pattern:normal?'normal':classification.pattern,
            scenario_id:id,b_line:line.id,b_no:leader.no,
            support:t.score+b.weight*.15-resistance*.02,
            reason:t.reason,finish_mode:t.mode||t.path,
            tactic:BAxis.TACTICS[tactic],detachment:scenario.detachment,
            contests:scenario.contests,odds:null,probability:null,ev:null,amount:0});
        }
      } catch(e) { errors.push({line_id:line.id,tactic,reason:e.message}); }
    }
  }
  const views = variants(pool);
  scenarios.sort((a,b)=>b.b_support-a.b_support||a.id.localeCompare(b.id));
  for(const t of new Set([...views.ad,...views.expanded])){
    const scenario=scenarios.find(s=>s.id===t.scenario_id);
    t.finish_phases=BAxis.Phases.complete({phases:scenario.phases,states:scenario.states,bNo:scenario.b_no},[t]).slice(-2);
  }
  for (const t of views.expanded) for (const no of race.riders.map(r => r.no)) {
    if (!t.trio.slice(0,2).includes(no)) views.thirdAll.add(t.trio.slice(0,2).concat(no).join('-'));
  }
  const research = {ad:views.ad,expanded:views.expanded,all_candidates:views.all_candidates,
    third_all:[...views.thirdAll],z:views.z,normal:normal?views.expanded:[]};
  return {
    schema:'tk-b-upset-prediction/v2',model:Build,
    race_id:race.date+':'+race.venue+':'+race.race_no,
    race:{date:race.date,venue:race.venue,race_no:race.race_no,start:race.start,cars:race.riders.length},
    as_of:prepared.as_of,cutoff:prepared.cutoff,mode:replay?'replay':'pre-race',
    input:race,input_sha256:P.sha256(race),ranking,scenarios,research,
    recommendation:{status:'skip',reason:'B-UPSET固有の校正済み確率・発走前オッズ・利益再現性が未充足',tickets:[]},
    overlap:[],errors
  };
}

// Use only model-specific, calibrated probabilities and authenticated pre-close quotes.
function selectValue(out, quote, calibration, capturedAt) {
  const at=Date.parse(capturedAt),cutoff=Date.parse(out.cutoff);
  if (out.mode!=='pre-race' || !(Date.parse(out.as_of)<=at && at<cutoff)) return [];
  if (quote?.race_id!==out.race_id || !quote.identity_verified || quote.final!==false ||
      !(Date.parse(quote.updated_at)<=at && at-Date.parse(quote.updated_at)<=300000 &&
        at<Date.parse(quote.close_at) && Date.parse(quote.close_at)<=cutoff)) return [];
  if (calibration?.model_id!==out.model.model_id || calibration.calibrated!==true ||
      !calibration.source_url || !(calibration.holdout_n>=200) ||
      !(Date.parse(calibration.training_end)<Date.parse(out.as_of)) ||
      !(calibration.validation_roi>1 && calibration.trim1_roi>1)) return [];
  const selected=Value.optimize({raceId:out.race_id,
    candidates:out.research.all_candidates.map(t=>({...t,evidence:[{reason:t.reason,scenario:t.scenario_id}]})),
    probabilities:new Map(Object.entries(calibration.probabilities||{})),
    calibration:{eligible:true,lower_factor:calibration.lower_factor},
    snapshot:{race_id:quote.race_id,market:'trifecta',state:'live',source_url:quote.source_url,
      captured_at:quote.captured_at||capturedAt,published_at:quote.updated_at,sales_close_at:quote.close_at,odds:quote.odds},
    asOf:capturedAt,cutoff:out.cutoff,cars:out.race.cars,threshold:1.20});
  return selected.tickets.map(t=>({...t,amount:100}));
}

module.exports = {build,rankLines,variants,selectValue};
