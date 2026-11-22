'use strict';
// Regression: archived prediction bodies must not be retained together.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'line-report-memory-')),date='2098-10-31',line=path.join(dir,'line'),lab=path.join(dir,'lab');fs.mkdirSync(path.join(line,date),{recursive:true});fs.mkdirSync(lab);const fileBytes=3*1024*1024,padding='p'.repeat(fileBytes);
try{
for(let i=0;i<32;i++){const record={race_id:date+':fixture:'+i,saved_at:'2098-10-31T00:00:00Z',out:{provenance:{model:{model_id:'fixture'}}},large_unused_evidence:padding},id=record.race_id+'|fixture',name=crypto.createHash('sha256').update(id).digest('hex')+'.json';fs.writeFileSync(path.join(line,date,name),JSON.stringify(record));}
// LAB predictions can be much larger than outcomes, and must not be loaded.
 // These deliberately invalid, bulky forecast shards would break History.load.
fs.mkdirSync(path.join(lab,date),{recursive:true});
for(let i=0;i<12;i++){const name='p-'+crypto.createHash('sha256').update('lab-ignored-'+i).digest('hex')+'.json';fs.writeFileSync(path.join(lab,date,name),JSON.stringify({irrelevant_forecast:padding}));}
fs.writeFileSync(path.join(lab,date,'results.json'),JSON.stringify({results:[]}));
const code=`const report=require('./scripts/line-evaluate.cjs').report;const r=report(process.argv[1],process.argv[2],'2098-11-01T00:00:00Z');if(r.rows.length!==32||r.summary.excluded!==32||r.errors.length)process.exit(2);console.log('bounded report memory passed');`;
const r=spawnSync(process.execPath,['--max-old-space-size=64','-e',code,line,lab],{encoding:'utf8',timeout:90000,maxBuffer:2000000});assert.equal(r.status,0,r.stderr||String(r.error));assert.match(r.stdout,/bounded report memory passed/);console.log('PASS LINE report: 96 MiB LINE plus 36 MiB irrelevant LAB predictions under a 64 MiB heap; all 32 accounted without mutation');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
