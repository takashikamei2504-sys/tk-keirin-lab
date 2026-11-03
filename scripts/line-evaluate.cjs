'use strict';
/* Reuse collected results read-only; never generate a retrospective prediction. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Evaluation=require('../js/line/evaluation.js'),History=require('./history-store.cjs');
const root=path.join(__dirname,'..');
function report(lineDir,labDir,now=new Date().toISOString()){
 const rows=[],errors=[],records=[],results=new Map();
 if(fs.existsSync(labDir))for(const date of History.dates(labDir)){try{for(const r of History.load(labDir,date).results)results.set(r.race_id,r);}catch(e){errors.push({date,reason:'既存結果の形式を確認できない'});}}
 if(fs.existsSync(lineDir))for(const date of fs.readdirSync(lineDir).filter(n=>/^\d{4}-\d{2}-\d{2}$/.test(n)).sort()){
  const dir=path.join(lineDir,date);if(!fs.statSync(dir).isDirectory())continue;
  for(const file of fs.readdirSync(dir).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).sort())try{
   const record=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8')),id=record.race_id+'|'+record.out?.provenance?.model?.model_id;
   const expected=crypto.createHash('sha256').update(id).digest('hex')+'.json';
   if(expected!==file||!record.race_id?.startsWith(date+':')){errors.push({date,reason:'保存ファイル名と識別子が一致しない'});continue;}
   records.push({record,id});
  }catch(e){errors.push({date,reason:'LINE保存記録を読み取れない'});}
 }
 const seen=new Map();for(const x of records)seen.set(x.id,(seen.get(x.id)||0)+1);
 for(const {record,id} of records){const model=record.out?.provenance?.model?.model_id;
  const evaluation=seen.get(id)>1?{status:'excluded',category:'同一レース・モデルの保存記録が重複'}:Evaluation.evaluate(record,results.get(record.race_id));
  rows.push({race_id:record.race_id,model_id:model,saved_at:record.saved_at,input_sha256:record.out?.provenance?.input_sha256,evaluation});
 }
 return {schema:'tk-line-evaluation/v1',generated_at:now,summary:Evaluation.summarize(rows),rows,errors,policy:'LINEの最初の発走前保存だけをモデル別に照合。保存予想を再計算・上書きせず、着順だけで展開の的中を認定しない。配信結果は公式原本との独立照合が未完了。保存がない過去レースへ予想を追加しない。'};
}
function update(){const out=report(path.join(root,'data/line_history'),path.join(root,'data/lab_history')),file=path.join(root,'data/line_evaluation.json');fs.writeFileSync(file+'.tmp',JSON.stringify(out)+'\n');fs.renameSync(file+'.tmp',file);console.log(JSON.stringify(out.summary));return out;}
if(require.main===module)update();module.exports={report,update};
