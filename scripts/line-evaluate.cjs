'use strict';
/* Reuse collected results read-only; never generate a retrospective prediction.
 * Only inspect result files for dates that have frozen LINE records. Loading the
 * full LAB history also loads multi-megabyte prediction shards and exhausts
 * GitHub Actions' Node heap as the archive grows.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Evaluation=require('../js/line/evaluation.js');
const root=path.join(__dirname,'..');
function dayResults(labDir,date,errors){
 const results=new Map();
 if(!fs.existsSync(labDir))return results;
 // Latest result shards override legacy daily results, as in History.load.
 for(const file of [path.join(labDir,date+'.json'),path.join(labDir,date,'results.json')]){
  if(!fs.existsSync(file))continue;
  try{
   const data=JSON.parse(fs.readFileSync(file,'utf8'));
   if(!Array.isArray(data.results))throw Error('Invalid result records');
   for(const r of data.results){
    if(typeof r?.race_id!=='string'||!r.race_id.startsWith(date+':'))throw Error('Invalid result date');
    results.set(r.race_id,r);
   }
  }catch(e){errors.push({date,reason:'既存結果の形式を確認できない'});}
 }
 return results;
}
function report(lineDir,labDir,now=new Date().toISOString()){
 const rows=[],errors=[];
 if(fs.existsSync(lineDir))for(const date of fs.readdirSync(lineDir).filter(n=>/^\d{4}-\d{2}-\d{2}$/.test(n)).sort()){
  const dir=path.join(lineDir,date);if(!fs.statSync(dir).isDirectory())continue;
  // Keep only filenames and identifiers in memory, never prediction bodies.
  const records=[],seen=new Map();
  for(const filename of fs.readdirSync(dir).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).sort())try{
   const file=path.join(dir,filename),record=JSON.parse(fs.readFileSync(file,'utf8')),id=record.race_id+'|'+record.out?.provenance?.model?.model_id;
   const expected=crypto.createHash('sha256').update(id).digest('hex')+'.json';
   if(expected!==filename||!record.race_id?.startsWith(date+':')){errors.push({date,reason:'保存ファイル名と識別子が一致しない'});continue;}
   records.push({file,id});seen.set(id,(seen.get(id)||0)+1);
  }catch(e){errors.push({date,reason:'LINE保存記録を読み取れない'});}
  // Keep only this date's outcomes; never load unrelated LAB predictions.
  const results=dayResults(labDir,date,errors);
  for(const {file,id} of records){let record;try{record=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){errors.push({date,reason:'LINE保存記録を読み取れない'});continue;}const model=record.out?.provenance?.model?.model_id;
   const evaluation=seen.get(id)>1?{status:'excluded',category:'同一レース・モデルの保存記録が重複'}:Evaluation.evaluate(record,results.get(record.race_id));
   rows.push({race_id:record.race_id,model_id:model,saved_at:record.saved_at,input_sha256:record.out?.provenance?.input_sha256,evaluation});
  }
 }
 return {schema:'tk-line-evaluation/v1',generated_at:now,summary:Evaluation.summarize(rows),rows,errors,policy:'LINEの最初の発走前保存だけをモデル別に照合。保存予想を再計算・上書きせず、着順だけで展開の的中を認定しない。配信結果は公式原本との独立照合が未完了。保存がない過去レースへ予想を追加しない。'};
}
function update(){const out=report(path.join(root,'data/line_history'),path.join(root,'data/lab_history')),file=path.join(root,'data/line_evaluation.json');fs.writeFileSync(file+'.tmp',JSON.stringify(out)+'\n');fs.renameSync(file+'.tmp',file);console.log(JSON.stringify(out.summary));return out;}
if(require.main===module)update();module.exports={report,update};
