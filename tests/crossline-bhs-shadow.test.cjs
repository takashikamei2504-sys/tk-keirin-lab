'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const B=require('../scripts/crossline-bhs-shadow.cjs');
const date='2030-05-03',saved='2030-05-03T09:05:00+09:00',sourceTime='2030-05-03T08:58:00+09:00';
const now=Date.parse('2030-05-03T09:10:00+09:00');
const raw={venue:'福井',race_number:2,start_time:'16:00',entries:Array.from({length:7},(_,i)=>({
 car_number:i+1,rider_id:String(500+i),rider_full_name:'架空選手'+(i+1),
 line_position:([1,1,4,4,7,7,9][i]+'-'+([1,2,1,2,1,2,1][i])),
 b_count:i*2,h_count:i+1,s_count:i
}))};
const parent={requested:'auto',race_id:date+':福井:2',saved_at:saved,
 out:{selection:{requested:'auto'},input:{date,venue:'福井',race_no:2,start:'16:00',
  source:{mode:'live-public-feed',generated_at:sourceTime},
  lineup:[[1,2],[3,4],[5,6],[7]],
  riders:raw.entries.map(e=>({no:e.car_number,name:e.rider_full_name,meta:{rider_id:e.rider_id}}))}}};
const day={date,generated_at:'2030-05-03T09:00:00+09:00',races:[raw]};
const snap=B.freeze(parent,raw,day,{now});
assert.ok(snap,'valid pre-race feed');
assert.equal(snap.riders.length,7);
assert.equal(snap.riders[6].b_count,12);
assert.equal(snap.riders[2].line,'4-1','raw source numbering remains in audit snapshot');
assert.equal(B.freeze(parent,raw,{...day,generated_at:'2030-05-03T17:00:00+09:00'},{now}),null,'never use after-start published feed');
assert.equal(B.freeze(parent,raw,day,{now:Date.parse('2030-05-03T16:00:00+09:00')}),null);
assert.equal(B.freeze(parent,{...raw,entries:raw.entries.map(e=>e.car_number===1?{...e,b_count:null}:e)},day,{now}),null,'missing B abstains');
assert.equal(B.freeze(parent,{...raw,entries:raw.entries.map(e=>e.car_number===1?{...e,rider_id:'wrong'}:e)},day,{now}),null,'rider identity mismatch abstains');
assert.deepEqual(B.freeze(parent,{...raw,result_top3:[3,2,1],payout_trifecta:99990},day,{now}),snap,'results never affect stored features');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bhs-shadow-'));
 try{
  const dir=path.join(root,'data/routed_history',date);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,B.hash(parent.race_id)+'.json'),JSON.stringify(parent));
  const first=await B.run({root,now,feed:day}),second=await B.run({root,now,feed:day});
  assert.equal(first.frozen,1);assert.equal(second.existing,1);
  const savedDir=path.join(root,'data/crossline_b_history',date);
  const files=fs.readdirSync(savedDir);assert.equal(files.length,1);
  const rec=JSON.parse(fs.readFileSync(path.join(savedDir,files[0]),'utf8'));
  assert.equal(rec.riders[6].b_count,12);
  console.log('BHS pre-race freeze: identity, timestamp, first-write-only, zero production mutation');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
