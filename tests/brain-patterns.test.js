const assert=require('node:assert/strict'),fs=require('node:fs'),Brain=require('../js/race-brain.js');
const r=JSON.parse(fs.readFileSync('race_sample.json','utf8')),out=Brain.build(r);
for(const mode of Object.keys(Brain.MODES))assert(out.narratives.some(n=>n.mode===mode),mode);
for(const n of out.narratives){
 if(n.mode==='counter'){assert.equal(n.stand,'yield');assert.equal(n.outcome,'attacker-takes');assert.equal(n.first,n.front);}
 if(n.mode==='thirdline'){assert.equal(n.stand,'resist');assert(![n.front,n.attacker].includes(n.first));assert(r.lineup.some(l=>l[0]===n.first));}
 if(n.mode==='switch'){assert.equal(n.outcome,'front-holds');assert.equal(n.first,r.lineup.find(l=>l[0]===n.attacker)[1]);}
 if(n.mode==='thirdsprint')assert.equal(n.gap,'holds');
 if(n.mode==='recovery')assert.equal(n.gap,'breaks');
 if(n.mode==='solo')assert(r.lineup.some(l=>l.length===1&&l[0]===n.first));
 assert(n.decisions.length>=2);
}
assert(out.chosen.every(t=>t.supporting_path.key===t.key&&t.paths.includes(t.supporting_path)&&t.selection_reason));
assert(out.hypotheses.length<=6);assert(new Set(out.hypotheses.slice(3).map(h=>h.mode)).size===out.hypotheses.slice(3).length);
const reduced=structuredClone(r);reduced.lineup=[r.riders.slice(0,5).map(x=>x.no),r.riders.slice(5).map(x=>x.no)];
const two=Brain.build(reduced);assert(!two.narratives.some(n=>n.mode==='thirdline'||n.mode==='solo'),'inapplicable modes must not be manufactured');
const no=r.riders.find(x=>x.style!=='追').no;
function profile(total,b){const x=structuredClone(r);x.riders.find(x=>x.no===no).recent_form={stats:{total,b,top3_rate:50}};return Brain.profiles(x).get(no);}
const low=profile(30,0),high=profile(30,20);assert(high.resist>low.resist);assert(high.kamashi>low.kamashi);assert.equal(high.track,low.track);assert.equal(high.front,low.front);
assert(Math.abs(profile(1,1).resist-profile(0,0).resist)<Math.abs(profile(30,30).resist-profile(0,0).resist));
console.log('PASS ten tactical modes, causal preconditions, absent-mode rejection, selected path trace and measured B shrinkage');
