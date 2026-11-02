const a=require('node:assert/strict'),F=require('../js/finish-review.js'),r=require('./formation-fixtures.cjs').race,B=require('../js/story-brain.js');
const service=F.build(r,{ability:()=>.9,trait:()=>.6}),base={leader:1,defender:2,order:[1,2,3,4,5,6,7],energy:Object.fromEntries(r.riders.map(x=>[x.no,.1])),decisions:[],outside:[],defense:'follow'};
const early={...base,scenes:Array.from({length:5},()=>({order:base.order}))},late={...base,scenes:Array.from({length:5},(_,i)=>({order:i<4?[4,5,1,2,3,6,7]:base.order}))};
const x=service.assess(early),y=service.assess(late);a.ok(x.exposure>y.exposure);a.ok(x.pair.difference<y.pair.difference,'long leadership should raise the chaser advantage');a.equal(x.pair.favored,'chase');a.equal(y.pair.favored,'lead');
const burden=service.assess({...early,energy:{...base.energy,2:.7},defense:'block'});a.ok(burden.pair.difference>x.pair.difference,'a tired blocking follower cannot get a free same chase score');
for(const c of require('./engine-cases.cjs')){const o=B.build(c.race,c.pack);a.ok(o.story.main.finish_review);a.match(o.story.main.reading,/２着/);a.match(o.story.main.scenes[5].action,/主導権|追走|残り脚/);a.ok(o.story.main.finish_review.rows.every(x=>Number.isFinite(x.score)));}
console.log('PASS early/late lead workload, chase burden, independent first-two assessment and decisive story explanation');
