'use strict';
/* Independent scheduled shadow forecasts and results: never edit baseline records. */
const fs=require('node:fs'),path=require('node:path');
const P=require('../js/model-provenance.js');
const Forecast=require('../js/mansha/shadow.cjs');
const Eval=require('../js/routing/evaluation.js');
const {name}=require('./routed-daily.cjs');
const read=(p,fallback)=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):fallback;
const write=(p,value)=>{fs.mkdirSync(path.dirname(p),{recursive:true});const f=p+'.tmp';fs.writeFileSync(f,JSON.stringify(value)+'\n');fs.renameSync(f,p)};
const folderName='mansha_shadow';
function storedParent(root,dt,id){
 const f=path.join(root,dt,name(id));return read(f,null);
}
function rootDays(root) {
 return fs.existsSync(root)?fs.readdirSync(root).filter(x=>/^\d{4}-\d\d-\d\d$/.test(x)&&fs.statSync(path.join(root,x)).isDirectory()).sort():[];
}
function capture({root,at=Date.now(),day,enabled=true}){
 const checked={checked_at:new Date(at).toISOString(),date:day,saved:0,existing:0,past_without_snapshot:0,ineligible:0,errors:[]};
 if(!enabled)return checked;
 const sourceDir=path.join(root,day);
 if(!fs.existsSync(sourceDir))return checked;
 const targetDir=path.join(sourceDir,folderName);
 for(const file of fs.readdirSync(sourceDir).filter(x=>/^[a-f0-9]{64}\.json$/.test(x))){
  try{
   const parent=read(path.join(sourceDir,file)),cutoff=Date.parse(parent.cutoff);
   if(parent.requested!=='auto'||!(at<cutoff)){
    if(!(at<cutoff))checked.past_without_snapshot++;
    continue;
   }
   const outFile=path.join(targetDir,file);
   if(fs.existsSync(outFile)){checked.existing++;continue;}
   const createdAt=new Date(at).toISOString();
   const shadow=Forecast.generate(parent,createdAt);
   if(!Forecast.validate(shadow,parent))throw Error('固定時の万車シャドー出力が不正');
   try{fs.mkdirSync(targetDir,{recursive:true});fs.writeFileSync(outFile,JSON.stringify(shadow)+'\n',{flag:'wx'});checked.saved++;}
   catch(e){if(e.code==='EEXIST')checked.existing++;else throw e}
  }catch(e){checked.ineligible++;checked.errors.push({file,message:e.message})}
 }
 return checked;
}
function report(root,now=Date.now()){
 const rows=[],errors=[];
 for(const dt of rootDays(root)){
  const shadowDir=path.join(root,dt,folderName),results=read(path.join(root,dt,'results.json'),{});
  if(!fs.existsSync(shadowDir))continue;
  for(const file of fs.readdirSync(shadowDir).filter(x=>/^[a-f0-9]{64}\.json$/.test(x)))try{
    const snapshot=read(path.join(shadowDir,file)),parent=storedParent(root,dt,snapshot.race_id);
    if(!parent||name(snapshot.race_id)!==file||!snapshot.race_id.startsWith(dt+':'))throw Error('親予想・識別子に不整合');
    const result=Forecast.evaluate(snapshot,parent,results[snapshot.race_id]);
    rows.push({race_id:snapshot.race_id,date:dt,venue:parent.out.race.venue,
      race_no:parent.out.race.race_no,start:parent.out.race.start,
      cat:snapshot.pre_race_features.cat,cars:parent.out.input.riders.length,
      saved_at:snapshot.created_at,cutoff:snapshot.cutoff,model_id:snapshot.model_id,
      risk:snapshot.risk,original_model_id:parent.model_id,
      modes:snapshot.modes.map(m=>({name:m.name,pairs:m.pair_rank,
        variants:m.variants.map(v=>({id:v.id,label:v.label,scope:v.scope,
          tickets:v.tickets.map(x=>x.key),evidence:v.evidence}))})),
      evaluation:result});
  }catch(e){errors.push({date:dt,file,error:e.message})}
 }
 rows.sort((a,b)=>a.date.localeCompare(b.date)||a.venue.localeCompare(b.venue)||a.race_no-b.race_no);
 const evaluated=rows.filter(x=>x.evaluation.status==='evaluated');
 const stat=(x)=>({saved:x.length,evaluated:x.filter(r=>r.evaluation.status==='evaluated').length,
  pending:x.filter(r=>r.evaluation.status==='pending').length,
  awaiting_payout:x.filter(r=>r.evaluation.status==='awaiting_payout').length,
  excluded:x.filter(r=>r.evaluation.status==='excluded').length,
  by_variant:Forecast.summarize(x.filter(r=>r.evaluation.status==='evaluated'))});
 const byCat={};for(const cat of ['A7','C7','S7','S9'])byCat[cat]=stat(rows.filter(x=>x.cat===cat));
 return {schema:'tk-keirin-mansha-shadow-evaluation/v1',generated_at:new Date(now).toISOString(),
  scope:'保存済み発走前予想に付属した別線万車シャドー。標準LAB買い目は変更せず、全点100円の仮想精算。9車Bの14点は比較研究用のみ。',
  summary:stat(rows),risk_high:stat(rows.filter(x=>x.risk.priority)),
  by_category:byCat,errors,rows};
}
function run({root,now=Date.now(),captureEnabled=true,settleEnabled=true}={}){
 if(!root)throw Error('root is required');
 const day=new Date(now+9*3600000).toISOString().slice(0,10);
 const last=read(path.join(root,'mansha_shadow_status.json'),{});
 const captureState=capture({root,at:now,day,enabled:captureEnabled});
 const ev=report(root,now);
 write(path.join(root,'mansha_shadow_evaluation.json'),ev);
 write(path.join(root,'mansha_shadow_status.json'),{
  schema:'tk-keirin-mansha-shadow-status/v1',
  generated_at:new Date(now).toISOString(),capture:captureState,
  last_result_check_at:settleEnabled?new Date(now).toISOString():last.last_result_check_at||null,
  summary:{saved:ev.summary.saved,evaluated:ev.summary.evaluated,pending:ev.summary.pending,
    awaiting_payout:ev.summary.awaiting_payout,excluded:ev.summary.excluded,errors:ev.errors.length}
 });
 console.log('MANSHA_SHADOW='+JSON.stringify({capture:captureState,summary:ev.summary.saved,
   evaluated:ev.summary.evaluated,riskHigh:ev.risk_high.saved,errors:ev.errors.length}));
 return ev;
}
if(require.main===module)run({root:path.join(__dirname,'../data/routed_history')});
module.exports={capture,report,run};
