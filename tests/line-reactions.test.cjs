'use strict';
const assert=require('node:assert/strict');
const Reactions=require('../js/line-reactions.js');
const Brain=require('../js/story-brain.js');
const race=require('../race_sample.json'),engine=Reactions.build(race);
const lineupOrder=[2,8,7,1,4,5,6,3,9];
function state(){return {order:[...lineupOrder],front:2,leader:2,attacker:1,stand:'resist',outcome:'front-holds',energy:Object.fromEntries(race.riders.map(r=>[r.no,0])),connected:Object.fromEntries(race.riders.map(r=>[r.no,true])),redThird:null};}
const s=state(),options=engine.counters(s);
assert.ok(options.some(o=>o.no===5&&o.from===6&&o.to===4));
assert.ok(!options.some(o=>o.no===3),'a pure marker should not attack as another line leader');
const moves=[];
const moved=engine.applyCounter(s,5,(st,members,target,why)=>{
 const group=st.order.filter(n=>members.includes(n)),rest=st.order.filter(n=>!members.includes(n));
 st.order=[...rest.slice(0,target),...group,...rest.slice(target)];
 moves.push({members,target,why});
});
assert.deepEqual(s.order,[2,8,7,5,6,1,4,3,9]);
assert.deepEqual(moves[0].members,[5,6]);assert.equal(moved.final,4);
assert.ok(s.energy[5]>.1&&s.energy[6]>0);
assert.ok(engine.redClosing(s).includes('5番松本貴治'));
assert.ok(engine.redClosing(s).includes('1番郡司浩平'));
const snap=engine.snapshot(s,1,{order:lineupOrder});
assert.equal(snap.stage,2);assert.equal(snap.rows.length,race.lineup.length);
assert.deepEqual(snap.rows.find(x=>x.leader===5).line,[5,6]);
assert.equal(snap.rows.find(x=>x.leader===5).action,'攻防を利用した位置上昇');
assert.equal(snap.rows.find(x=>x.leader===1).to,6);
assert.equal(snap.rows.filter(x=>x.action==='反応を見て待機').length,2);
assert.throws(()=>engine.applyCounter(s,3,()=>{}),/成立しません/);
const original=state();original.attacker=null;
assert.deepEqual(engine.counters(original),[]);
const blocked=state();blocked.connected[6]=false;
assert.deepEqual(engine.counters(blocked).find(x=>x.no===5).members,[5]);
const result=Brain.build(race);
assert.equal(result.diagnostics.lineReactionSchema,'tk-line-reactions/v1');
for(const story of [result.story.main,...result.story.alternatives]){
 for(const [i,scene] of story.scenes.entries()){
  assert.equal(scene.lineReactions.stage,i+1);
  assert.equal(scene.lineReactions.rows.length,race.lineup.length);
  assert.equal(scene.lineReactions.riders.length,race.riders.length);
  assert.deepEqual(scene.lineReactions.riders.map(x=>x.to),race.riders.slice().sort((a,b)=>a.no-b.no).map(x=>scene.order.indexOf(x.no)+1));
  assert.deepEqual(scene.lineReactions.rows.map(x=>x.leader),race.lineup.map(l=>l[0]));
  assert.deepEqual(scene.lineReactions.rows.map(x=>x.to),race.lineup.map(l=>scene.order.indexOf(l[0])+1));
  if(i===5)for(const row of scene.lineReactions.rows)assert.equal(row.from,story.scenes[4].order.indexOf(row.leader)+1);
 }
 if(story.scenes[1].tactical.redThird){
  assert.ok(story.scenes[1].action.includes('攻防を利用して'));
 }
}
console.log('PASS line reaction ledger, bounded third-line advance, detached followers, branch immutability and complete finish snapshots');
