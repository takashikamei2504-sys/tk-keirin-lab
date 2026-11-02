'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Audit=require('../js/results-audit.js'),Feed=require('../js/race-feed.js');
const Legacy=require('../js/race-brain.js'),Brain=require('../js/story-brain.js'),Form=require('../js/recent-form.js');
const Material=require('../js/race-material.js'),Build=require('../js/model-build.js');
const root=path.join(__dirname,'..');
const read=(file,fallback)=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback;
function save(file,value){const text=JSON.stringify(value)+'\n';if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')===text)return;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',text);fs.renameSync(file+'.tmp',file);}
function update(feedDir,outputDir=path.join(root,'data'),now){
 const liveClock=now===undefined;now=now||new Date().toISOString();
 const epoch=Date.parse(now);if(!Number.isFinite(epoch))throw Error('Invalid collection clock');
 const form=read(path.join(root,'data/recent_form.json'),{}),intel=read(path.join(root,'data/intelligence.json'),{}),materials=read(path.join(root,'data/race_material.json'),{});
 const historyDir=path.join(outputDir,'lab_history');fs.mkdirSync(historyDir,{recursive:true});
 const collection=read(path.join(feedDir,'collection.json'),{errors:[]});
 const previous=read(path.join(outputDir,'lab_evaluation.json'),{}).collection||{};
 const successful=Number(collection.feeds)>0;
 const lastScheduled=successful&&collection.event==='schedule'?now:previous.last_scheduled_at||null;
 const lastAutomatic=successful&&['schedule','workflow_run'].includes(collection.event)?now:previous.last_automatic_at||null;
 const errors=[...(collection.errors||[])];let generated=0;
 for(const name of fs.readdirSync(feedDir).filter(n=>/^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()){
  const feed=read(path.join(feedDir,name));if(feed.date+'.json'!==name||!Array.isArray(feed.races))throw Error('Invalid day feed');
  const file=path.join(historyDir,name),history=read(file,{schema:Audit.SCHEMA,date:feed.date,predictions:[],results:[]});
  const saved=new Set(history.predictions.map(p=>p.race_id+'|'+Audit.modelId(p)));
  for(const source of feed.races){
   if(source.is_girls||![7,9].includes(source.entries?.length))continue;
   try{
    const observed=Audit.result(source,feed,now);
    if(observed){
     const i=history.results.findIndex(x=>x.race_id===observed.race_id),prior=history.results[i];
     if(prior&&Date.parse(prior.source_updated_at)>Date.parse(observed.source_updated_at)){errors.push({date:feed.date,race:source.race_number,error:'古い配信結果を無視し既存結果を保持'});continue;}
     if(!prior||JSON.stringify(prior.combos)!==JSON.stringify(observed.combos)||JSON.stringify(prior.identity)!==JSON.stringify(observed.identity)||prior.race.start!==observed.race.start){
      observed.first_collected_at=prior?.first_collected_at||prior?.collected_at||now;
      if(prior)observed.revisions=[...(prior.revisions||[]),{collected_at:prior.collected_at,combos:prior.combos}].slice(-5);
      if(i<0)history.results.push(observed);else history.results[i]=observed;
     }
    }
    // Freeze forecasts only if both the real clock and feed publication are before start.
    const start=Date.parse(`${feed.date}T${source.start_time}:00+09:00`),published=Date.parse(feed.generated_at);
    const id=`${feed.date}:${source.venue}:${Number(source.race_number)}`;
    const generationStarted=liveClock?Date.now():epoch;
    if(!(generationStarted<start&&published<start&&published<=generationStarted)||saved.has(id+'|'+Build.model_id))continue;
    const race=Material.attach(Form.attach(Feed.convert(source,feed),form),materials),inputPack={...intel,observations:[...(intel.observations||[]),...(race.race_material?.comments||[])]},out=Brain.build(race,inputPack),base=Legacy.build(race,intel);
    const evidence=Object.values(out.profiles).flatMap(p=>p.memory||[]);
    const savedAt=liveClock?new Date().toISOString():now;
    if(!(Date.parse(savedAt)<start))continue;
    const prediction=Audit.snapshot(race,out,savedAt,{origin:process.env.GITHUB_ACTIONS==='true'?'github_actions':'development_automation',evidence,baseline:{version:Legacy.VERSION,chosen:base.chosen.slice(0,out.chosen.length).map(t=>t.key)}});
    prediction.code_hashes=Object.fromEntries(['story-brain.js','decision-reasons.js','tactical-deliberation.js','cross-line-tactics.js','race-reality.js','line-reactions.js','rider-context.js','race-material.js','race-brain.js','brain-memory.js','branch-weights.js','recent-form.js','race-feed.js'].map(file=>['js/'+file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'js',file))).digest('hex')]));
    prediction.input_sha256=crypto.createHash('sha256').update(JSON.stringify({race:prediction.input,evidence})).digest('hex');
    if(!prediction.pre_race)throw Error('Prediction was not pre-race');
    history.predictions.push(prediction);saved.add(id+'|'+Build.model_id);generated++;
   }catch(error){errors.push({date:feed.date,race:source.race_number,venue:source.venue,error:error.message});}
  }
  history.predictions.sort((a,b)=>a.race_id.localeCompare(b.race_id)||a.saved_at.localeCompare(b.saved_at));
  history.results.sort((a,b)=>a.race_id.localeCompare(b.race_id));save(file,history);
 }
 const rows=[];
 for(const file of fs.readdirSync(historyDir).filter(n=>/^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()){
  const h=read(path.join(historyDir,file)),latest=new Map();
  for(const p of h.predictions)if(!latest.has(p.race_id)||latest.get(p.race_id).saved_at<p.saved_at)latest.set(p.race_id,p);
  const resultMap=new Map(h.results.map(r=>[r.race_id,r]));
  for(const id of new Set([...latest.keys(),...resultMap.keys()])){
   const prediction=latest.get(id),observed=resultMap.get(id),race=observed?.race||prediction.input;
   rows.push({race_id:id,date:race.date,venue:race.venue,race_no:race.race_no,start:race.start,version:prediction?.version||null,model_id:prediction?Audit.modelId(prediction):null,saved_at:prediction?.saved_at||null,
    result:observed?{race_id:observed.race_id,race:{date:race.date,venue:race.venue,race_no:race.race_no,start:race.start},identity:observed.identity,combos:observed.combos,collected_at:observed.collected_at,source_url:observed.source_url,verification:observed.verification}:null,
    evaluation:observed?Audit.evaluate(prediction,observed):{status:'pending',category:'結果待ち'},history_url:'data/lab_history/'+file});
  }
 }
 rows.sort((a,b)=>b.date.localeCompare(a.date)||a.venue.localeCompare(b.venue,'ja')||b.race_no-a.race_no);
 const report={schema:Audit.SCHEMA,generated_at:now,collection:{feeds:collection.feeds||0,event:collection.event||'unknown',run_id:collection.run_id||null,last_scheduled_at:lastScheduled,last_automatic_at:lastAutomatic,errors},model_id:Build.model_id,summary:{...Audit.summarize(rows),current_model:Audit.summarize(rows.filter(r=>r.model_id===Build.model_id))},rows,
  policy:'モデル別の成績を区別し、旧版の成績を新版に帰属させない。同一レースは最新保存バージョンを1回だけ集計。各バージョンの最初の発走前予想は固定保存。過去レースへ予想を後付けしない。配信結果は公式未照合。'};
 save(path.join(outputDir,'lab_evaluation.json'),report);
 console.log(JSON.stringify({new_predictions:generated,reported_results:rows.filter(r=>r.result).length,evaluated:report.summary.evaluated,errors:errors.length}));return report;
}
if(require.main===module){const index=process.argv.indexOf('--feed-dir');if(index<0||!process.argv[index+1])throw Error('--feed-dir required');update(process.argv[index+1]);}
module.exports={update};
