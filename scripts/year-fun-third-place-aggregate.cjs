#!/usr/bin/env node
'use strict';
/** Full 90d empirical fun/car-number test with pseudo-random/placebo and no-bet control.
 * Research-only; source/model developed after historic race, not a true ante-post forecast.
 */
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../reports/year-race-type');
const PREP=JSON.parse(fs.readFileSync(path.join(ROOT,'complete90-eight-engine-audit.json'),'utf8'));
const EXPECTED_SHA='4588ec938a2fec9e81216d3fd3423329805aa3d5';
if(PREP.races.length!==5745||PREP.source?.pinned_commit!==EXPECTED_SHA)throw Error('Original fixed source changed');
const original=new Map(PREP.races.map(x=>[x.race_id,x]));
if(original.size!==5745)throw Error('Duplicated reference race');
const all=[],seen=new Set();
for(let shard=0;shard<18;shard++){
 const f=JSON.parse(fs.readFileSync(path.join(ROOT,'fun-third-shards','part-'+shard+'.json'),'utf8'));
 if(f.schema!=='tk-keirin-rational-irrational-3rd-add-shard/v1'||f.shard!==shard||
 f.source!==EXPECTED_SHA||f.expected!==f.completed||f.completed!==f.rows?.length||Object.keys(f.failures||{}).length)throw Error('Invalid or failed full shard '+shard);
 const expectedStart=new Date(Date.parse('2026-08-18T00:00:00Z')+shard*5*86400000).toISOString().slice(0,10);
 if(f.date_start!==expectedStart)throw Error('Date partition mismatch '+shard);
 for(const r of f.rows){
  const orig=original.get(r.id);
  if(!orig||seen.has(r.id)||orig.date!==r.date||orig.cars!==r.cars||
   orig.category!==r.category||orig.stage!==r.stage||orig.meeting_day!==r.meeting)throw Error('Race/repeated id '+r.id);
  seen.add(r.id);
  const day=Math.round((Date.parse(r.date+'T00:00:00Z')-Date.parse('2026-08-18T00:00:00Z'))/86400000);
  if(!Number.isInteger(day)||day<0||day>=90)throw Error('Invalid period');
  for(const name of ['auto','upset']){
   const origSet=orig.predictions[name==='auto'?'auto':'b_upset_ad'],settle=r.base[name];
   const payoutAdd=(r.id==='2026-08-26:玉野:6'&&name==='upset')?1590:0;
   if(settle.s!==origSet.stake||settle.p!==origSet.payout+payoutAdd)throw Error('Raw baseline mismatch '+r.id);
   if(settle.s!==settle.n*100||settle.s<0||settle.p<0)throw Error('Base negative/inconsistent '+r.id);
   for(const depth of [1,2]){
    const exp=['digit_1','digit_2','digit_3','digit_4','digit_5','digit_6','digit_7','digit_8','digit_9',
      'date_digit','random','lowest_score','outside_line','matched6','matched_random6'];
    for(const key of exp){
     const e=r.add[name+'|'+depth+'|'+key];
     if(!e||e.n>depth||e.s!==100*e.n||e.s<0||e.p<0)throw Error('Bad addition '+name+' '+key+' '+r.id);
    }
    if(r.add[name+'|'+depth+'|matched6'].s!==r.add[name+'|'+depth+'|matched_random6'].s)throw Error('Unequal matched investment '+r.id);
   }
   for(const key of ['digit_6','digit_7','matched6','matched_random6','random','lowest_score','date_digit']){
    const swap=r.swap[name+'|'+key];
    if(swap&&(swap.replaced.s!==settle.s||swap.base.s!==settle.s||swap.base.p!==settle.p))throw Error('Not cost-neutral '+key+' '+r.id);
   }
  }
  all.push({...r,day,period:Math.floor(day/30)+1});
 }
}
if(all.length!==5745||seen.size!==5745)throw Error('Incomplete 5745 experimental cohort');
all.sort((a,b)=>a.day-b.day||a.id.localeCompare(b.id));
const sortTrim=(books,k)=>{
 const stake=books.reduce((v,x)=>v+x.s,0),paid=books.reduce((v,x)=>v+x.p,0);
 const order=[...books.keys()].sort((i,j)=>books[j].p-books[i].p||i-j);
 const ids=new Set(order.slice(0,k)),s=books.reduce((v,x,i)=>v+(ids.has(i)?0:x.s),0),
 p=books.reduce((v,x,i)=>v+(ids.has(i)?0:x.p),0);
 return s?+(100*p/s).toFixed(2):null;
};
function score(books){
 const invested=books.reduce((v,x)=>v+x.s,0),payout=books.reduce((v,x)=>v+x.p,0);
 const net=payout-invested;
 const hits=books.filter(x=>x.p>0);
 const top5paid=books.map(x=>x.p).sort((a,b)=>b-a).slice(0,5).reduce((v,x)=>v+x,0);
 return{
  races:books.length,purchased:books.filter(x=>x.s>0).length,
  ticket_points:books.reduce((v,x)=>v+x.n,0),
  hits:hits.length,stake_yen:invested,payout_yen:payout,net_yen:net,
  roi_pct:invested?+(100*payout/invested).toFixed(2):null,
  trim1_roi_pct:sortTrim(books,1),trim5_roi_pct:sortTrim(books,5),
  highest_payout_yen:Math.max(0,...books.map(x=>x.p)),
  top5_payout_share_pct:payout?+(100*top5paid/payout).toFixed(1):null,
  over5000_paid_races:hits.filter(x=>x.p>=5000).length,
  over10000_paid_races:hits.filter(x=>x.p>=10000).length
 };
}
const baseBook=(r,name)=>r.base[name];
const extraBook=(r,name,depth,key)=>r.add[name+'|'+depth+'|'+key];
const combined=(r,name,depth,key)=>{
 const b=baseBook(r,name),e=extraBook(r,name,depth,key);
 return{s:b.s+e.s,p:b.p+e.p,n:b.n+e.n};
};
function summarize(cohort,name,depth,key){
 const original=cohort.map(r=>baseBook(r,name));
 const extra=cohort.map(r=>extraBook(r,name,depth,key));
 const full=cohort.map(r=>combined(r,name,depth,key));
 const marginal=score(extra),overall=score(full),base=score(original);
 return{original:base,addition:marginal,combined:overall,
  incremental_net_yen:marginal.net_yen,
  captured_after_base_miss:cohort.filter(r=>r.base[name].p===0&&extraBook(r,name,depth,key).p>0).length};
}
function pairComparison(cohort,name,depth){
 const s6=cohort.map(r=>extraBook(r,name,depth,'matched6')),
   random=cohort.map(r=>extraBook(r,name,depth,'matched_random6'));
 const m6=score(s6),p=score(random);
 if(m6.stake_yen!==p.stake_yen)throw Error('Total placebo stake differs');
 return{six:m6,placebo:p,added_both_same_stakes:true};
}
function bootstrapSameCost(cohort,name,depth,n=8000){
 // Five-day clustered resampling over last 60 days, includes zero-add days as sample blocks.
 const blocks=Array.from({length:12},()=>[0,0,0,0]);
 for(const r of cohort){
  const i=Math.floor((r.day-30)/5);
  if(i<0||i>=12)throw Error('Out of heldout period');
  for(const [j,key] of [[0,'matched6'],[2,'matched_random6']]){
   const s=extraBook(r,name,depth,key);
   blocks[i][j]+=s.s;blocks[i][j+1]+=s.p;
  }
 }
 let state=(20261116+(name==='upset'?7:0)+depth*101)>>>0;
 const rnd=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296};
 const v=[];
 for(let i=0;i<n;i++){
  const z=[0,0,0,0];for(let j=0;j<12;j++){const a=blocks[Math.floor(rnd()*12)];for(let k=0;k<4;k++)z[k]+=a[k]}
  if(z[0]>0&&z[2]>0){
   if(z[0]!==z[2])throw Error('Placebo blocks do not match stake');
   v.push(100*(z[1]-z[3])/z[0]);
  }
 }
 v.sort((a,b)=>a-b);
 return{difference_roi_pctpoints_95:v.length?[+v[Math.floor(v.length*.025)].toFixed(1),+v[Math.floor(v.length*.975)].toFixed(1)]:null,
  prob6_gt_placebo:v.length?+(v.filter(x=>x>0).length/v.length).toFixed(3):null,
  five_day_blocks:12,replications:v.length};
}
function swaps(cohort,name,key){
 const xs=cohort.filter(r=>r.swap[name+'|'+key]);
 const before=xs.map(r=>r.swap[name+'|'+key].base),after=xs.map(r=>r.swap[name+'|'+key].replaced);
 const b=score(before),a=score(after);
 if(b.stake_yen!==a.stake_yen)throw Error('Swaps do not preserve expenditure');
 return{eligible_races:xs.length,baseline:b,after:a,incremental_profit_yen:a.net_yen-b.net_yen,
  roi_difference_pctpoints: (a.roi_pct!==null&&b.roi_pct!==null)?+(a.roi_pct-b.roi_pct).toFixed(2):null};
}
const KINDS=['digit_1','digit_2','digit_3','digit_4','digit_5','digit_6','digit_7','digit_8','digit_9',
  'date_digit','random','lowest_score','outside_line','matched6','matched_random6'];
