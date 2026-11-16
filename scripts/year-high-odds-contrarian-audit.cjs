#!/usr/bin/env node
'use strict';
/**
 * Historic high-return contribution & pre-result structural contrarian probes.
 * Counts of payout >=5000 are retrospective DESCRIPTORS, not tradable pre-race
 * signals. Structural picks use solely already-replayed pre-result race features.
 * No 2026-08..11 source publication timestamp verified.
 */
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../reports/year-race-type');
const SHA='4588ec938a2fec9e81216d3fd3423329805aa3d5';
const baseline=JSON.parse(fs.readFileSync(path.join(ROOT,'complete90-eight-engine-audit.json'),'utf8'));
if(baseline.races?.length!==5745||baseline.source?.pinned_commit!==SHA) throw Error('Original fixed 90-day cohort changed');
const source=new Map(baseline.races.map(x=>[x.race_id,x]));
if(source.size!==5745)throw Error('Duplicate fixed source identity');
const tie=new Map([
 ['2026-08-22:松戸:3|lab_v5',180],['2026-08-22:松戸:3|line',180],
 ['2026-08-22:松戸:3|roi_coverage',180],['2026-08-26:玉野:6|b_upset_ad',1590]]);
const engines=['auto','baxis_3','baxis_5','baxis_10','physical','causal','lab_v5','line','roi_coverage','b_upset_ad','b_upset_expanded'];
const found=new Set(),dates=new Set(),records=[];
for(let shard=0;shard<18;shard++){
 const f=JSON.parse(fs.readFileSync(path.join(ROOT,'baxis90-shards','part-'+shard+'.json'),'utf8'));
 if(f.schema!=='tk-keirin-90day-baxis-v06-shard/v1'||f.shard!==shard||
   f.source_commit!==SHA||f.model!=='LAB_B_AXIS_V0.6.0'||f.completed!==f.expected||f.incomplete!==0)throw Error('Bad v0.6 shard '+shard);
 for(const [date,digest] of Object.entries(f.source_day_sha256)){
  if(dates.has(date)||baseline.source.day_sha256[date]!==digest)throw Error('Source mismatch '+date);
  dates.add(date);
 }
 for(const b of f.rows){
  const o=source.get(b.id);
  if(!o||found.has(b.id)||o.date!==b.date||o.cars!==b.cars||
   o.category!==b.category||o.stage!==b.stage||o.meeting_day!==b.meeting_day)throw Error('Identity mismatch '+b.id);
  found.add(b.id);
  const settlement={...b.settlement};
  for(const e of engines.filter(e=>!e.startsWith('baxis_'))){
   const x=o.predictions[e],paid=x.payout+(tie.get(b.id+'|'+e)||0);
   settlement[e]={stake:x.stake,points:x.points,payout:paid};
  }
  for(const e of engines){
   const x=settlement[e];
   if(!x||x.stake!==x.points*100||x.stake<0||x.payout<0)throw Error('Invalid settlement '+e+' '+b.id);
  }
  const day=Math.round((Date.parse(b.date+'T00:00:00Z')-Date.parse('2026-08-18T00:00:00Z'))/86400000);
  if(!Number.isInteger(day)||day<0||day>=90)throw Error('Date wrong '+b.id);
  records.push({id:b.id,day,date:b.date,cars:b.cars,category:b.category,
   stage:b.stage,meeting:b.meeting_day,
   pre:{nonfavorite:!!b.proxy_nonfavorite,agreement:!!b.agreement,head_margin:b.b_axis_margin},
   settlement});
 }
}
if(records.length!==5745||found.size!==5745||dates.size!==90)throw Error('Full audit incomplete');
records.sort((a,b)=>a.day-b.day||a.id.localeCompare(b.id));
const details={
 low:'payout positive less than 5000 yen',
 medium:'winning payout per race at least 5000 and below 10000 yen',
 high:'winning payout per race at least 10000 yen'
};
const bin=p=>p===0?'zero':p<5000?'low':p<10000?'medium':'high';
function stat(rows,e){
 const bets=rows.map(r=>r.settlement[e]);
 const stake=bets.reduce((s,x)=>s+x.stake,0),paid=bets.reduce((s,x)=>s+x.payout,0);
 const cats={zero:{races:0,payout:0},low:{races:0,payout:0},medium:{races:0,payout:0},high:{races:0,payout:0}};
 for(const x of bets){const k=bin(x.payout);cats[k].races++;cats[k].payout+=x.payout}
 const winners=bets.map((x,i)=>({...x,id:rows[i].id})).sort((a,b)=>b.payout-a.payout||a.id.localeCompare(b.id));
 const trim=n=>{
  const rest=winners.slice(n),s=rest.reduce((v,x)=>v+x.stake,0);
  return s?+(100*rest.reduce((v,x)=>v+x.payout,0)/s).toFixed(2):null;
 };
 return {
  races:rows.length,purchased:bets.filter(x=>x.points>0).length,
  tickets:bets.reduce((s,x)=>s+x.points,0),stake_yen:stake,payout_yen:paid,
  net_yen:paid-stake,roi_pct:stake?+(paid*100/stake).toFixed(2):null,
  trim1_pct:trim(1),trim5_pct:trim(5),hit_races:bets.filter(x=>x.payout>0).length,
  tail_bins:cats,
  high50plus_hit_races:cats.medium.races+cats.high.races,
  high50plus_paid_yen:cats.medium.payout+cats.high.payout,
  high50plus_share_of_payout_pct:paid?+(100*(cats.medium.payout+cats.high.payout)/paid).toFixed(1):null,
  high50plus_contribution_to_roi_pctpts:stake?+(100*(cats.medium.payout+cats.high.payout)/stake).toFixed(1):null,
  paid_roi_without_50plus_payout_pct:stake?+(100*cats.low.payout/stake).toFixed(1):null,
  medium_50to100_paid_share_pct:paid?+(100*cats.medium.payout/paid).toFixed(1):null,
  high100plus_paid_share_pct:paid?+(100*cats.high.payout/paid).toFixed(1):null
 };
}
function pack(rs,selected=['auto','baxis_3','b_upset_ad','b_upset_expanded','line','roi_coverage']){
 return{n:rs.length,engine:Object.fromEntries(selected.map(k=>[k,stat(rs,k)]))};
}
const sections={
 all_90:pack(records,engines),
 heldout_60:pack(records.filter(r=>r.day>=30),engines),
 finalday_losers:pack(records.filter(r=>r.stage==='敗者戦'&&r.meeting==='最終日')),
 nonfavorite:pack(records.filter(r=>r.pre.nonfavorite)),
 favorited:pack(records.filter(r=>!r.pre.nonfavorite)),
 agreement:pack(records.filter(r=>r.pre.agreement)),
 disagreement:pack(records.filter(r=>!r.pre.agreement)),
 car7:pack(records.filter(r=>r.cars===7)),
 car9:pack(records.filter(r=>r.cars===9)),
 by30:Object.fromEntries([0,1,2].map(i=>[i+1,pack(records.filter(r=>Math.floor(r.day/30)===i))]))
};
const filters={
 AUTO_ALL:{engine:'auto',fn:r=>true},
 BUPSET_ALL:{engine:'b_upset_ad',fn:r=>true},
 BAXIS3_ALL:{engine:'baxis_3',fn:r=>true},
 NONFAVORITE_AUTO:{engine:'auto',fn:r=>r.pre.nonfavorite},
 NONFAVORITE_BUPSET:{engine:'b_upset_ad',fn:r=>r.pre.nonfavorite},
 DISAGREE_AUTO:{engine:'auto',fn:r=>!r.pre.agreement},
 DISAGREE_BUPSET:{engine:'b_upset_ad',fn:r=>!r.pre.agreement},
 NONFAV_AND_DISAGREE_BUPSET:{engine:'b_upset_ad',fn:r=>r.pre.nonfavorite&&!r.pre.agreement},
 NONFAV_7_BUPSET:{engine:'b_upset_ad',fn:r=>r.pre.nonfavorite&&r.cars===7},
 NONFAV_9_BUPSET:{engine:'b_upset_ad',fn:r=>r.pre.nonfavorite&&r.cars===9},
 FINAL_LOSER_NONFAV_BUPSET:{engine:'b_upset_ad',fn:r=>r.pre.nonfavorite&&r.stage==='敗者戦'&&r.meeting==='最終日'},
 FINAL_LOSER_BUPSET:{engine:'b_upset_ad',fn:r=>r.stage==='敗者戦'&&r.meeting==='最終日'},
 NONFAV_BAXIS3:{engine:'baxis_3',fn:r=>r.pre.nonfavorite}
};
const heldout=records.filter(r=>r.day>=30);
function compare(rs){
 return{
  period2:{n:rs.filter(r=>r.day<60).length},
  period3:{n:rs.filter(r=>r.day>=60).length}
 };
}
const strategies={};
for(const [name,f] of Object.entries(filters)){
 const subset=heldout.filter(f.fn),p2=subset.filter(r=>r.day<60),p3=subset.filter(r=>r.day>=60);
 strategies[name]={model:f.engine,cover_pct:+(100*subset.length/heldout.length).toFixed(1),
  all:stat(subset,f.engine),period2:stat(p2,f.engine),period3:stat(p3,f.engine),
  is_pre_result_filter:true};
}
// Fixed-sample 5-day cluster bootstrap comparison of two engine ROI on exactly the same subset.
function pairedCI(rows,e1,e2,trials=5000){
 const groups=new Map();
 for(const r of rows){
  const index=Math.floor((r.day-30)/5);
  if(!groups.has(index))groups.set(index,[]);groups.get(index).push(r);
 }
 const blocks=[...groups.values()].map(x=>[e1,e2].flatMap(e=>{
  const t=stat(x,e);return[t.stake_yen,t.payout_yen]}));
 if(blocks.length<8)return null;
 let state=20261116;const rand=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296};
 const diff=[];
 for(let n=0;n<trials;n++){
  const sums=[0,0,0,0];
  for(let j=0;j<blocks.length;j++){const b=blocks[Math.floor(rand()*blocks.length)];for(let k=0;k<4;k++)sums[k]+=b[k]}
  if(sums[0]>0&&sums[2]>0)diff.push(100*sums[1]/sums[0]-100*sums[3]/sums[2]);
 }
 diff.sort((a,b)=>a-b);
 return{lo:+diff[Math.floor(diff.length*.025)].toFixed(1),
  hi:+diff[Math.floor(diff.length*.975)].toFixed(1),resamples:diff.length};
}
for(const key of ['NONFAVORITE_BUPSET','DISAGREE_BUPSET','FINAL_LOSER_BUPSET']){
 const f=filters[key],cases=heldout.filter(f.fn);
 strategies[key].paired_vs_auto_same_races=pairedCI(cases,f.engine,'auto');
}
const results={
 schema:'tk-keirin-retro-high-odds-attribution-and-contrarian/v1',
 generated_at:new Date().toISOString(),
 period:{from:'2026-08-18',to:'2026-11-15',total_races:5745,heldout_races:heldout.length},
 source:{pinned_daily_source:SHA,all90_days_SHA_verified:true,existing_eight_way_source_fixed:true,
   BAXIS_model:'LAB_B_AXIS_V0.6.0',raw_pre_race_odds_available:false},
 methodological_warning:'50x and 100x classifications use winning realized total payout per race, known only after settlement. They CANNOT be used as ex-ante ticket filters. Multiple dead-heat winning tickets in the same race may add payouts, so not an exact odds band for each combination.',
 payout_band_definitions:details,
 high_payout_attribution:sections,
 ex_ante_structure_hypotheses:{description:'The 13 policies are selected only using model projections (nonfavorite B-head, model agreement, cars, race stage), not winning payout amounts. Their historical profitability remains exploratory.',policies:strategies},
 all_policy_names:Object.keys(filters),
 adoption:'DO NOT PROMOTE, all derived after exploring this same 90-day history',
 caveats:[
  'Historic 2026-11 race forecasts were generated with a model developed after original races; no authentically contemporaneous prediction record.',
  'The source daily JSON may have been retrospectively updated: no original publication timestamp audit.',
  'No historical odds for losing trifecta tickets, so cannot simulate a tradable 50x-100x only policy or reliable expected value.',
  'Observed 50x payouts contribute to return after the fact; payout-dependent filtering would be outcome leakage.',
  'High payouts dominate tails, so small-sample ROI can be highly unstable.',
  'Comparisons of many experimental policies have strong multiple testing bias.',
  'No blending of earlier 661-race selectively reconstructed sample with full 5745 cohort.',
  'No main/Railway/notification/production bet changes.'
 ]};
