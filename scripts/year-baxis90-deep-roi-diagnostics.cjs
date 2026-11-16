#!/usr/bin/env node
'use strict';
/**
 * Research only: why does retrospective ROI stay <100%?
 * Fixed 5745 historical races, original eight-engine audit + 18 pinned BAXIS shards.
 * Outcome is never a feature; quintiles/gates are trained on PRECEDING 30 DAYS.
 * Prior research already explored these dates: diagnostic, not untouched OOS proof.
 */
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../reports/year-race-type'),SHA='4588ec938a2fec9e81216d3fd3423329805aa3d5';
const base=JSON.parse(fs.readFileSync(path.join(ROOT,'complete90-eight-engine-audit.json'),'utf8'));
const previous=JSON.parse(fs.readFileSync(path.join(ROOT,'baxis90-roi-gates-walkforward-20261116.json'),'utf8'));
if(base.races.length!==5745||base.source.pinned_commit!==SHA||previous.heldout_n!==3748||previous.rules_count!==15)
 throw Error('Audit baseline changed');
const original=new Map(base.races.map(x=>[x.race_id,x])),found=new Set(),rows=[],digests=new Set();
const corrected=new Map([['2026-08-22:松戸:3|lab_v5',180],['2026-08-22:松戸:3|line',180],
 ['2026-08-22:松戸:3|roi_coverage',180],['2026-08-26:玉野:6|b_upset_ad',1590]]);
