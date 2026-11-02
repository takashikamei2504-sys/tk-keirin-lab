'use strict';
const a=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),H=require('../scripts/history-store.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lab-shards-')),date='2026-11-02';
const p=(race,model='v1')=>({race_id:date+':防府:'+race,model_id:model,pre_race:true,saved_at:'2026-11-02T00:00:00Z',input:{replay:'preserved'},chosen:[{key:'1-2-3'}]});
try{
 const legacy={schema:'tk-keirin-outcomes/v1',date,predictions:[p(1)],results:[{race_id:date+':防府:1',combos:[{key:'1-2-3'}]}]},file=path.join(dir,date+'.json');
 const original=JSON.stringify(legacy,null,2)+'\n';fs.writeFileSync(file,original);
 let h=H.load(dir,date);h.predictions.push(p(2),p(1,'v2'));H.save(dir,h);
 a.equal(fs.readFileSync(file,'utf8'),original,'legacy day bytes must remain identical');
 let loaded=H.load(dir,date);for(const expected of [p(1),p(2),p(1,'v2')])a.deepEqual(loaded.predictions.find(x=>H.key(x)===H.key(expected)),expected);a.equal(loaded.predictions.length,3);a.deepEqual(new Set(loaded.predictions.map(H.key)),new Set([p(1),p(2),p(1,'v2')].map(H.key)));
 const shard=path.join(dir,date,H.filename(p(2))),hash=()=>crypto.createHash('sha256').update(fs.readFileSync(shard)).digest('hex'),before=hash();
 loaded.results=[{race_id:date+':防府:1',combos:[{key:'2-1-3'}]}];H.save(dir,loaded);H.save(dir,H.load(dir,date));a.equal(hash(),before,'repeated collection/results cannot rewrite forecasts');
 a.equal(H.load(dir,date).results[0].combos[0].key,'2-1-3');a.equal(H.load(dir,date).locations.get(H.key(p(2))),date+'/'+H.filename(p(2)));
 a.deepEqual(H.dates(dir),[date]);
 const changed=H.load(dir,date);changed.predictions.find(x=>x.race_id===p(2).race_id).chosen=[{key:'7-6-5'}];a.throws(()=>H.save(dir,changed),/overwrite/);a.equal(hash(),before);
 const deleted=H.load(dir,date);deleted.predictions=deleted.predictions.slice(1);a.throws(()=>H.save(dir,deleted),/delete/);
 const huge=H.load(dir,date);huge.predictions.push({...p(3),evidence:'x'.repeat(H.LIMIT)});a.throws(()=>H.save(dir,huge),/20 MiB/);a.ok(!fs.existsSync(path.join(dir,date,H.filename(p(3)))),'oversized batches must be rejected before write');
 a.throws(()=>H.load(dir,'../bad'),/date/);
 a.deepEqual(H.load(dir,date).predictions.find(x=>H.key(x)===H.key(p(1))),p(1));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('PASS immutable legacy bytes and per-forecast shards, combined reads, result revisions, repeat idempotence and size/overwrite/delete guards');
