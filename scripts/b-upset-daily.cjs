'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Engine=require('../js/b-upset/engine.cjs');
const Eval=require('../js/b-upset/evaluation.cjs');
const Parent=require('../js/routing/evaluation.js');
const P=require('../js/model-provenance.js');
const BResults=require('./b-upset-results.cjs');
const Feed=require('../js/race-feed.js');
const Counts=require('../js/s-counts.js');
const Audit=require('../js/results-audit.js');
const repo=path.resolve(__dirname,'..');
const read=(file,fallback=null)=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback;
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value)+'\n');fs.renameSync(file+'.tmp',file);}
function files(root){
  if(!fs.existsSync(root))return [];
  return fs.readdirSync(root).filter(n=>/^\d{4}-\d{2}-\d{2}$/.test(n)).sort().flatMap(date=>fs.readdirSync(path.join(root,date)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(file=>({date,file,path:path.join(root,date,file)})));
}
function filename(id,model){return crypto.createHash('sha256').update(id+'|'+model).digest('hex')+'.json';}
function freeze(parent,dir,{clock=Date.now,ex=null,context=null}={}){
  if(Parent.evaluate(parent).status!=='pending'||parent.requested!=='auto')throw Error('親予想の発走前保存を確認できない');
  return freezeInput(parent.out.input,dir,{clock,ex,context,parent});
}
function freezeInput(raw,dir,{clock=Date.now,ex=null,context=null,parent=null,packs={}}={}){
  const at=clock(),model=require('../js/b-upset/build.json').model_id;
  const date=raw.date,id=raw.date+':'+raw.venue+':'+raw.race_no;
  const file=path.join(dir,date,filename(id,model));
  if(fs.existsSync(file))return {saved:false,reason:'existing'};
  if(!(at<Date.parse(raw.date+'T'+raw.start+':00+09:00')))return {saved:false,reason:'past'};
  const out=Engine.build(raw,{asOf:at,ex,context,packs});
  const now=clock();
  if(!(now<Date.parse(out.cutoff)))return {saved:false,reason:'cutoff_during_build'};
  out.overlap=parent?out.research.expanded.filter(t=>parent.out.tickets.some(p=>p.key===t.key)).map(t=>t.key):null;
  const record={schema:'tk-b-upset-frozen/v2',race_id:out.race_id,saved_at:new Date(now).toISOString(),
    parent_model_id:parent?.model_id||null,parent_output_sha256:parent?.output_sha256||null,output_sha256:P.sha256(out),out};
  if(Eval.evaluate(record).status!=='pending')throw Error('B-UPSET保存記録の整合性検査に失敗');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  try{fs.writeFileSync(file,JSON.stringify(record)+'\n',{flag:'wx'});}catch(e){if(e.code==='EEXIST')return {saved:false,reason:'existing'};throw e;}
  return {saved:true,file};
}
function report(dir,parentRoot,now=Date.now()){
  const rows=[],errors=[],actual=read(path.join(dir,'actual_b.json'),{});
  const ownResults=read(path.join(dir,'outcomes.json'),{});
  for(const entry of files(dir))try{
    const record=read(entry.path),o=record.out;
    if(filename(o.race_id,o.model.model_id)!==entry.file)throw Error('保存ファイル名不一致');
    const result=ownResults[o.race_id]||read(path.join(parentRoot,entry.date,'results.json'),{})[o.race_id];
    rows.push({race_id:o.race_id,...o.race,saved_at:record.saved_at,model_id:o.model.model_id,
      record:entry.date+'/'+entry.file,ranking:o.ranking,
      b_lines:[...new Set(o.scenarios.map(s=>s.b_line))],
      hypothesis_points:o.research.expanded.length,ad_points:o.research.ad.length,
      purchase:o.recommendation,overlap:o.overlap,evaluation:Eval.evaluate(record,result,actual[o.race_id])});
  }catch(e){errors.push({file:entry.path,error:e.message});}
  const group=key=>Object.fromEntries([...new Set(rows.map(key))].sort().map(k=>[k,Eval.summarize(rows.filter(r=>key(r)===k))]));
  return {schema:'tk-b-upset-evaluation/v2',generated_at:new Date(now).toISOString(),summary:Eval.summarize(rows),
    by_date:group(r=>r.date),by_cars:group(r=>String(r.cars)),by_model:group(r=>r.model_id),rows,errors};
}
async function run({dir=path.join(repo,'data/b_upset'),parentRoot=path.join(repo,'data/routed_history'),now=Date.now(),actualB=true,liveFeed=true}={}){
  const day=new Date(now+9*3600000).toISOString().slice(0,10),capture={saved:0,existing:0,past:0,errors:[]};
  const ownResults=read(path.join(dir,'outcomes.json'),{});
  const ex=read(path.join(repo,'data/ex_approved/latest.json')),context=read(path.join(repo,'data/b_axis_ex_context.json'));
  for(const entry of files(parentRoot).filter(x=>x.date===day))try{
    const saved=freeze(read(entry.path),dir,{ex,context});
    if(saved.saved)capture.saved++;else if(saved.reason==='existing')capture.existing++;else capture.past++;
  }catch(e){capture.errors.push({file:entry.file,error:e.message});}
  // Capture independently when the standard collector has not yet saved the card.
  if(liveFeed)try{
    const response=await fetch('https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/'+day+'.json',{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('日別出走表 HTTP '+response.status);
    const feed=await response.json();
    if(feed.date!==day||!Array.isArray(feed.races)||feed.races.length>250)throw Error('日別出走表の形式が不正');
    const packs={intelligence:read(path.join(repo,'data/intelligence.json'),{}),recent:read(path.join(repo,'data/recent_form.json'),{}),material:read(path.join(repo,'data/race_material.json'),{})};
    const counts=read(path.join(repo,'data/s_counts.json'),{});
    for(const source of feed.races){
      if(source.is_girls||![7,9].includes(source.entries?.length))continue;
      try{
        const result=Audit.result(source,feed,new Date().toISOString());
        if(result)ownResults[result.race_id]=result;
        const raw=Counts.attach(Feed.convert(source,feed),counts,Date.now());
        const saved=freezeInput(raw,dir,{ex,context,packs});
        if(saved.saved)capture.saved++;else if(saved.reason!=='existing')capture.past++;
      }catch(e){capture.errors.push({race_id:day+':'+source.venue+':'+source.race_number,error:e.message});}
    }
  }catch(e){capture.errors.push({date:day,error:e.message});}
  // Retry previous-day settlement if the ordinary collector has missed its run.
  const pendingDays=[...new Set(files(dir).map(f=>f.date))].filter(date=>date!==day).sort().slice(-7);
  for(const date of pendingDays)try{
    const response=await fetch('https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/'+date+'.json',{signal:AbortSignal.timeout(15000)});
    if(!response.ok)continue;
    const feed=await response.json();if(feed.date!==date||!Array.isArray(feed.races)||feed.races.length>250)continue;
    for(const source of feed.races){const result=Audit.result(source,feed,new Date().toISOString());if(result)ownResults[result.race_id]=result;}
  }catch(e){capture.errors.push({date,error:'結果取得：'+e.message});}
  write(path.join(dir,'outcomes.json'),ownResults);
  let observations={records:read(path.join(dir,'actual_b.json'),{}),errors:[]};
  if(actualB){
    const expected=new Map(Object.entries(ownResults));
    for(const date of [...new Set(files(dir).map(f=>f.date))])for(const result of Object.values(read(path.join(parentRoot,date,'results.json'),{}))){
      if(result.combos?.length&&result.race&&!expected.has(result.race_id))expected.set(result.race_id,result);
    }
    observations=await BResults.collect(expected,observations.records);
    write(path.join(dir,'actual_b.json'),observations.records);
  }
  const evaluation=report(dir,parentRoot);
  write(path.join(dir,'evaluation.json'),evaluation);
  write(path.join(dir,'status.json'),{generated_at:new Date().toISOString(),capture,actual_b_records:Object.keys(observations.records).length,result_errors:observations.errors});
  console.log(JSON.stringify({capture,summary:evaluation.summary,actual_b:Object.keys(observations.records).length}));
  return evaluation;
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={freeze,freezeInput,files,report,run,filename};