const scopes={
 all90:all,heldout60:all.filter(r=>r.day>=30),
 loss_finalday:all.filter(r=>r.stage==='敗者戦'&&r.meeting==='最終日'),
 car7:all.filter(r=>r.cars===7),
 car9:all.filter(r=>r.cars===9),
 nonfavorite:all.filter(r=>r.nonfavorite),
 disagreement:all.filter(r=>!r.agreement),
 period1:all.filter(r=>r.period===1),
 period2:all.filter(r=>r.period===2),
 period3:all.filter(r=>r.period===3),
};
const outcomes={};
for(const [scope,cohort] of Object.entries(scopes)){
 const result={n:cohort.length};
 for(const name of ['auto','upset'])for(const depth of [1,2]){
  const id=name+'|'+depth;
  result[id]={variants:Object.fromEntries(KINDS.map(k=>[k,summarize(cohort,name,depth,k)]))};
  result[id].matched=pairComparison(cohort,name,depth);
  if(scope==='heldout60')result[id].bootstrap=bootstrapSameCost(cohort,name,depth);
  if(depth===1)result[id].swaps=Object.fromEntries(['digit_6','digit_7','matched6','matched_random6',
    'random','lowest_score','date_digit'].map(k=>[k,swaps(cohort,name,k)]));
 }
 outcomes[scope]=result;
}
// Walk-forward digit-of-the-month roulette: select the best historical digit on prior 30 days,
// use next 5 days; compare fixed #6 and deterministic placebo. Never select on current result.
const walkforward={};
for(const name of ['auto','upset'])for(const depth of [1,2]){
 const decisions=[],picked=[],fixed6=[],fixed7=[],random=[],date=[];
 for(let d=30;d<90;d+=5){
  const train=all.filter(r=>r.day>=d-30&&r.day<d),test=all.filter(r=>r.day>=d&&r.day<d+5);
  let options=[];
  for(let n=1;n<=9;n++){
   const k='digit_'+n,m=score(train.map(r=>extraBook(r,name,depth,k)));
   if(m.ticket_points>=60)options.push({digit:n,n:m.ticket_points,trim1:m.trim1_roi_pct,roi:m.roi_pct});
  }
  const winner=options.slice().sort((a,b)=>b.trim1-a.trim1||a.digit-b.digit)[0]||null;
  decisions.push({train_start:train[0].date,train_end:train.at(-1).date,test_start:test[0].date,
   test_end:test.at(-1).date,best_prior30:winner,comparisons:options});
  for(const r of test){
   if(winner)picked.push(extraBook(r,name,depth,'digit_'+winner.digit));
   fixed6.push(extraBook(r,name,depth,'digit_6'));
   fixed7.push(extraBook(r,name,depth,'digit_7'));
   random.push(extraBook(r,name,depth,'random'));
   date.push(extraBook(r,name,depth,'date_digit'));
  }
 }
 walkforward[name+'|'+depth]={
  prior30_best_digit:score(picked),fixed6:score(fixed6),fixed7:score(fixed7),
  predetermined_random:score(random),date_digit:score(date),decisions};
}
const out={
 schema:'tk-keirin-rational-irrational-third-place-5745r/v1',
 generated_at:new Date().toISOString(),
 period:{from:'2026-08-18',through:'2026-11-15',days:90,eligible:5745},
 data_integrity:{source_commit:EXPECTED_SHA,source_verified_days:90,
  all_8engine_baselines_checked:true,
  result_not_used_for_ticket_generation:true,
  matched_placebo_equal_ticket_count_each_race:true,
  every_added_ticket_unique_vs_base:true,simulation_stake_per_ticket_yen:100},
 experiment:{
  hypothesis:'Can arbitrary fixed third numbers and date-seeded/low-scoring/outsider picks add ROI to rational AUTO or B-UPSET tickets?',
  decisions_known_pre_result:['third digit 1-9','race/date rotation','stable pseudo-random',
   'lowest scoring eligible rider','outside line low-score rider','matched random non6'],
  selection:'Take up to the first two DISTINCT first-second pairs from the original ordered model tickets; add one novel valid third per pair if available.',
  controls:'Compare each addition marginal investment and net profit. Same-cost #6 against random non-6 for matching eligible first-second pairs. Replace last original ticket for cost-neutral swap.',
  time_test:'Walk-forward: last 30 calendar days winning digit after trim-top1, min 60 added tickets; apply next 5 days, never use same race result.',
  source_caveat:'Retrospective current-November-2026 prediction, raw source original publication time not independently verified.'},
 by_scope:outcomes,
 chronological_prior30_digit_router:walkforward,
 limitations:[
  'The entire 90-day window has previously been explored; even period splitting is only retrospective temporal testing, not untouched prospective validation.',
  'A candidate digit is intentionally noncausal. Car number 6 may correlate with race structure, line assignment, winner positions, rider rank and other hidden features.',
  'Nine fixed car numbers + date/odd/score controls are many comparisons. Best ex-post observed digit is selection bias, not a proven edge.',
  'Historical original 8-engine tickets plus source may have been revised after race; timestamps not independently verified.',
  'No official per-combination historical pre-close odds for losing bets, so exact intentional 50–100× ticket selection cannot be reproduced.',
  'Potential winning bets excluded from original portfolios have higher payout, but adding tickets adds a full 100 yen risk each time.',
  'Any uplift in payout could be due to extreme rare wins; use tail-removed and 30-day temporal diagnostics.',
  'Do not pool 661 comment-inferred historical sample or 84 observed-B cases into this full 90-day cohort.',
  'No production main, Railway or notifications changed.'
 ]
};
fs.writeFileSync(path.join(ROOT,'fun-third-place-irrational-5745r-summary.json'),JSON.stringify(out,null,2)+'\n');
const pct=x=>x===null||x===undefined?'—':x.toFixed(1)+'%';
const report=[
 '# 競輪LAB自由研究：合理×非合理、3着に車番6や遊びの数字を足すと儲かるか',
 '',
 '対象 2026年8月18日〜11月15日の男子7・9車5,745R、AUTOとB-UPSET A〜Dの買い目を毎回再生成。',
 '',
 '## 設計（予測時に結果・払戻は参照しない）',
 '- 既存の上位買い目から異なる1着・2着ペアを1組（別検証では2組）抽出。',
 '- 3着6を加える。6が1着や2着にいる、既に買っている、出走しない場合は追加しない。',
 '- 3着1〜9の全車番、日付由来・疑似乱数・低得点選手・別ライン選手とも比較。',
 '- 元の買い目に追加した部分だけの回収率（限界投資効果）、追加後の全体回収率、1点差し替えの同額比較を併記。',
 '- 特に3着6と、同じ条件・同じ追加点数で非6をランダムに選ぶ対照を比較。',
 '',
 '## 全90日：上位の1着・2着ペア1組へ3着を1点追加',
 '',
 '| エンジン | 追加3着 | 追加券数 | 追加券の限界ROI | 元のROI | 追加後のROI | 上位5件除外 |',
 '|---|---|---:|---:|---:|---:|---:|',
];
for(const name of ['auto','upset']){
 const obj=outcomes.all90[name+'|1'];
 for(const k of ['digit_6','digit_7','random','date_digit','lowest_score','outside_line','matched_random6']){
  const x=obj.variants[k];
  report.push('| '+name+' | '+k+' | '+x.addition.ticket_points+' | '+pct(x.addition.roi_pct)+' | '+pct(x.original.roi_pct)+' | '+pct(x.combined.roi_pct)+' | '+pct(x.combined.trim5_roi_pct)+' |');
 }
}
report.push('','## コストを変えない1点差替え（全90日で差替え可能な対象だけ比較）',
 '','| エンジン | 入替3着 | 対象R | 元のROI | 入替後ROI | 差（ポイント） |',
 '|---|---|---:|---:|---:|---:|');