for(let i=0;i<18;i++){
 const f=JSON.parse(fs.readFileSync(path.join(ROOT,'baxis90-shards','part-'+i+'.json'),'utf8'));
 if(f.schema!=='tk-keirin-90day-baxis-v06-shard/v1'||f.shard!==i||f.expected!==f.completed||f.incomplete!==0||f.source_commit!==SHA||f.model!=='LAB_B_AXIS_V0.6.0')throw Error('Shard integrity '+i);
 for(const [date,h] of Object.entries(f.source_day_sha256)){
  if(digests.has(date)||base.source.day_sha256[date]!==h)throw Error('Source SHA/double-day '+date);
  digests.add(date);
 }
 for(const x of f.rows){
  const b=original.get(x.id);
  if(!b||found.has(x.id)||b.date!==x.date||b.cars!==x.cars||b.category!==x.category||b.meeting_day!==x.meeting_day||b.stage!==x.stage)throw Error('ID/field mismatch '+x.id);
  found.add(x.id);
  const s={...x.settlement};
  for(const name of ['auto','physical','causal','lab_v5','line','roi_coverage','b_upset_ad','b_upset_expanded']){
   const p=b.predictions[name];
   s[name]={stake:p.stake,payout:p.payout+(corrected.get(x.id+'|'+name)||0),points:p.points};
  }
  for(const [name,p] of Object.entries(s))if(p.stake!==p.points*100||p.stake<0||p.payout<0)throw Error('Invalid bet '+name+' '+x.id);
  const d=Math.round((Date.parse(x.date+'T00:00:00Z')-Date.parse('2026-08-18T00:00:00Z'))/86400000);
  if(!Number.isInteger(d)||d<0||d>=90||!Number.isFinite(x.b_axis_margin))throw Error('Invalid day/margin');
  for(const [a,c] of [['baxis_3','baxis_5'],['baxis_5','baxis_10']])
   if(s[c].stake<s[a].stake||s[c].payout<s[a].payout)throw Error('B axis ticket selection not nested '+x.id);
  s.baxis_4_5={stake:s.baxis_5.stake-s.baxis_3.stake,payout:s.baxis_5.payout-s.baxis_3.payout,points:s.baxis_5.points-s.baxis_3.points};
  s.baxis_6_10={stake:s.baxis_10.stake-s.baxis_5.stake,payout:s.baxis_10.payout-s.baxis_5.payout,points:s.baxis_10.points-s.baxis_5.points};
  rows.push({id:x.id,date:x.date,day:d,period:Math.floor(d/30)+1,cars:x.cars,
   grade:x.category,meeting:x.meeting_day,stage:x.stage,agreement:x.agreement,nonfavorite:x.proxy_nonfavorite,
   margin:x.b_axis_margin,head_win:x.projected_first_head_wins,head_line_win:x.projected_first_line_wins,
   bets:s});
 }
}
if(digests.size!==90||rows.length!==5745||found.size!==5745)throw Error('Incomplete 90day cohort');
rows.sort((a,b)=>a.day-b.day||a.id.localeCompare(b.id));
const initial=rows.filter(r=>r.day<30),test=rows.filter(r=>r.day>=30);
if(test.length!==3748||initial.length!==1997)throw Error('Unexpected split');
function agg(rs,key){
 const arr=rs.map(x=>x.bets?x.bets[key]:x.bet),invest=arr.reduce((s,x)=>s+x.stake,0),pay=arr.reduce((s,x)=>s+x.payout,0);
 const paid=arr.map((b,i)=>({payout:b.payout,stake:b.stake,id:rs[i].id})).sort((a,b)=>b.payout-a.payout||a.id.localeCompare(b.id));
 const cut=k=>{const rest=paid.slice(k),s=rest.reduce((v,x)=>v+x.stake,0);return s?+(100*rest.reduce((v,x)=>v+x.payout,0)/s).toFixed(2):null};
 return{
  races:rs.length,invest_yen:invest,paid_yen:pay,net_yen:pay-invest,
  win_count:arr.filter(x=>x.payout>0).length,
  stake_ticket_count:arr.reduce((s,x)=>s+(x.points??x.stake/100),0),
  roi_pct:invest?+(100*pay/invest).toFixed(2):null,
  trim1_pct:cut(1),trim5_pct:cut(5),trim10_pct:cut(10),
  top1_yen:paid[0]?.payout||0,
  top5_paid_share_pct:pay?+(100*paid.slice(0,5).reduce((v,x)=>v+x.payout,0)/pay).toFixed(1):null,
  over50x_wins:arr.filter(x=>x.payout>=5000).length,
  payout50_to100x_count:arr.filter(x=>x.payout>=5000&&x.payout<10000).length,
  payout100xplus_count:arr.filter(x=>x.payout>=10000).length
 };
}
function grouper(xs,fn){const m=new Map();for(const x of xs){const k=fn(x);if(!m.has(k))m.set(k,[]);m.get(k).push(x)}return m}
function scoreByPeriod(xs,engine){return Object.fromEntries([1,2,3].map(n=>[n,agg(xs.filter(x=>x.period===n),engine)]))}
const engines=['auto','baxis_3','baxis_4_5','baxis_6_10','baxis_5','baxis_10','physical','line','roi_coverage','b_upset_ad'];
const decomp={
 full90:Object.fromEntries(engines.map(k=>[k,agg(rows,k)])),
 future60:Object.fromEntries(engines.map(k=>[k,agg(test,k)])),
 by_period:Object.fromEntries(engines.map(k=>[k,scoreByPeriod(rows,k)])),
 by_car_count:Object.fromEntries([7,9].map(n=>[n,Object.fromEntries(engines.map(k=>[k,agg(rows.filter(x=>x.cars===n),k)]))]))
};
const normalizeRounded=rs=>rs.reduce((x,r)=>x+(r.bets.auto.payout-r.bets.auto.stake),0);
const blocks=[];
for(let d=30;d<90;d+=5){
 const rs=test.filter(r=>r.day>=d&&r.day<d+5);
 blocks.push({period:[rs[0].date,rs.at(-1).date],races:rs.length,
  auto:agg(rs,'auto'),b3:agg(rs,'baxis_3'),
  nonfav_auto:agg(rs.filter(x=>x.nonfavorite),'auto'),
  agrees_auto:agg(rs.filter(x=>x.agreement),'auto')});
}
const fiveDay={
 total:blocks.length,
 auto_positive_count:blocks.filter(x=>x.auto.roi_pct>=100).length,
 baxis3_positive_count:blocks.filter(x=>x.b3.roi_pct>=100).length,
 blocks
};
const pctile=(v,q)=>v.slice().sort((a,b)=>a-b)[Math.floor((v.length-1)*q)];
const marginBins=Array.from({length:5},(_,i)=>[]);
const matching=[];
for(let d=30;d<90;d+=5){
 const train=rows.filter(r=>r.day>=d-30&&r.day<d),hold=test.filter(r=>r.day>=d&&r.day<d+5);
 const cut=[.2,.4,.6,.8].map(q=>pctile(train.map(r=>r.margin),q));
 for(const r of hold){
  const bin=1+cut.filter(t=>r.margin>t).length;
  marginBins[bin-1].push(r);
  matching.push({id:r.id,day:r.day,bin});
 }
}
const marginQuantiles=Object.fromEntries(marginBins.map((group,i)=>[
 'Q'+(i+1),{
  n:group.length,
  b3:agg(group,'baxis_3'),auto:agg(group,'auto'),
  agreement_pct:+(100*group.filter(x=>x.agreement).length/group.length).toFixed(1),
  b_head_wins_pct:+(100*group.filter(x=>x.head_win).length/group.length).toFixed(1),
  // Head wins are race finish outcomes; NOT observed-B accuracy.
  each30day:Object.fromEntries([2,3].map(p=>[p,{n:group.filter(x=>x.period===p).length,
   b3:agg(group.filter(x=>x.period===p),'baxis_3').roi_pct,
   auto:agg(group.filter(x=>x.period===p),'auto').roi_pct}]))
 }
]));
// Rebuild the previously validated meeting-day gate using ONLY prior30d auto results.
// Selected = same 874 races, exact return, not cherry-picked after current race.
const selected=[],rejected=[];
for(let d=30;d<90;d+=5){
 const train=rows.filter(r=>r.day>=d-30&&r.day<d),apply=rows.filter(r=>r.day>=d&&r.day<d+5);
 const groups=grouper(train,x=>x.meeting);
 const qualification=new Set([...groups].filter(([kind,g])=>g.length>=50&&(()=>{
  const rank=g.map(r=>r.bets.auto).sort((a,b)=>b.payout-a.payout).slice(1);
  const s=rank.reduce((sum,x)=>sum+x.stake,0);
  return s&&rank.reduce((sum,x)=>sum+x.payout,0)/s>=.80
 })()).map(([kind])=>kind));
 for(const r of apply)(qualification.has(r.meeting)?selected:rejected).push(r);
}
const meetingGate={selected:agg(selected,'auto'),rejected:agg(rejected,'auto'),
 composition:Object.fromEntries([...grouper(selected,x=>x.meeting)].map(([k,g])=>[k,agg(g,'auto')])),
 in30day:Object.fromEntries([2,3].map(p=>[p,agg(selected.filter(x=>x.period===p),'auto')]))};
