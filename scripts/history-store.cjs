'use strict';
/* Keep legacy day files byte-for-byte; new forecasts are immutable individual files. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Audit=require('../js/results-audit.js');
const LIMIT=20*1024*1024,dayPattern=/^\d{4}-\d{2}-\d{2}$/;
const key=p=>p.race_id+'|'+Audit.modelId(p);
function day(date){if(!dayPattern.test(date))throw Error('Invalid history date');return date;}
function filename(p){return 'p-'+crypto.createHash('sha256').update(key(p)).digest('hex')+'.json';}
function read(file,fallback){return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback;}
function load(dir,date){
 day(date);const legacy=read(path.join(dir,date+'.json'),{schema:Audit.SCHEMA,date,predictions:[],results:[]});
 const predictions=[...legacy.predictions],seen=new Map(predictions.map(p=>[key(p),p])),folder=path.join(dir,date),locations=new Map(predictions.map(p=>[key(p),date+'.json']));
 if(fs.existsSync(folder))for(const file of fs.readdirSync(folder).filter(n=>/^p-[a-f0-9]{64}\.json$/.test(n)).sort()){
  const p=read(path.join(folder,file));if(!p.race_id?.startsWith(date+':')||filename(p)!==file)throw Error('Invalid forecast shard: '+file);
  if(seen.has(key(p)))throw Error('Duplicate immutable forecast: '+key(p));
  seen.set(key(p),p);predictions.push(p);locations.set(key(p),date+'/'+file);
 }
 const results=new Map(legacy.results.map(r=>[r.race_id,r]));
 for(const r of read(path.join(folder,'results.json'),{results:[]}).results){if(!r.race_id?.startsWith(date+':'))throw Error('Invalid result date');results.set(r.race_id,r);}
 return {schema:legacy.schema,date,predictions,results:[...results.values()],locations};
}
function dates(dir){return [...new Set(fs.readdirSync(dir).flatMap(n=>{const d=n.replace(/\.json$/,'');return dayPattern.test(d)?[d]:[];}))].sort();}
function text(value){const bytes=JSON.stringify(value)+'\n';if(Buffer.byteLength(bytes)>LIMIT)throw Error('History shard exceeds 20 MiB; refusing to truncate frozen evidence');return bytes;}
function save(dir,history){
 const date=day(history.date),prior=load(dir,date),known=new Map(prior.predictions.map(p=>[key(p),p])),seen=new Set(),pending=[];
 for(const p of history.predictions){
  const id=key(p);if(!p.race_id?.startsWith(date+':')||seen.has(id))throw Error('Invalid or duplicate forecast key');seen.add(id);
  if(known.has(id)){if(JSON.stringify(known.get(id))!==JSON.stringify(p))throw Error('Refusing to overwrite frozen forecast: '+id);continue;}
  pending.push([path.join(dir,date,filename(p)),text(p)]);
 }
 for(const id of known.keys())if(!seen.has(id))throw Error('Refusing to delete frozen forecast: '+id);
 pending.push([path.join(dir,date,'results.json'),text({schema:Audit.SCHEMA,date,results:history.results})]);
 // Validate the whole batch before any write. Never rewrite a legacy day file.
 for(const [file,bytes] of pending){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(path.basename(file).startsWith('p-'))fs.writeFileSync(file,bytes,{flag:'wx'});
  else if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==bytes){fs.writeFileSync(file+'.tmp',bytes);fs.renameSync(file+'.tmp',file);}
 }
}
module.exports={load,save,dates,key,filename,LIMIT};
