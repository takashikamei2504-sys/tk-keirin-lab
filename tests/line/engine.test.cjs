'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const E=require('../../js/line/engine.js'),Input=require('../../js/line/input.js'),Store=require('../../scripts/line-store.cjs'),P=require('../../js/model-provenance.js');
const sample=require('../../race_sample.json'),seven=structuredClone(sample);seven.riders=seven.riders.slice(0,7);seven.lineup=[[1,2,3],[4,5],[6,7]];
const cases=[sample,seven,{...seven,lineup:[[1,2,3,4],[5,6,7]]},{...sample,lineup:[[1,2],[3,4],[5,6],[7],[8],[9]]}];
let checks=0;function ok(cond,message){assert.ok(cond,message);checks++;}
function audit(r,out){
 ok(out.main.scenes.length===6,'six phases');ok(out.tickets.length>0&&out.tickets.length<=r.riders.length*(r.riders.length-1)*(r.riders.length-2),'valid variable ticket count');ok(new Set(out.tickets.map(t=>t.key)).size===out.tickets.length,'deduplicate');
 for(const s of [out.main,...out.alternatives]){
  for(const scene of s.scenes){assert.deepEqual(scene.order.slice().sort(),r.riders.map(x=>x.no).sort());checks++;ok(scene.events.every(e=>e.reason),'event reasons');}
  ok(s.finish.pair.every(n=>r.riders.some(x=>x.no===n)),'valid pair');
 }
 for(const t of out.tickets){ok(new Set(t.trio).size===3,'three different riders per ticket');const s=[out.main,...out.alternatives].find(s=>s.id===t.hypothesis);assert.deepEqual(t.trio.slice(0,2),s.finish.pair);checks++;ok(s.finish.thirds.some(x=>x.no===t.trio[2]),'third derived from finish');}
 ok(out.decision.axis===out.decision.rounds.at(-1).axis,'F final axis is the one used in the recorded comparison');if(out.rival&&out.decision.confidence!=='拮抗')ok(out.main.axes[out.decision.axis]>out.rival.axes[out.decision.axis],'F decisive axis must actually favor the selected main');
 for(const s of [out.main,...out.alternatives]){const expected=Object.keys(E.AXES).reduce((sum,k)=>sum+s.axes[k]*out.decision.weights[k],0);ok(Math.abs(expected-s.score)<1e-10,'F displayed score equals actual decision');}
 ok(out.decision.drivers.every(t=>t.axis===out.decision.axis&&out.main.terms.some(x=>JSON.stringify(x)===JSON.stringify(t))),'F exact terms used in explanation');
 ok(out.provenance.input_sha256===P.sha256(out.input),'input hash reproducible');
}
for(const r of cases){const before=JSON.stringify(r),out=E.build(r);audit(r,out);assert.equal(JSON.stringify(r),before);checks++;}
const first=E.build(seven),changed=E.build({...seven,lineup:[[1,4],[2,5,6],[3,7]]});
ok(JSON.stringify(first.main.scenes)!==JSON.stringify(changed.main.scenes),'A line structure changes interaction');
const altered=structuredClone(seven);altered.riders.forEach(x=>{x.style=x.no===6?'逃':'追';x.b=x.no===6?18:0;x.s=x.no===6?20:0;});
const other=E.build(altered);ok(JSON.stringify(first.main.scenes)!==JSON.stringify(other.main.scenes),'B changing traits changes actual path');
ok(first.main.scenes.flatMap(s=>s.events).some(e=>e.action==='wait'),'C waiting is evaluated and explained');
const stamp='2026-10-01T00:00:00Z';const evidence=[];
for(const x of sample.riders)for(const trait of ['long_makuri','block','track'])evidence.push({id:x.no+trait,rider:x.name,trait,value:trait==='track'?.15:.98,confidence:1,body_verified:true,url:'https://example.org/'+x.no+'/'+trait,published_at:stamp,collected_at:stamp,excerpt:'合成テストの実戦観察'});
const rich=E.build(sample,{intelligence:{evidence}},{width:256});
const all=[rich.main,...rich.alternatives,rich.rival].filter(Boolean),evaluated=rich.candidate_evaluations;
ok(evaluated.some(s=>s.attacks.some(a=>a.kind==='long')),'D long attacks are explored');
ok(rich.rejected.some(x=>x.reason.includes('一局面'))||evaluated.some(s=>s.attacks.some(a=>a.kind==='short')),'D rear late attacks are constrained');
const defenses=new Set(evaluated.filter(s=>s.defense?.action==='block').map(s=>s.defense.outcome));
console.log('Retained block outcomes', [...defenses]);
ok(defenses.size>=2,'E retain distinct block outcomes');
ok(evaluated.some(s=>s.detached.length>0),'tracking loss changes state');
// G: hostile post-start evidence, knowledge, enriched form and feed timestamps.
const future={...evidence[0],published_at:'2099-01-01T00:00:00Z',collected_at:'2099-01-02T00:00:00Z'};
const clean=Input.prepare(sample),bad=Input.prepare({...sample,result:[9,8,7],odds:{'9-8-7':1}},{intelligence:{evidence:[future],knowledge:[{...future,kind:'self_statement',excerpt:'先行が得意'}]}});
assert.deepEqual(clean.features,bad.features);checks++;ok(!('result' in bad.race)&&!('odds' in bad.race),'G whitelist results and odds');
const oldAsOf=Date.parse('2026-09-01T00:00:00Z');ok(Input.prepare(sample,{intelligence:{evidence}},oldAsOf).records.length===0,'G information after as-of is excluded');
assert.throws(()=>Input.prepare({...sample,source:{mode:'live-public-feed',generated_at:'2099-01-01T00:00:00Z'}}));checks++;
const source=fs.readFileSync('js/line/engine.js','utf8')+fs.readFileSync('js/line/input.js','utf8');ok(!/require\(['"].*(?:story-brain|race-brain|line-reactions|cross-line-tactics|finish-review)/.test(source),'decision logic independent');
// H comparison uses an identical, sanitized input rather than provider forecasts.
const Legacy=require('../../js/story-brain.js');const older=Legacy.build(first.input.race,first.input.replay_pack);ok(older.chosen.length>0&&first.tickets.length>0,'H both models execute against identical input');
// Immutable storage, replay is never archived as a genuine pre-race forecast.
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'line-store-')),live=E.build({...sample,date:'2098-10-31'},{},{asOf:Date.parse('2098-10-30T00:00:00Z')});
live.generated_at='2098-10-30T00:00:00.500Z';const now=Date.parse('2098-10-30T00:00:01Z'),a=Store.freeze(live,temp,now);ok(a.saved,'save pre-race');const text=fs.readFileSync(a.file,'utf8');live.tickets=[];ok(!Store.freeze(live,temp,now+1).saved,'first forecast immutable');assert.equal(fs.readFileSync(a.file,'utf8'),text);checks++;
ok(!Store.freeze({...live,mode:'historical-replay'},temp,now).saved,'never freeze replay');ok(!Store.freeze(live,temp,Date.parse(live.input.cutoff)).saved,'never freeze after cutoff');fs.rmSync(temp,{recursive:true});

// I: S-taking is not identical to a receiving line's starting position.
// In mixed formations, solos require source-grounded tactical intent or solo-specific observation.
const startTopology=E.structure(sample),starts=E.frontChoices(sample,startTopology,[]);
ok(starts.choices.every(x=>x.line.length>1),'I ungrounded solos are not initial S-taking candidates');
ok(starts.excluded.length===2,'I both ungrounded solos are flagged with reasons');
const boostedSolo=structuredClone(sample);boostedSolo.riders.find(x=>x.no===9).s=40;
ok(E.frontChoices(boostedSolo,E.structure(boostedSolo),[]).excluded.length===2,'I high S count alone never proves a solo S-taking plan');
const withIntent=structuredClone(sample);withIntent.race_material={comments:[{rider:'山口拳矢',declaration:'単騎でSを取って前受けする',declaration_complete:true}]};
ok(E.frontChoices(withIntent,E.structure(withIntent),[]).choices.some(x=>x.line.head===9),'I explicit solo front-taking intent is eligible');
withIntent.race_material.comments[0].declaration='今日はSを取らない';
ok(!E.frontChoices(withIntent,E.structure(withIntent),[]).choices.some(x=>x.line.head===9),'I a negated intention cannot support solo S-taking');
ok(E.frontChoices(sample,startTopology,[{no:3,trait:'front',numeric:true,value:.9,context:{role:'solo'}}]).choices.some(x=>x.line.head===3),'I condition-specific observed solo S-taking can be eligible');
ok(!E.frontChoices(sample,startTopology,[{no:3,trait:'front',numeric:true,value:.9,context:{}}]).choices.some(x=>x.line.head===3),'I generic front record cannot be treated as solo evidence');
const startOutput=E.build(sample);
ok([startOutput.main,...startOutput.alternatives].every(x=>x.scenes[0].start_plan&&sample.lineup.find(l=>l[0]===x.scenes[0].groups.find(g=>g.id===x.scenes[0].start_plan.front_line)?.members?.[0])!==undefined),'I initial scene records grounded front line and role');
ok(startOutput.rejected.some(x=>x.tactic==='solo_s_start'),'I excluded solo starts retain explanations');

console.log(`PASS LAB LINE: ${checks} checks across A–H, 7/9 riders, 2/3/4-car lines, fragmented, timestamp boundary, independent core and immutable storage`);