if(selected.length!==874||rejected.length!==2874||meetingGate.selected.roi_pct!==98.82)
 throw Error('Prior verified meeting-gate cohort shifted');
if(Math.abs(decomp.future60.auto.roi_pct-previous.baseline.all.roi_pct)>.01)throw Error('Baseline 60day ROI diverged');
const diagnostics={
 schema:'tk-keirin-90day-deep-roi-diagnostics-v1',created_at:new Date().toISOString(),
 source:'original SHA-verified 5745 race cohort + 18 B-AXIS v0.6 five-day shards',
 validation:{expected90:5745,expected60:3748,source_days:90,
  matching_previous_gate_n:874,matching_previous_gate_roi_pct:98.82,
  no_same_race_outcome_as_feature:true},
 decomposition:decomp, five_day_outcomes:fiveDay,
 baxis_margin_prior30_quintiles:marginQuantiles,
 meeting_gate_decomposition:meetingGate,
 interpretation:[
  'This identifies realized payoff, tail dependence, ticket ranks and selection exposure, NOT prospective positive EV.',
  'Quantile boundaries use the preceding 30 days of B-margin only, not test outcomes, but the margin model was developed later.',
  'Predicted B head winning is a finish outcome, not observed actual B at the back.',
  'Absolute loss reduction by skipping negative-return races is not a demonstration of positive expected value.',
  'Top payout removals are descriptive tail stress tests, not unbiased performance estimates.',
  'Original source timing and historical odds snapshots not independently established; no measured pre-start EV.',
  'Long-tail dependence + same 90 days model design/research => no automatic deployment.'
 ]};
fs.writeFileSync(path.join(ROOT,'baxis90-deep-roi-diagnostics-20261116.json'),JSON.stringify(diagnostics,null,2)+'\n');
const fmt=n=>n===null?'—':n.toFixed(1)+'%';
const md=['# 競輪LAB：回収率を改善できない理由を分解する追加監査',
 '',
 '90日5,745R・B-AXIS v0.6・既存AUTO等の同一レース比較。後半60日の評価は3,748R。',
 '過去の事後再生成であり、発走前に凍結された当時の予測ではない。',
 '',
 '## 予想上位点の追加投資効率',
 '',
 '| 対象 | 上位1〜3点 | 追加4〜5点だけ | 追加6〜10点だけ | AUTO |',
 '|---|---:|---:|---:|---:|',
 '| 90日全件 | '+fmt(decomp.full90.baxis_3.roi_pct)+' | '+fmt(decomp.full90.baxis_4_5.roi_pct)+' | '+fmt(decomp.full90.baxis_6_10.roi_pct)+' | '+fmt(decomp.full90.auto.roi_pct)+' |',
 '| 最終60日 | '+fmt(decomp.future60.baxis_3.roi_pct)+' | '+fmt(decomp.future60.baxis_4_5.roi_pct)+' | '+fmt(decomp.future60.baxis_6_10.roi_pct)+' | '+fmt(decomp.future60.auto.roi_pct)+' |',
 '',
 '## 高額的中依存',
 '',
 '| 対象 | 回収率 | 最大1件除外 | 最大5件除外 | 最大10件除外 | 払戻上位5件の構成比 |',
 '|---|---:|---:|---:|---:|---:|'];
