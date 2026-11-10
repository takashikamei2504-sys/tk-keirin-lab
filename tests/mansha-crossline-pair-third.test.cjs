'use strict';
const assert=require('node:assert/strict');
const mod=require('../scripts/mansha-crossline-pair-third.cjs');
const risk=require('../js/mansha/risk.js');
require('../js/mansha/model.js');
const entries=[
{car_number:1,class_rank:'A1',competition_score:91,running_style:'逃',line_position:'1-1'},
{car_number:2,class_rank:'A1',competition_score:90,running_style:'追',line_position:'1-2'},
{car_number:3,class_rank:'A2',competition_score:88,running_style:'両',line_position:'2-1'},
{car_number:4,class_rank:'A2',competition_score:85,running_style:'逃',line_position:'3-1'},
{car_number:5,class_rank:'A2',competition_score:84,running_style:'追',line_position:'3-2'},
{car_number:6,class_rank:'A2',competition_score:81,running_style:'逃',line_position:'4-1'},
{car_number:7,class_rank:'A2',competition_score:79,running_style:'追',line_position:'4-2'},
];
const ex=()=>({size:0,girls_or_unclassified:0,pending_or_invalid_result:0,multiple_results:0,invalid_prelude:0});
const raw={entries,venue:'test',race_number:1,grade:'F2',round_name:'予選',
 result_top3:[3,2,6],payout_trifecta:15550};
const card=mod.createCard(raw,'2026-06-22',ex());
assert(card&&card.cross&&card.high);
assert.equal(card.e.length,7);
assert.equal(card.cat,'A7');
const fake={score:{},regular:{winner:{weights:Array(12).fill(0)},second:{weights:Array(12).fill(0)}},
 mansha:{winner:{weights:Array(12).fill(0)},second:{weights:Array(12).fill(0)}},third:{weights:Array(12).fill(0)}};
for(const mode of ['score','regular','mansha']){
 const pairlist=mod.orderedPairs(card,mode,fake);
 assert.equal(pairlist.length,42-(2+0+2+2)); // 7*6 ordered pairs minus same-line pairs
 assert(pairlist.every(pair=>pair.a.no!==pair.b.no&&pair.a.line!==pair.b.line));
 const all=mod.tickets(card,mode,3,'all',fake);
 const pairline=mod.tickets(card,mode,3,'pairlines',fake);
 const top2=mod.tickets(card,mode,3,'score2',fake);
 assert.equal(all.t.size,15);
 assert(pairline.t.size<=15);
 assert.equal(top2.t.size,6);
 assert.equal(new Set([...all.t].map(x=>x.slice(0,3))).size,3);
 assert.deepEqual(all.pairs.map(p=>p.a.no+'-'+p.b.no),top2.pairs.map(p=>p.a.no+'-'+p.b.no));
 assert([...top2.t].every(x=>all.t.has(x)));
}
const e=card.e;
const a=e.find(x=>x.no===3),b=e.find(x=>x.no===2);
assert.deepEqual(mod.thirds(card,{a,b},'all',fake.third),[1,4,5,6,7]);
assert.deepEqual(mod.thirds(card,{a,b},'pairlines',fake.third),[1]);
const stats=mod.analyzeThirds([card]);
assert.equal(stats.mansha.n,1);
assert.equal(stats.mansha.third_other_line,1);
const out=mod.calc([card],'score',3,'all',fake);
assert.equal(out.tickets,15);
assert.equal(out.stake,1500);
assert(out.pair_covered<=1);
assert.equal(out.high_hits,out.hits);
// No hindsight in candidate list: changing finish/payout leaves picks unchanged
const after=mod.createCard({...raw,result_top3:[7,4,5],payout_trifecta:990},'2026-06-22',ex());
assert.deepEqual([...mod.tickets(card,'score',6,'all',fake).t],
                 [...mod.tickets(after,'score',6,'all',fake).t]);
console.log('PASS mansha cross-line pairs, third all-wheel, no outcome leakage');
