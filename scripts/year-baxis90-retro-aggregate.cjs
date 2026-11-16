#!/usr/bin/env node
'use strict';
/* Reconcile all 18 fixed historical day shards. Strategy results are NOT contemporary frozen forecasts.
 * No hindsight decision: proxy and BAxis agreement are calculated on pre-result racecard input.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../reports/year-race-type'),dir=path.join(root,'baxis90-shards');
const raw=JSON.parse(fs.readFileSync(path.join(root,'complete90-eight-engine-audit.json'),'utf8'));
const expectedSha='4588ec938a2fec9e81216d3fd3423329805aa3d5';
if(raw.schema!=='tk-keirin-90day-exhaustive-fullrace-eight-engine-report/v1'||raw.races?.length!==5745||raw.source.pinned_commit!==expectedSha)throw Error('Frozen cohort has changed');
const tie=new Map([
 ['2026-08-22:松戸:3|lab_v5',180],
 ['2026-08-22:松戸:3|line',180],
 ['2026-08-22:松戸:3|roi_coverage',180],
 ['2026-08-26:玉野:6|b_upset_ad',1590]]);
const original=new Map(raw.races.map(r=>[r.race_id,r]));
const observed=new Map(),shaDaily=new Map(),complete=[],failures={};let seen=0;
for(let part=0;part<18;part++){
 const f=path.join(dir,'part-'+part+'.json'),o=JSON.parse(fs.readFileSync(f,'utf8'));
 if(o.schema!=='tk-keirin-90day-baxis-v06-shard/v1'||o.shard!==part||
 o.source_commit!==expectedSha||o.dates?.length!==5||o.expected!==o.completed||
 o.completed!==o.rows?.length||o.incomplete!==0||o.model!=='LAB_B_AXIS_V0.6.0')
   throw Error('Shard incomplete/mismatched '+part);
 const expectedDate=new Date(Date.parse('2026-08-18T00:00:00Z')+part*5*86400000).toISOString().slice(0,10);
 if(o.dates[0]!==expectedDate)throw Error('Partition shifted '+part);
 for(const [d,digest] of Object.entries(o.source_day_sha256)){
  if(shaDaily.has(d)||digest!==raw.source.day_sha256[d])throw Error('Source SHA mismatch or repeated day '+d);
  shaDaily.set(d,digest);
 }
 for(const r of o.rows){
  const x=original.get(r.id);
  if(!x||observed.has(r.id)||r.date!==x.date||r.cars!==x.cars||r.category!==x.category||
   r.meeting_day!==x.meeting_day||r.stage!==x.stage||r.venue!==x.venue)throw Error('Race identity, group, or duplicate '+r.id);
  if(r.model_version!=='LAB_B_AXIS_V0.6.0'||!Number.isInteger(r.b_axis_head)||!Number.isInteger(r.proxy_head)||
    r.agreement!==(r.b_axis_head===r.proxy_head)||![3,5,10].every(n=>r.settlement['baxis_'+n]))throw Error('Incomplete model '+r.id);
  for(const n of [3,5,10]){
   const s=r.settlement['baxis_'+n];
   if(s.stake!==s.points*100||s.payout<0||s.stake<0||s.net!==s.payout-s.stake||!!s.hit!==(s.payout>0)||s.points>n)throw Error('Invalid settlement '+r.id);
  }
  observed.set(r.id,r);complete.push(r);
 }
 for(const [k,v] of Object.entries(o.failures||{}))failures[k]=(failures[k]||0)+v;
 seen+=o.expected;
}
if(shaDaily.size!==90||complete.length!==5745||observed.size!==original.size||seen!==5745||Object.keys(failures).length)throw Error('Cohort incomplete '+JSON.stringify({days:shaDaily.size,rows:complete.length,seen,failures}));
complete.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
const names=['baxis_3','baxis_5','baxis_10','auto','physical','causal','lab_v5','line','roi_coverage','b_upset_ad','b_upset_expanded'];
const all=complete.map(b=>{
 const x=original.get(b.id),c={...b,period30:Math.floor((Date.parse(b.date+'T00:00:00Z')-Date.parse('2026-08-18T00:00:00Z'))/(30*86400000))};
 c.settlement={...b.settlement};
 for(const n of names.filter(x=>!x.startsWith('baxis'))){
  const v=x.predictions[n],plus=tie.get(b.id+'|'+n)||0;
  if(!v||v.stake!==v.points*100)throw Error('Invalid original prediction '+n);
  c.settlement[n]={stake:v.stake,points:v.points,payout:v.payout+plus,
   net:v.payout+plus-v.stake,hit:v.payout+plus>0};
 }
 if(c.period30<0||c.period30>2)throw Error('Invalid period');
 return c;
});
function metrics(rows,k){
 const a=rows.map(r=>r.settlement[k]),totals=(v,remove=[])=>{
  const exclude=new Set(remove);
  return{stake:v.reduce((s,z,i)=>s+(exclude.has(i)?0:z.stake),0),payout:v.reduce((s,z,i)=>s+(exclude.has(i)?0:z.payout),0)};
 };
 const x=totals(a),idx=[...a.keys()].sort((i,j)=>a[j].payout-a[i].payout||i-j);
 const trim=n=>{const t=totals(a,idx.slice(0,n));return t.stake>0?Math.round(10000*t.payout/t.stake)/100:null};
 const hits=a.filter(x=>x.payout>0);
 return{races:rows.length,purchased:a.filter(x=>x.points>0).length,
  hits:hits.length,hit_pct:rows.length?Math.round(hits.length*10000/rows.length)/100:null,
  tickets:a.reduce((s,x)=>s+x.points,0),
  stake_yen:x.stake,payout_yen:x.payout,net_yen:x.payout-x.stake,
  roi_pct:x.stake>0?Math.round(10000*x.payout/x.stake)/100:null,
  trim1_roi_pct:trim(1),trim5_roi_pct:trim(5),
  max_single_yen:idx.length?a[idx[0]].payout:0,
  max_single_share_pct:x.payout?Math.round(10000*a[idx[0]].payout/x.payout)/100:null,
  hit_50_to_100x:hits.filter(x=>x.payout>=5000&&x.payout<10000).length,
  hit_over_100x:hits.filter(x=>x.payout>=10000).length};
}
function pack(rows){return{races:rows.length,agree_count:rows.filter(x=>x.agreement).length,engines:Object.fromEntries(names.map(n=>[n,metrics(rows,n)]))}}
function group(fn){return Object.fromEntries([...new Set(all.map(fn))].sort().map(k=>[k,pack(all.filter(r=>fn(r)===k))]))}
function pairedBootstrap(group,engineA,engineB,seed=20261116,trials=6000){
 const parts=new Map();
 for(const x of group){
  const v=Math.floor((Date.parse(x.date+'T00:00:00Z')-Date.parse('2026-08-18T00:00:00Z'))/(5*86400000));
  if(!parts.has(v))parts.set(v,[]);parts.get(v).push(x);
 }
 const blocks=[...parts.values()].map(g=>[engineA,engineB].flatMap(k=>{
  const m=metrics(g,k);return[m.stake_yen,m.payout_yen]}));
 if(blocks.length<6)return null;
 let state=seed>>>0;const rand=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296};
 let xs=[];
 for(let j=0;j<trials;j++){
  const sums=[0,0,0,0];
  for(let i=0;i<blocks.length;i++){const b=blocks[Math.floor(rand()*blocks.length)];for(let k=0;k<4;k++)sums[k]+=b[k]}
  if(sums[0]&&sums[2])xs.push(100*sums[1]/sums[0]-100*sums[3]/sums[2]);
 }
 xs.sort((x,y)=>x-y);
 return{p025:Math.round(xs[Math.floor(xs.length*.025)]*10)/10,
 p975:Math.round(xs[Math.floor(xs.length*.975)]*10)/10,
 pct_positive:Math.round(1000*xs.filter(x=>x>0).length/xs.length)/10,
 blocks:blocks.length,resamples:xs.length};
}
const grpFinal=x=>x.meeting_day==='最終日'&&x.stage==='敗者戦';
const periods=group(x=>String(x.period30+1)+'期');
const agreement=group(x=>x.agreement?'一致':'不一致');
const byGrade=group(x=>x.category);
const finalDay=all.filter(grpFinal);
const finalGroup={all:pack(finalDay),
 by_agreement:Object.fromEntries(['一致','不一致'].map(k=>[k,pack(finalDay.filter(x=>(x.agreement?'一致':'不一致')===k))])),
 by_period:Object.fromEntries([0,1,2].map(i=>[String(i+1)+'期',pack(finalDay.filter(x=>x.period30===i))]))};
const summary={
 schema:'tk-keirin-90day-BAXIS-v06-all-eligible-retro/v1',generated_at:new Date().toISOString(),
 period:{start:'2026-08-18',end:'2026-11-15',days:90,full_races:all.length,source_sha:expectedSha},
 model:{version:'LAB_B_AXIS_V0.6.0',proxy:'pre-result rider style + score + published lines',
   cutoff:'10min before original scheduled start; model code developed Nov16'},
 checks:{source_days:shaDaily.size,duplicate_race_ids:0,baxis_model_errors:0,
   exact_shared_8engine_cohort:true,total_races:all.length,
   outcomes_withheld_from_prediction:true,
   frozen_original_publication_time_verified:false,
   historical_s_b_ex_data_available:false},
 overall:pack(all),
 by_agreement:agreement,
 by_30days:periods,
 by_category:byGrade,
 by_car_count:group(x=>x.cars===7?'7車':'9車'),
 by_meeting_day:group(x=>x.meeting_day),
 by_stage:group(x=>x.stage),
 by_agreement_30day:Object.fromEntries([0,1,2].map(i=>[String(i+1)+'期',
   Object.fromEntries(['一致','不一致'].map(k=>[k,pack(all.filter(x=>x.period30===i&&
    (x.agreement?'一致':'不一致')===k))]))])),
 by_agreement_car_count:Object.fromEntries([7,9].map(n=>[n,
   Object.fromEntries(['一致','不一致'].map(k=>[k,pack(all.filter(x=>x.cars===n&&
    (x.agreement?'一致':'不一致')===k))]))])),
 finalday_losers:finalGroup,
 consensus_vs_auto_bootstrap:pairedBootstrap(all.filter(x=>x.agreement),'baxis_5','auto'),
 consensus_vs_disagreement_not_paired:'Groups have different races; ROI is descriptive only, not directly causal.',
 limitations:[
  'Current November B-AXIS v0.6 reconstructed from late historical archive; original pre-race timestamp is NOT independently verified',
  'Missing real historical B/S/recent/EX; neutral provisional priors may sharply change performance',
  'No actual final-back B marker in this 5745-race source; projected leader is NOT B-observed accuracy',
  'Historical snapshots may have been revised; code/selection developed after races',
  'Exploratory same historical window; any discovered gate requires untouched future testing',
  'No betting odds, no EV-calibrated winning probabilities, no proof of profitable future wagers',
  'Earlier 661R comment-inferred sample selected on completeness is not comparable and not pooled',
  'No production branch, Railway or scheduler modified'
 ]};
const js=path.join(root,'baxis90-v06-exhaustive-summary.json');
fs.writeFileSync(js,JSON.stringify(summary,null,2)+'\n');
const fp=x=>x===null?'—':x.toFixed(1)+'%';
const md=[
 '# 競輪LAB B-AXIS v0.6：90日5,745Rの事後予想再生成と全8方式比較',
 '',
 '期間：2026年8月18日〜11月15日、男子7車／9車5,745R。同一対象で現行B-AXISを再予測。',
 '',
 '重要：この再生は2026年11月版を過去に適用した事後シミュレーション。元データ公開時刻は検証できず、S・B・EX等は未取得。結果・払戻は予測生成後にのみ照合した。',
 '',
 '## 90日全件（各買い目100円）',
 '',
 '| 方式 | R | 的中 | 投資 | 払戻 | 回収率 | 高額1件除外 | 高額5件除外 |',
 '|---|---:|---:|---:|---:|---:|---:|---:|'];
for(const k of names){
 const m=summary.overall.engines[k];
 md.push('| '+k+' | '+m.races+' | '+m.hits+' | '+m.stake_yen+' | '+m.payout_yen+' | '+fp(m.roi_pct)+' | '+fp(m.trim1_roi_pct)+' | '+fp(m.trim5_roi_pct)+' |');
}
md.push('','## B候補2方式の一致別（各方式の買い目はそのまま固定）','','| 条件 | R | B-AXIS上位5点 | B-AXIS高額5件除外 | AUTO | AUTO高額5件除外 |','|---|---:|---:|---:|---:|---:|');
for(const k of ['一致','不一致']){
 const x=summary.by_agreement[k],a=x.engines.baxis_5,b=x.engines.auto;
 md.push('| '+k+' | '+x.races+' | '+fp(a.roi_pct)+' | '+fp(a.trim5_roi_pct)+' | '+fp(b.roi_pct)+' | '+fp(b.trim5_roi_pct)+' |');
}
md.push('','## 30日ごとの再現性（同じ予測ロジック・途中変更なし）','','| 期間 | R | B-AXIS上位5点 | AUTO | B候補一致率 |','|---|---:|---:|---:|---:|');
for(let i=1;i<=3;i++){const x=periods[i+'期'];md.push('| 第'+i+'期 | '+x.races+' | '+fp(x.engines.baxis_5.roi_pct)+' | '+fp(x.engines.auto.roi_pct)+' | '+fp(x.races?100*x.agree_count/x.races:null)+' |')}
md.push('','## 最終日敗者戦','','| 全体/一致/不一致 | R | B-AXIS上位5点 | 1件除外 | 5件除外 | AUTO |','|---|---:|---:|---:|---:|---:|');
for(const [label,x] of [['最終日敗者戦全体',finalGroup.all],...Object.entries(finalGroup.by_agreement)]){
 const a=x.engines.baxis_5,b=x.engines.auto;
 md.push('| '+label+' | '+x.races+' | '+fp(a.roi_pct)+' | '+fp(a.trim1_roi_pct)+' | '+fp(a.trim5_roi_pct)+' | '+fp(b.roi_pct)+' |')}
md.push('','## 判定','','- 対象期間内で結果を見たルール選択は禁止。全分類は探索的で、将来性能の保証ではない。',
 '- BAXISの上位3/5/10点は得点や脚質を使う条件付き着順ランキングであり、校正された的中確率・期待値ではない。',
 '- 最高払戻除外と30日変動を最優先で確認し、単純なROI首位による本番方式の自動切替をしない。',
 '- 最終バックの実測精度はこのデータでは不明。B推定先頭が1着した率と混同しない。',
 '- 90日全件・追加661R・実測B84Rを混合せず、それぞれ別母集団として管理。',
 '- main / Railway / 発走前の保存処理は未変更。','',
 '詳細は同名JSON。ソースデータの各日SHA256は元のcomplete90監査ファイルを照合。');
fs.writeFileSync(path.join(root,'baxis90-v06-exhaustive-summary-ja.md'),md.join('\n')+'\n');
const compact={n:all.length,consensus:summary.by_agreement['一致'].races,
overall:Object.fromEntries(['baxis_3','baxis_5','baxis_10','auto'].map(k=>[k,
 {roi:summary.overall.engines[k].roi_pct,trim5:summary.overall.engines[k].trim5_roi_pct}])),
finalday:finalGroup.all.races};
console.log('BAXIS90_AGGREGATE',JSON.stringify(compact));
