'use strict';
/* A separate research report. Never regenerates predictions or trains on race outcomes. */
const fs=require('node:fs'),path=require('node:path'),Evaluation=require('../js/line/positioning-evaluation.js');
const root=path.join(__dirname,'..');
function report(frozenDir,observationsFile,now=Date.now()){
 const errors=[],rows=[];
 const defaultPack={schema:'tk-line-positioning-observations/v1',observations:[]};
 let pack=defaultPack;
 try{if(fs.existsSync(observationsFile))pack=JSON.parse(fs.readFileSync(observationsFile,'utf8'));}catch(e){errors.push('観測ファイルを読み取れない');}
 if(pack.schema!==defaultPack.schema||!Array.isArray(pack.observations)){errors.push('観測ファイルの形式が不正');pack=defaultPack;}
 const byId=new Map();
 for(const observation of pack.observations){const id=observation.race_id;if(!id||byId.has(id)){errors.push('観測レースIDが重複または不明');continue;}byId.set(id,observation);}
 if(fs.existsSync(frozenDir))for(const date of fs.readdirSync(frozenDir).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)).sort()){
  const dir=path.join(frozenDir,date);if(!fs.statSync(dir).isDirectory())continue;
  for(const file of fs.readdirSync(dir).filter(x=>/^[a-f0-9]{64}\.json$/.test(x)).sort()){
   try{
    const record=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
    if(!record.race_id?.startsWith(date+':')){errors.push('日付と保存レースIDが不一致');continue;}
    const observation=byId.get(record.race_id);
    if(!observation){rows.push({race_id:record.race_id,model_id:record.out?.provenance?.model?.model_id,status:'excluded',reason:'検証済みの位置取り観測なし',compared:0,matched:0});continue;}
    const audit=Evaluation.compare(record,observation,now);
    rows.push({race_id:record.race_id,model_id:record.out?.provenance?.model?.model_id,...audit});
   }catch(e){errors.push(date+':位置取りの保存記録を読み取れない');}
  }
 }
 return {schema:'tk-line-positioning-evaluation/v1',generated_at:new Date(now).toISOString(),summary:Evaluation.summarize(rows),rows,errors,policy:'発走前に固定したLINEの予想のみを、出典付き実戦観測とモデル別に比較。実レースの着順から位置取りを後付け生成しない。学習・モデル係数書換えには利用しない。観測ゼロの一致率は不明のまま。'};
}
function update(){
 const output=report(path.join(root,'data/line_history'),path.join(root,'data/line_positioning_observations.json'));
 const file=path.join(root,'data/line_positioning_evaluation.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify(output.summary));return output;
}
if(require.main===module)update();
module.exports={report,update};