for(const name of ['auto','upset']){
 for(const k of ['digit_6','digit_7','random','lowest_score','date_digit']){
  const m=outcomes.all90[name+'|1'].swaps[k];
  report.push('| '+name+' | '+k+' | '+m.eligible_races+' | '+pct(m.baseline.roi_pct)+' | '+pct(m.after.roi_pct)+' | '+(m.roi_difference_pctpoints??'—')+' |');
 }
}
report.push('','## 同条件・同点数の3着6とランダム非6比較（後半60日）',
 '','| エンジン | 先頭ペア数 | 対象追加券数 | 3着6限界ROI | ランダム限界ROI | 差の95%区間（pp） |',
 '|---|---:|---:|---:|---:|---|');
for(const name of ['auto','upset'])for(const depth of [1,2]){
 const m=outcomes.heldout60[name+'|'+depth];
 report.push('| '+name+' | '+depth+' | '+m.matched.six.ticket_points+' | '+pct(m.matched.six.roi_pct)+' | '+pct(m.matched.placebo.roi_pct)+' | '+JSON.stringify(m.bootstrap.difference_roi_pctpoints_95)+' |');
}
report.push('','## 最初の30日を参考にした次の30日の数字選択',
 '','| 基本方式 | 1・2着ペア数 | 過去30日の首位数字を次5日 | 3着6固定 | 3着7固定 | ランダム |',
 '|---|---:|---:|---:|---:|---:|');