fs.writeFileSync(path.join(ROOT,'high-odds-contrarian-attribution-20261116.json'),JSON.stringify(results,null,2)+'\n');
const pc=x=>x===null||x===undefined?'—':x.toFixed(1)+'%';
const jp=['# 競輪LAB：高配当を意図して狙う戦略の基礎検証',
 '',
 '2026-08-18〜11-15、5,745R。**実際の払戻が50倍以上だったレースを後知恵で購入対象として選ぶことはせず**、払い戻し寄与と事前構造の選択可能性を分けて検証。',
 '',
 '## 高配当的中がどれだけ回収率を支えているか（全90日）',
 '',
 '| エンジン | 総回収率 | 50〜100倍未満的中R | 100倍以上的中R | 50倍以上の払戻額 | 全払戻に占める割合 | 50倍以上を除いた払戻/全投資 |',
 '|---|---:|---:|---:|---:|---:|---:|'];
for(const k of engines){
 const s=sections.all_90.engine[k];
 jp.push('| '+k+' | '+pc(s.roi_pct)+' | '+s.tail_bins.medium.races+' | '+s.tail_bins.high.races+' | '+s.high50plus_paid_yen+'円 | '+pc(s.high50plus_share_of_payout_pct)+' | '+pc(s.paid_roi_without_50plus_payout_pct)+' |');
}
jp.push('','## 事前に判断できるシグナルで高配当捕捉を試験（後半60日）',
 '',
 '| 事前構造・方式 | 購入R | 回収率 | 最高5件除外 | 50倍以上的中R | 50倍以上払戻割合 | 第2期ROI | 第3期ROI |',
 '|---|---:|---:|---:|---:|---:|---:|---:|');