for(const [scope,cohort] of [['全90日',decomp.full90],['後半60日',decomp.future60]]){
 for(const k of ['auto','baxis_3','baxis_5']){
  const x=cohort[k];md.push('| '+scope+' '+k+' | '+fmt(x.roi_pct)+' | '+fmt(x.trim1_pct)+' | '+fmt(x.trim5_pct)+' | '+fmt(x.trim10_pct)+' | '+fmt(x.top5_paid_share_pct)+' |');
 }
}
md.push('','## 5日単位の損益・再現性',
 '','後半60日の12ブロックのうち、AUTOが回収率100%以上だったのは**'+fiveDay.auto_positive_count+'ブロック**、B-AXIS上位3点では**'+fiveDay.baxis3_positive_count+'ブロック**。',
 '','## B-AXIS支持差の5階級（前30日分布だけで階級を決める）',
 '','| 支持差階級 | R | B3回収率 | B3高額5件除外 | AUTO回収率 | B候補先頭1着率 | 第2期B3 | 第3期B3 |',
 '|---|---:|---:|---:|---:|---:|---:|---:|'];
for(const [bin,v] of Object.entries(marginQuantiles)){
 md.push('| '+bin+' | '+v.n+' | '+fmt(v.b3.roi_pct)+' | '+fmt(v.b3.trim5_pct)+' | '+fmt(v.auto.roi_pct)+' | '+fmt(v.b_head_wins_pct)+' | '+fmt(v.each30day[2].b3)+' | '+fmt(v.each30day[3].b3)+' |');
}
md.push('','※「B候補先頭1着」はゴール結果との対応であり、最終バックのB実測一致ではない。',
 '','## 開催日程ゲートの損失と見送りを分ける',
 '',
 '| グループ | R | 投資円 | 払戻円 | 損益円 | 回収率 | 高額5件除外 |',
 '|---|---:|---:|---:|---:|---:|---:|',
 ...[['購入',meetingGate.selected],['見送り',meetingGate.rejected]].map(([k,x])=>'| '+k+' | '+x.races+' | '+x.invest_yen+' | '+x.paid_yen+' | '+x.net_yen+' | '+fmt(x.roi_pct)+' | '+fmt(x.trim5_pct)+' |'),
 '','見送りの回収率が低いことは過去選別の記述であり、次の期間にも成立するという意味ではない。',
 '','## 次の研究に関する判定',
 '- 単純な上位点の追加は買い目費用を増やす。追加4〜5点・6〜10点の独立回収率を必ず確認。',
 '- Bの支持差が高いことと期待値が高いことを同一視しない。予測確率を校正し、発走前オッズと同時保存する必要がある。',
 '- 高額1/5/10件除外後も100%を超えない限り、本番で自動選択しない。',
 '- 過去90日で探索した多数のルールにはデータ再利用バイアスがある。新たな将来期間を固定して検証する。',
 '- 研究ブランチのみ更新し、本番main/Railwayはそのまま。',
 '',
 '機械可読の全額・90日間・級班/車数の内訳は同名JSON参照。');
fs.writeFileSync(path.join(ROOT,'baxis90-deep-roi-diagnostics-20261116-ja.md'),md.join('\n')+'\n');
console.log('DEEP_DIAGNOSTICS_OK',JSON.stringify({n:rows.length,
 top3:decomp.full90.baxis_3.roi_pct,extra45:decomp.full90.baxis_4_5.roi_pct,extra610:decomp.full90.baxis_6_10.roi_pct,
 block_successes:fiveDay.auto_positive_count,margin: Object.fromEntries(Object.entries(marginQuantiles).map(([k,x])=>[k,{n:x.n,b3:x.b3.roi_pct,auto:x.auto.roi_pct}])),
 meeting:{selected:meetingGate.selected,rejected:meetingGate.rejected}}).slice(0,12500));