for(const name of ['auto','upset'])for(const depth of [1,2]){
 const m=walkforward[name+'|'+depth];
 report.push('| '+name+' | '+depth+' | '+pct(m.prior30_best_digit.roi_pct)+' | '+pct(m.fixed6.roi_pct)+' | '+pct(m.fixed7.roi_pct)+' | '+pct(m.predetermined_random.roi_pct)+' |');
}
report.push('','## 判断',
 '- 的中金額が高い一例だけで数字を選ぶことはしない。最高払戻1・5件除外、期間別の再現、疑似ランダムとの差を先に評価する。',
 '- 3着6の「理由のなさ」は、価値観の実験として採用するのであって、統計的優位性を意味しない。',
 '- 予測当時の本物の買い目凍結ではなく、2026年11月の現行モデルを古い出走表に事後適用している。',
 '- 買い目を加えることで回収率が上がるかは追加券だけの限界ROIが100%を超えるかも重要。',
 '- 本番main / Railway / 自動通知には変更を加えていない。',
 '',
 '全9車番・全条件・級班・車数・30日・差替え・疑似乱数対照は同名JSON参照。');
fs.writeFileSync(path.join(ROOT,'fun-third-place-irrational-5745r-summary-ja.md'),report.join('\n')+'\n');
const brief=Object.fromEntries(['auto','upset'].map(name=>[name,Object.fromEntries(['digit_6','digit_7','random','matched6','matched_random6'].map(k=>{
 const q=outcomes.all90[name+'|1'].variants[k];return[k,{n:q.addition.ticket_points,extraROI:q.addition.roi_pct,overallROI:q.combined.roi_pct,trim5:q.combined.trim5_roi_pct}]
 }))]));
console.log('FUN_THIRD_AGGREGATE_SUCCESS',JSON.stringify({n:all.length,brief,holdoutMatched:Object.fromEntries(['auto','upset'].map(k=>[k,outcomes.heldout60[k+'|1'].matched])),walkforward:Object.fromEntries(['auto','upset'].map(k=>[k,walkforward[k+'|1'].prior30_best_digit]))}).slice(0,9000));
