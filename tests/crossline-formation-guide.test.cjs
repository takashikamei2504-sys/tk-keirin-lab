'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Guide=require('../js/crossline/formation-guide.js');
function check(tickets,expectedGroups){
 const x=Guide.exactFormations(tickets);
 assert.equal(x.exact,true);
 assert.equal(x.points,4);assert.equal(x.stake,400);
 assert.equal(x.formations.length,expectedGroups);
 const flat=x.formations.flatMap(f=>{
  let all=[];for(let a of f.first)for(let b of f.second)for(let c of f.third){
   assert.equal(new Set([a,b,c]).size,3,'no duplicated rider within one ticket');
   all.push(a+'-'+b+'-'+c);
  }return all;
 });
 assert.deepEqual(flat.slice().sort(),tickets.slice().sort(),'no extra or missing tickets');
 assert.equal(new Set(flat).size,4);
 return x;
}
const regular=['1-3-2','1-3-4','1-5-2','1-5-3'];
const two=check(regular,2);
assert.deepEqual(two.formations[0].first,['1']);
assert.deepEqual(two.formations[0].second,['3']);
assert.deepEqual(two.formations[0].third,['2','4']);
assert.deepEqual(two.formations[1].second,['5']);
check(['1-3-2','1-3-4','1-5-2','1-5-4'],1);
check(['1-3-2','1-3-5','4-3-2','4-3-5'],1);
check(['7-3-2','7-3-5','7-4-1','7-4-2'],2);
check(['1-6-7','1-6-4','3-6-5','3-6-4'],2);
assert.match(Guide.guideText(regular),/フォーメーション1/);
assert.match(Guide.guideText(regular),/合計4点・各100円・400円/);
assert.throws(()=>Guide.exactFormations(['1-3-2','1-3-2','1-5-2','1-5-3']),/異なる三連単4点/);
assert.throws(()=>Guide.exactFormations(['1-1-2','1-3-4','1-5-2','1-5-3']),/異なる三連単4点/);
assert.throws(()=>Guide.exactFormations(['1-3-2','1-3-4','1-5-2','1-5-3','2-5-3']),/異なる三連単4点/);
const view=fs.readFileSync(path.join(__dirname,'../js/crossline/selected-view.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../crossline-selected.html'),'utf8');
assert.ok(view.includes('CrosslineFormationGuide.exactFormations'));
assert.ok(view.includes('formationGuide(row.forecast.tickets)'));
assert.ok(html.includes('js/crossline/formation-guide.js'));
assert.ok(html.includes('id="formation-guide-detail"'));
console.log('PASS exact formation display: 1 or 2 compact formations, no extra bets, 4 tickets x 100 yen');
