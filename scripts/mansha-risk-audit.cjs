#!/usr/bin/env node
'use strict';
/* Read-only experiment: train through Aug 31, calibrate on Sep, evaluate once on Oct/Nov. */
const fs=require('node:fs/promises');
const archive=require('./mansha-study.cjs');
const risk=require('../js/mansha/risk.js');
const START='2026-05-08', END='2026-11-07';
const TRAIN_END='2026-09-01', CAL_END='2026-10-01';
const TARGET_CATEGORIES=['A7','C7','S7','S9'];
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const bounded=p=>Math.max(1e-6,Math.min(1-1e-6,p));
const stat=(a,predict)=>({
 n:a.length,positive:a.reduce((z,r)=>z+r.high,0),rate:mean(a.map(r=>r.high)),
 brier:mean(a.map(r=>(predict(r)-r.high)**2)),
 logloss:mean(a.map(r=>-(r.high*Math.log(bounded(predict(r)))+(1-r.high)*Math.log(1-bounded(predict(r))))))
});
function auc(rows,fn) {
 if(!rows.length)return null;
 const s=rows.map(r=>({x:fn(r),y:r.high})).sort((a,b)=>a.x-b.x);
 let rank=1,winRanks=0,positives=0;
 for(let i=0;i<s.length;){let j=i+1;while(j<s.length&&s[j].x===s[i].x)j++;
   const avg=(rank+(rank+j-i-1))/2;
   for(let k=i;k<j;k++){if(s[k].y){positives++;winRanks+=avg;}}
   rank+=j-i;i=j;
 }
 const neg=s.length-positives;
 return positives&&neg?(winRanks-positives*(positives+1)/2)/(positives*neg):null;
}
const group=(records,key)=>Object.fromEntries(TARGET_CATEGORIES.map(cat=>[cat,records.filter(r=>r.cat===cat)]));
function sliceStats(records,model,baselines){
 const baseFn=r=>baselines[r.cat],modelFn=r=>risk.probability(r,model);
 const selected=records.filter(r=>risk.score(r,model).priority);
 const top10=records.filter(r=>risk.score(r,model).band==='上位10%');
 const rest=records.filter(r=>!risk.score(r,model).priority);
 const expectation=rs=>rs.reduce((a,r)=>a+baselines[r.cat],0), high=rs=>rs.reduce((a,r)=>a+r.high,0);
 const byCat=group(records);
 return {
   n:records.length,actual:stat(records,modelFn),
   baseline:stat(records,baseFn),
   model_auc:auc(records,modelFn),baseline_auc:auc(records,baseFn),
   selected:{
     n:selected.length,high:high(selected),rate:mean(selected.map(r=>r.high)),
     rest_n:rest.length,rest_rate:mean(rest.map(r=>r.high)),
     lift_vs_same_category_baseline:expectation(selected)?high(selected)/expectation(selected):null,
     share_of_all_mansha:high(records)?high(selected)/high(records):null
   },
   top10:{
     n:top10.length,high:high(top10),rate:mean(top10.map(r=>r.high)),
     lift_vs_same_category_baseline:expectation(top10)?high(top10)/expectation(top10):null
   },
   by_category:Object.fromEntries(Object.entries(byCat).map(([cat,rs])=>[cat,{
     ...stat(rs,modelFn),baseline:stat(rs,baseFn),
     top25_n:rs.filter(x=>risk.score(x,model).priority).length,
     top25_high:rs.filter(x=>risk.score(x,model).priority).reduce((z,r)=>z+r.high,0)
   }]))
 };
}
async function main(){
 const dates=archive.dateList(START,END),all=[],days=[],missing=[],errors=[],excluded={
   size:0,girls_or_unclassified:0,pending_or_invalid_result:0,multiple_results:0,invalid_prelude:0};
 let index=0;
 async function worker(){
   while(index<dates.length){
     const date=dates[index++],doc=await archive.fetchDay(date);
     if(doc.error){errors.push({date,error:doc.error});continue}
     if(doc.missing){missing.push(date);continue}
     days.push(date);
     for(const r of doc.data||[]){
       const item=archive.parseRace(r,date,excluded);
       if(item&&TARGET_CATEGORIES.includes(item.cat))all.push(item);
     }
   }
 }
 await Promise.all(Array.from({length:8},worker));
 if(errors.length)throw Error('Archive fetch failed for '+JSON.stringify(errors.slice(0,10)));
 all.sort((a,b)=>a.date.localeCompare(b.date)||String(a.venue).localeCompare(String(b.venue))||Number(a.race_number)-Number(b.race_number));
 const train=all.filter(r=>r.date<TRAIN_END),cal=all.filter(r=>r.date>=TRAIN_END&&r.date<CAL_END),
 test=all.filter(r=>r.date>=CAL_END);
 if(train.length<1000||cal.length<500||test.length<500)throw Error('Insufficient train/calibration/holdout history');
 const seen=new Set();for(const r of all){const id=r.date+':'+r.venue+':'+r.race_number;if(seen.has(id))throw Error('Duplicate race '+id);seen.add(id);}
 const baselines={};for(const [cat,arr] of Object.entries(group(train))){baselines[cat]=(arr.reduce((n,r)=>n+r.high,0)+2)/(arr.length+4);}
 const model=risk.fit(train);
 risk.calibrate(model,cal);risk.thresholdFromValidation(model,cal);
 model.trained_from=days[0];model.train_before=TRAIN_END;model.calibration_from=TRAIN_END;
 model.calibration_before=CAL_END;model.holdout_from=CAL_END;model.study_end=END;
 model.training_categories=TARGET_CATEGORIES;model.baselines=baselines;
 const results={
  version:'mansha-risk-audit-v1.0',requested:{start:START,end:END,days:dates.length},
  available_days:days.length,missing_days:missing,excluded,train_start:days[0],train_end_inclusive:'2026-08-31',
  calibration_start:'2026-09-01',calibration_end_inclusive:'2026-09-30',holdout_start:'2026-10-01',holdout_end:END,
  baselines,training: sliceStats(train,model,baselines),calibration: sliceStats(cal,model,baselines),
  holdout: sliceStats(test,model,baselines),
  model_metadata:{version:model.version,weights:model.weights,features:model.features,calibration:model.calibration,thresholds:model.thresholds}
 };
 results.holdout_vs_baseline={brier_delta:results.holdout.actual.brier-results.holdout.baseline.brier,logloss_delta:results.holdout.actual.logloss-results.holdout.baseline.logloss};
 results.verdict=results.holdout.actual.brier<results.holdout.baseline.brier&&results.holdout.actual.logloss<results.holdout.baseline.logloss
 &&results.holdout.selected.lift_vs_same_category_baseline>1.05?'diagnostic_display_candidate':'no_calibrated_probability_adoption';
 await fs.mkdir('reports/mansha',{recursive:true});
 await fs.writeFile('reports/mansha/risk-v1-audit.json',JSON.stringify(results,null,2)+'\n');
 await fs.mkdir('js/mansha',{recursive:true});
 await fs.writeFile('js/mansha/model.js','/* Generated, read-only historical mansha score. Not a betting recommendation. */\n(function(root){root.ManshaRiskModel='+JSON.stringify(model)+';})(typeof globalThis!=="undefined"?globalThis:this);\n');
 const pct=p=>p==null?'-':(p*100).toFixed(1)+'%',num=n=>n==null?'-':n.toFixed(4);
 const summary=[
  '# 万車発生確率の時系列検証 (v1)','',
  '- 履歴：'+START+'〜'+END+'、取得'+days.length+'/'+dates.length+'日（欠損'+missing.length+'日）。',
  '- 予測：競走得点とライン構成・脚質など、発走表で確認できる情報のみ。結果・払戻は教師ラベルのみに使用。',
  '- モデル：少数の二値特徴によるL2正則化ロジスティック回帰。確率校正は9月のデータのみ。',
  '- 6〜8月学習、9月校正・万車リスク上位25%の閾値決定、10〜11月を一切触らず評価。',
  '- 判定：'+results.verdict,'',
  '| 区間 | R | 万車率 | Brier（区分基準） | Brier（モデル） | Logloss（区分基準） | Logloss（モデル） | AUC（モデル） | 上位25%発生率 | 残りの発生率 |','|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
 ];
 for(const key of ['training','calibration','holdout']){const x=results[key];summary.push('|'+key+'|'+x.n+'|'+pct(x.actual.rate)+'|'+num(x.baseline.brier)+'|'+num(x.actual.brier)+'|'+num(x.baseline.logloss)+'|'+num(x.actual.logloss)+'|'+num(x.model_auc)+'|'+pct(x.selected.rate)+'|'+pct(x.selected.rest_rate)+'|');}
 summary.push('','## Holdout上位層','- 上位25%判定：'+results.holdout.selected.n+'R、万車'+results.holdout.selected.high+'R、発生率'+pct(results.holdout.selected.rate)+'、他は'+pct(results.holdout.selected.rest_rate)+'、万車捕捉率'+pct(results.holdout.selected.share_of_all_mansha)+'。','- 上位10%判定：'+results.holdout.top10.n+'R、万車'+results.holdout.top10.high+'R、発生率'+pct(results.holdout.top10.rate)+'。','','**注意**：結果が良好でも単に万車が出やすいことを示すだけで、買い目の的中率や回収率の改善ではない。9月の調整と同一外部データの遡及保存に起因するバイアスを残す。別建て車券エンジンは投入しない。');
 await fs.writeFile('reports/mansha/risk-v1-audit.md',summary.join('\n')+'\n');
 if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,summary.join('\n')+'\n');
 console.log('MANSHA_AUDIT='+JSON.stringify({verdict:results.verdict,available_days:days.length,missing:missing.length,train:{n:results.training.n,rate:results.training.actual.rate},calibration:{n:results.calibration.n,rate:results.calibration.actual.rate},holdout:results.holdout,holdout_vs_baseline:results.holdout_vs_baseline}));
}
if(require.main===module)main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
module.exports={auc,stat,sliceStats};
