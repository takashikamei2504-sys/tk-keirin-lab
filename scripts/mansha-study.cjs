#!/usr/bin/env node
'use strict';
/**
 * READ ONLY retrospective study: Keirin trifecta payouts >= JPY 10,000 per JPY 100.
 * Only start-list information is used as predictors; result fields are labels.
 * Dates absent in the upstream archive are reported, never silently filled.
 */
const fs = require('node:fs/promises');
const { setTimeout: pause } = require('node:timers/promises');
const START = process.env.MANSHA_START || '2026-05-08';
const END = process.env.MANSHA_END || '2026-11-07';
const BASE = 'https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/';
const HOLDOUT = '2026-09-01';
const dateList=(a,b)=>{
  const res=[];
  for(let ms=Date.parse(a+'T00:00:00Z');ms<=Date.parse(b+'T00:00:00Z');ms+=86400000)res.push(new Date(ms).toISOString().slice(0,10));
  return res;
};
const lineOf = r => String(r.line_position).split('-')[0];
const rankOK = s => /^(S[12]|A[123])$/.test(String(s||''));
function parseRace(r,date,excluded) {
  const es=r.entries||[];
  if(![7,9].includes(es.length)) {excluded.size++;return null}
  if(!es.every(e=>rankOK(e.class_rank))) {excluded.girls_or_unclassified++;return null}
  const payout=Number(r.payout_trifecta),finish=r.result_top3||[];
  const cars=es.map(e=>Number(e.car_number));
  if(!(payout>0)||finish.length!==3||finish.some(n=>!cars.includes(Number(n)))||new Set(finish.map(Number)).size!==3) {excluded.pending_or_invalid_result++;return null}
  if((r.result_combos||[]).length>1) {excluded.multiple_results++;return null}
  const score=es.map(e=>Number(e.competition_score));
  if(!es.every(e=>/^\d+-\d+$/.test(String(e.line_position||'')))||
    !score.every(x=>Number.isFinite(x)&&x>50&&x<145)) {excluded.invalid_prelude++;return null}
  const lines={};for(const e of es)(lines[lineOf(e)]??=[]).push(e);
  const groups=Object.values(lines);
  const sorted=es.slice().sort((a,b)=>Number(b.competition_score)-Number(a.competition_score));
  const leaders=es.filter(e=>e.running_style==='逃');
  const winner=es.find(e=>Number(e.car_number)===Number(finish[0]));
  const runnerup=es.find(e=>Number(e.car_number)===Number(finish[1]));
  const groupAvg=groups.map(g=>g.reduce((z,e)=>z+Number(e.competition_score),0)/g.length).sort((a,b)=>b-a);
  const cat=es.some(e=>e.class_rank.startsWith('S'))?'S':es.every(e=>e.class_rank==='A3')?'C':'A';
  const top=sorted[0],second=sorted[1],min=sorted.at(-1);
  return {
    date,venue:r.venue,race_number:r.race_number,cat:cat+es.length,
    grade:r.grade||'',round:r.round_name||'',payout,
    high:Number(payout>=10000), mid:Number(payout>=5000&&payout<10000), extreme:Number(payout>=30000),
    n:es.length,lineCount:groups.length,solo:groups.filter(g=>g.length===1).length,
    maxLine:Math.max(...groups.map(g=>g.length)),leaderCount:leaders.length,
    leaderLines:new Set(leaders.map(lineOf)).size,
    gap:Number(top.competition_score)-Number(second.competition_score),
    range:Number(top.competition_score)-Number(min.competition_score),
    lineGap:groupAvg[0]-groupAvg[1],
    top2Diff:Number(lineOf(top)!==lineOf(second)),
    top1Solo:Number(lines[lineOf(top)].length===1),
    top1Front:Number(String(top.line_position).endsWith('-1')),
    top1Escape:Number(top.running_style==='逃'),
    // POST-race diagnostic ONLY: NEVER use in a prospective predictor.
    winnerCross:Number(lineOf(winner)!==lineOf(runnerup)),
    winnerTop:Number(Number(winner.car_number)===Number(top.car_number)),
    finishAllOneLine:Number(finish.every(no=>lineOf(es.find(e=>Number(e.car_number)===Number(no)))===lineOf(winner)))
  };
}
async function fetchDay(date) {
  for(let retry=0;retry<3;retry++){
    try{
      const r=await fetch(BASE+date+'.json',{signal:AbortSignal.timeout(15000),headers:{'user-agent':'TK-KEIRIN-LAB-analysis'}});
      if(r.status===404)return {date,missing:true};
      if(r.status===429||r.status>=500){await pause(1200*(retry+1));continue}
      if(!r.ok)return {date,error:'HTTP '+r.status};
      const json=await r.json();
      if(!Array.isArray(json.races))return {date,error:'Missing races array'};
      return {date,data:json.races};
    }catch(err){
      if(retry===2)return {date,error:String(err).slice(0,180)};
      await pause(1200*(retry+1));
    }
  }
  return {date,error:'Retry exhausted'};
}
function counts(records){
  return {races:records.length,high:records.reduce((n,r)=>n+r.high,0),
    highRate:records.length?records.reduce((n,r)=>n+r.high,0)/records.length:null,
    mid:records.reduce((n,r)=>n+r.mid,0),extreme:records.reduce((n,r)=>n+r.extreme,0)};
}
function by(records,selector) {
  const groups={};
  for(const r of records)(groups[selector(r)]??=[]).push(r);
  return Object.fromEntries(Object.entries(groups).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,counts(v)]));
}
const FEATURES=[
 ['escape3','逃げ型3人以上',r=>r.leaderCount>=3],
 ['escape3lines','逃げ型が3ライン以上',r=>r.leaderLines>=3],
 ['escape2lines','逃げ型が2ライン以上',r=>r.leaderLines>=2],
 ['escape1','逃げ型1人',r=>r.leaderCount===1],
 ['escape0','逃げ型なし',r=>r.leaderCount===0],
 ['fourlines','4分戦以上',r=>r.lineCount>=4],
 ['solo1','単騎あり',r=>r.solo>=1],
 ['solo2','単騎2人以上',r=>r.solo>=2],
 ['longline','3車以上のラインあり',r=>r.maxLine>=3],
 ['smallgap','競走得点1位と2位の差2点未満',r=>r.gap<2],
 ['largegap','競走得点1位と2位の差5点以上',r=>r.gap>=5],
 ['smallrange','最高最低の得点差8点未満',r=>r.range<8],
 ['largerange','最高最低の得点差12点以上',r=>r.range>=12],
 ['linegap2','ライン平均得点の上位差2点未満',r=>r.lineGap<2],
 ['top2diff','得点上位2人が別ライン',r=>r.top2Diff===1],
 ['top1solo','得点1位が単騎',r=>r.top1Solo===1],
 ['top1front','得点1位がライン先頭',r=>r.top1Front===1],
 ['top1escape','得点1位が逃げ型',r=>r.top1Escape===1],
 ['escape3smallgap','逃げ型3人以上かつ上位得点差2点未満',r=>r.leaderCount>=3&&r.gap<2],
 ['escape3top2diff','逃げ型3人以上かつ得点上位2人別ライン',r=>r.leaderCount>=3&&r.top2Diff===1],
 ['escape3fourlines','逃げ型3人以上かつ4分戦以上',r=>r.leaderCount>=3&&r.lineCount>=4],
 ['escape2smallgap','2ライン以上に逃げ型かつ得点上位差2点未満',r=>r.leaderLines>=2&&r.gap<2],
 ['fourlinessmallgap','4分戦以上かつ得点上位差2点未満',r=>r.lineCount>=4&&r.gap<2],
 ['g3plus','G3以上',r=>/^G/.test(r.grade)],
 ['final','決勝',r=>r.round.includes('決勝')],
 ['semi','準決勝',r=>r.round.includes('準決')]
];
function featureStats(records, predicate){
  const yes=records.filter(predicate),no=records.filter(r=>!predicate(r));
  const b=counts(records),a=counts(yes),other=counts(no);
  const catBaseline=Object.fromEntries(Object.entries(by(records,r=>r.cat)).map(([k,v])=>[k,v.highRate]));
  const expected=yes.reduce((n,r)=>n+(catBaseline[r.cat]||0),0);
  return {n:a.races,high:a.high,rate:a.highRate,
    restRate:other.highRate,ratio:a.highRate&&other.highRate?a.highRate/other.highRate:null,
    lift:b.highRate?a.highRate/b.highRate:null,categoryAdjustedLift:expected?a.high/expected:null,
    mid:a.mid};
}
async function main(){
  const dates=dateList(START,END),days=[];
  let index=0;
  async function worker(){while(index<dates.length){const date=dates[index++];days.push(await fetchDay(date))}}
  await Promise.all(Array.from({length:8},worker));
  days.sort((a,b)=>a.date.localeCompare(b.date));
  const missing=days.filter(d=>d.missing).map(d=>d.date);
  const errors=days.filter(d=>d.error).map(d=>({date:d.date,error:d.error}));
  const excluded={size:0,girls_or_unclassified:0,pending_or_invalid_result:0,multiple_results:0,invalid_prelude:0};
  const records=[];for(const day of days){for(const r of day.data||[]){const row=parseRace(r,day.date,excluded);if(row)records.push(row)}}
  const ids=new Set(),dupes=[];for(const r of records){const id=r.date+'/'+r.venue+'/'+r.race_number;if(ids.has(id))dupes.push(id);ids.add(id)}
  const train=records.filter(r=>r.date<HOLDOUT),test=records.filter(r=>r.date>=HOLDOUT);
  const stats={
    requested:{start:START,end:END,days:dates.length},
    available_days:days.filter(d=>d.data).length,missing_days:missing,fetch_errors:errors,
    excluded,duplicate_races:dupes,overall:counts(records),train:counts(train),holdout:counts(test),
    months:by(records,r=>r.date.slice(0,7)),category:by(records,r=>r.cat),
    category_train:by(train,r=>r.cat),category_holdout:by(test,r=>r.cat),
    line_count:by(records,r=>String(r.lineCount)),escape_count:by(records,r=>String(r.leaderCount)),
    grade:by(records,r=>r.grade),position_diagnostics:{
      winner_crossline_high:counts(records.filter(r=>r.high&&r.winnerCross)),
      winner_crossline_low:counts(records.filter(r=>!r.high&&r.winnerCross)),
      all_high:counts(records.filter(r=>r.high)),
      winner_top_high:counts(records.filter(r=>r.high&&r.winnerTop)),
      winner_top_low:counts(records.filter(r=>!r.high&&r.winnerTop)),
      winner_same_three_high:counts(records.filter(r=>r.high&&r.finishAllOneLine))
    },
    features:FEATURES.map(([key,label,p])=>({key,label,train:featureStats(train,p),holdout:featureStats(test,p),overall:featureStats(records,p),
      by_category:Object.fromEntries(['A7','C7','S7','S9'].map(cat=>[cat,featureStats(records.filter(r=>r.cat===cat),p)]))}))
  };
  await fs.mkdir('reports/mansha',{recursive:true});
  await fs.writeFile('reports/mansha/study-20261107.json',JSON.stringify(stats,null,2)+'\n');
  console.log('STUDY_META='+JSON.stringify({requested:stats.requested,available_days:stats.available_days,missing_n:missing.length,errors:errors.length,excluded,overall:stats.overall,train:stats.train,holdout:stats.holdout,months:stats.months,category:stats.category,position_diagnostics:stats.position_diagnostics}));
  console.log('STUDY_FEATURES='+JSON.stringify(stats.features.map(x=>({key:x.key,label:x.label,train:x.train,holdout:x.holdout,overall:x.overall}))));
  const lines=['# 万車特徴量検証','', '- 対象：'+START+'〜'+END,'- 日別データ取得：'+stats.available_days+' / '+dates.length+'日','- 対象男子レース：'+stats.overall.races+'R','- 万車（100円払戻10,000円以上）：'+stats.overall.high+'R ('+(100*stats.overall.highRate).toFixed(1)+'%)','','## 前半発見・後半検証','', '| 特徴量 | 前半N | 前半万車率 | 後半N | 後半万車率 | 後半カテゴリ調整リフト |','|---|---:|---:|---:|---:|---:|'];
  for(const f of stats.features){const pct=x=>x==null?'-':(100*x).toFixed(1)+'%';lines.push('|'+f.label+'|'+f.train.n+'|'+pct(f.train.rate)+'|'+f.holdout.n+'|'+pct(f.holdout.rate)+'|'+(f.holdout.categoryAdjustedLift?.toFixed(2)??'-')+'|')}
  const summary=lines.join('\n')+'\n';await fs.writeFile('reports/mansha/study-20261107.md',summary);
  if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
  if(errors.length>0)process.exitCode=2;
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={parseRace,featureStats,FEATURES,fetchDay,dateList};