for(const [k,s] of Object.entries(strategies)){
 const a=s.all;
 jp.push('| '+k+' | '+a.races+' | '+pc(a.roi_pct)+' | '+pc(a.trim5_pct)+' | '+a.high50plus_hit_races+' | '+pc(a.high50plus_share_of_payout_pct)+' | '+pc(s.period2.roi_pct)+' | '+pc(s.period3.roi_pct)+' |');
}
jp.push('','## 重要な限界',
 '- 50〜100倍とは **的中した場合のレース単位合算払戻額が5,000〜9,999円** だったもの。通常は1通りの的中だが、同着時には複数の払戻を合算し得る。',
 '- **的中後に判明した払戻額では発走前の購入判断を行えない。** 過去の非的中全買い目について当時のオッズが必要。',
 '- 7車210通り／9車504通りの各組合せで「確率 × 発走前オッズ」を見積もる戦略は、現資料では再現不能。',
 '- 偶然の高配当を目標にした戦略は、点数固定拡大でなく予想1着シナリオとEV選別を独立に検証する。',
 '- 今回の条件は以前探索された同じ期間の後知恵を含む研究上の仮説であり、新たな将来期間で再検証が必要。',
 '- main / Railway / 本番予測 / 自動通知は変更しない。');
fs.writeFileSync(path.join(ROOT,'high-odds-contrarian-attribution-20261116-ja.md'),jp.join('\n')+'\n');
console.log('HIGH_ODDS_CONTRARIAN_AUDIT',JSON.stringify({
 n:records.length,
 attribution:Object.fromEntries(['auto','baxis_3','b_upset_ad','line'].map(k=>[k,{
  roi:sections.all_90.engine[k].roi_pct,
  high50_n:sections.all_90.engine[k].high50plus_hit_races,
  high50_share:sections.all_90.engine[k].high50plus_share_of_payout_pct
 }])),
 scenarios:Object.fromEntries(Object.entries(strategies).map(([k,v])=>[k,{
 n:v.all.races,roi:v.all.roi_pct,trim5:v.all.trim5_pct,high50:v.all.high50plus_hit_races,
 p2:v.period2.roi_pct,p3:v.period3.roi_pct
 }]))
}).slice(0,13000));
