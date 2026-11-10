#!/usr/bin/env node
'use strict';
/* Strict out-of-time backtest: all candidate tickets are computed from race-card fields only.
 * Actual finishes/payouts are used only after tickets are fixed.
 * Train: June-Aug, diagnostic validation: Sep, untouched test: Oct-Nov 2026.
 * No production models/tickets are changed.
 */
const fs=require('node:fs/promises');
const archive=require('./mansha-study.cjs');
const risk=require('../js/mansha/risk.js');
require('../js/mansha/model.js');
const riskModel=globalThis.ManshaRiskModel;
const START='2026-05-08',END='2026-11-07';
const TRAIN_END='2026-09-01',TEST_BEGIN='2026-10-01',CATS=['A7','C7','S7','S9'];
const sum=(x,f)=>x.reduce((a,y)=>a+f(y),0);
const avg=x=>x.length?sum(x,y=>y)/x.length:null;
const line=x=>String(x.line_position).split('-')[0];
const position=x=>+String(x.line_position).split('-')[1];
function createCard(raw,date,excluded) {
 const parsed=archive.parseRace(raw,date,excluded);
 if(!parsed||!CATS.includes(parsed.cat))return null;
 const e=raw.entries.map(x=>({
   no:+x.car_number,score:+x.competition_score,style:x.running_style,
   line:line(x),role:position(x),rank:x.class_rank
 }));
 const len={};for(const x of e)len[x.line]=(len[x.line]||0)+1;
 for(const x of e)x.lineSize=len[x.line];
 const sorted=e.slice().sort((a,b)=>b.score-a.score||a.no-b.no);
 const ranks=new Map(sorted.map((x,i)=>[x.no,i]));
 const m=avg(e.map(x=>x.score));
 const sd=Math.sqrt(avg(e.map(x=>(x.score-m)**2)));
 for(const x of e){
   x.rankIndex=ranks.get(x.no);
   x.scoreZ=Math.max(-3,Math.min(3,(x.score-m)/Math.max(sd,3)));
 }
 const finish=raw.result_top3.map(Number);
 if(new Set(e.map(x=>x.no)).size!==e.length||new Set(finish).size!==3)return null;
 const byNo=new Map(e.map(x=>[x.no,x]));
 const cross=byNo.get(finish[0]).line!==byNo.get(finish[1]).line;
 const rScore=risk.score(parsed,riskModel);
 return {date,venue:raw.venue,raceNo:raw.race_number,cat:parsed.cat,n:e.length,
  e,byNo,finish,cross,high:parsed.high,payout:parsed.payout,band:parsed.payout>=30000?'300+':parsed.payout>=10000?'100-300':parsed.payout>=5000?'50-100':'under50',
  risk:rScore.probability,riskPriority:rScore.priority,leaderCount:parsed.leaderCount};
}
function riderCols(x,card,first=null,second=null) {
 const maxRank=card.n-1;
 const col=[x.scoreZ,(maxRank-x.rankIndex)/maxRank,
  +(x.role===1),+(x.role===2),+(x.role>=3),
  +(x.lineSize===1),+(x.lineSize>=3),
  +(x.style==='逃'),+(x.style==='追'),
  +(x.line===first?.line),+(x.line===second?.line),
  +(first&&second&&x.line!==first.line&&x.line!==second.line)];
 return col;
}
const dot=(x,w)=>x.reduce((s,a,i)=>s+a*w[i],0);
const softmax=z=>{
 const m=Math.max(...z),e=z.map(v=>Math.exp(v-m)),t=e.reduce((a,b)=>a+b,0);return e.map(x=>x/t);
};
function probabilityVector(card,w,exclude=[],first=null,second=null){
 const valid=card.e.filter(x=>!exclude.includes(x.no));
 const z=valid.map(x=>dot(riderCols(x,card,first,second),w));
 return valid.map((x,i)=>({...x,p:softmax(z)[i]}));
}
function fit(cards,index,filter,epochs=120) {
 const rows=cards.filter(filter).map(c=>{
   const first=c.byNo.get(c.finish[0]),second=c.byNo.get(c.finish[1]);
   const excluded=index===2?[first.no,second.no]:[];
   const eligible=c.e.filter(x=>!excluded.includes(x.no));
   return {cols:eligible.map(x=>riderCols(x,c,index===2?first:null,index===2?second:null)),
      selected:eligible.findIndex(x=>x.no===c.finish[index])};
 });
 if(rows.length<200)throw Error('Insufficient training races for slot '+index+': '+rows.length);
 const width=12,w=Array(width).fill(0);
 for(let ep=0;ep<epochs;ep++){
   const grad=Array(width).fill(0);
   for(const row of rows){
     const p=softmax(row.cols.map(x=>dot(x,w)));
     for(let j=0;j<row.cols.length;j++){
       const error=p[j]-(j===row.selected?1:0);
       for(let k=0;k<width;k++)grad[k]+=error*row.cols[j][k];
     }
   }
   const rate=.26/(1+.018*ep);
   for(let k=0;k<width;k++)w[k]-=rate*(grad[k]/rows.length+.012*w[k]);
 }
 return {weights:w,trained:rows.length};
}
function orderedPairs(card,mode,models) {
 const available=card.e;
 const winners=mode==='score'?null:probabilityVector(card,models[mode].winner.weights);
 const seconds=mode==='score'?null:probabilityVector(card,models[mode].second.weights);
 const firstp=winners&&new Map(winners.map(x=>[x.no,x.p]));
 const secondp=seconds&&new Map(seconds.map(x=>[x.no,x.p]));
 const pairs=[];
 for(const a of available)for(const b of available) {
   if(a.no===b.no||a.line===b.line)continue;
   let s=mode==='score'?(a.scoreZ*.6+b.scoreZ*.4):(Math.log(firstp.get(a.no))+Math.log(secondp.get(b.no)));
   pairs.push({a,b,s});
 }
 pairs.sort((x,y)=>y.s-x.s||x.a.no-y.a.no||x.b.no-y.b.no);
 return pairs;
}
function thirds(card,pair,scope,thirdModel) {
 const e=card.e.filter(x=>x.no!==pair.a.no&&x.no!==pair.b.no);
 if(scope==='all')return e.map(x=>x.no);
 if(scope==='pairlines')return e.filter(x=>x.line===pair.a.line||x.line===pair.b.line).map(x=>x.no);
 if(scope==='score2'||scope==='score3')return e.slice().sort((a,b)=>b.score-a.score||a.no-b.no)
    .slice(0,scope==='score2'?2:3).map(x=>x.no);
 const score=(x)=>dot(riderCols(x,card,pair.a,pair.b),thirdModel.weights);
 return e.slice().sort((a,b)=>score(b)-score(a)||a.no-b.no).slice(0,scope==='trained2'?2:3).map(x=>x.no);
}
function tickets(card,mode,k,scope,models) {
 const pairs=orderedPairs(card,mode,models).slice(0,k);
 const t=new Set();
 for(const pair of pairs)for(const n of thirds(card,pair,scope,models.third))t.add(pair.a.no+'-'+pair.b.no+'-'+n);
 return {t,pairs};
}
function analyzeThirds(cards) {
 const arr=cards.filter(c=>c.cross),events=[];
 for(const c of arr){
   const a=c.byNo.get(c.finish[0]),b=c.byNo.get(c.finish[1]),third=c.byNo.get(c.finish[2]);
   const remaining=c.e.filter(x=>x.no!==a.no&&x.no!==b.no).sort((x,y)=>y.score-x.score||x.no-y.no);
   events.push({cat:c.cat,band:c.band,high:c.high,thirdFirst:third.line===a.line,
     thirdSecond:third.line===b.line,thirdOther:third.line!==a.line&&third.line!==b.line,
     thirdInTop1:remaining.slice(0,1).some(x=>x.no===third.no),
     thirdInTop2:remaining.slice(0,2).some(x=>x.no===third.no),
     thirdInTop3:remaining.slice(0,3).some(x=>x.no===third.no),
     thirdRole:third.role,thirdRank:third.rankIndex+1
   });
 }
 const summary=rr=>{
   const n=rr.length;
   return {n,third_first_line:sum(rr,x=>+x.thirdFirst),third_second_line:sum(rr,x=>+x.thirdSecond),
   third_other_line:sum(rr,x=>+x.thirdOther),third_score_rank1:sum(rr,x=>+x.thirdInTop1),
   third_score_rank2:sum(rr,x=>+x.thirdInTop2),third_score_rank3:sum(rr,x=>+x.thirdInTop3),
   third_line_leader:sum(rr,x=>+(x.thirdRole===1)),third_line_second:sum(rr,x=>+(x.thirdRole===2)),
   third_line_third_plus:sum(rr,x=>+(x.thirdRole>=3))};
 };
 return {all:summary(events),mansha:summary(events.filter(x=>x.high)),not_mansha:summary(events.filter(x=>!x.high)),
  by_category:Object.fromEntries(CATS.map(cat=>[cat,summary(events.filter(x=>x.cat===cat&&x.high))]))};
}
function calc(cards,mode,k,scope,models){
 let n=0,racesWithPair=0,pairsCorrectCross=0,racesHit=0,highHit=0,midHit=0,payout=0,stake=0,ticketsCount=0,crossRaces=0,crossHighRaces=0,thirdConditional=0;
 const winners=[];
 for(const c of cards){
   const bet=tickets(c,mode,k,scope,models);
   const pair=c.finish[0]+'-'+c.finish[1],key=c.finish.join('-');
   const pairMatched=bet.pairs.some(q=>q.a.no===c.finish[0]&&q.b.no===c.finish[1]);
   const hit=bet.t.has(key);
   n++;ticketsCount+=bet.t.size;
   stake+=bet.t.size*100;crossRaces+=Number(c.cross);crossHighRaces+=Number(c.cross&&c.high);
   if(pairMatched){racesWithPair++;pairsCorrectCross+=Number(c.cross);}
   if(hit){racesHit++;thirdConditional++;highHit+=c.high;midHit+=Number(c.band==='50-100');payout+=c.payout;winners.push({payout:c.payout,stake:bet.t.size*100,date:c.date,cat:c.cat,high:c.high})}
 }
 const payoutWithoutTop=arr=>payout-arr.slice().sort((a,b)=>b.payout-a.payout).slice(0,1).reduce((a,b)=>a+b.payout,0);
 return {races:n,cross_races:crossRaces,cross_mansha:crossHighRaces,
   pair_covered:racesWithPair,pair_covered_pct:crossRaces?racesWithPair/crossRaces:null,
   third_coverage_given_pair:racesWithPair?racesHit/racesWithPair:null,
   hits:racesHit,high_hits:highHit,mid_hits:midHit,rate:n?racesHit/n:null,
   tickets:ticketsCount,avg_tickets:n?ticketsCount/n:null,stake,payout,roi:stake?payout/stake:null,
   roi_without_largest_return:stake?payoutWithoutTop(winners)/stake:null};
}
function scoreConfig(){return {score:{},regular:{},mansha:{}};}
async function main(){
 const dates=archive.dateList(START,END),bad=[],missing=[],available=[];
 let index=0;const excluded={size:0,girls_or_unclassified:0,pending_or_invalid_result:0,multiple_results:0,invalid_prelude:0},cards=[];
 async function collect(){while(index<dates.length){
   const date=dates[index++],doc=await archive.fetchDay(date);
   if(doc.error){bad.push({date,error:doc.error});continue}
   if(doc.missing){missing.push(date);continue}
   available.push(date);
   for(const r of doc.data||[]){const c=createCard(r,date,excluded);if(c)cards.push(c)}
 }}
 await Promise.all(Array.from({length:8},collect));
 if(bad.length)throw Error('Data fetch errors: '+JSON.stringify(bad.slice(0,5)));
 cards.sort((a,b)=>a.date.localeCompare(b.date)||a.venue.localeCompare(b.venue)||a.raceNo-b.raceNo);
 const train=cards.filter(x=>x.date<TRAIN_END),validation=cards.filter(x=>x.date>=TRAIN_END&&x.date<TEST_BEGIN),holdout=cards.filter(x=>x.date>=TEST_BEGIN);
 if(train.length<4000||validation.length<1500||holdout.length<2000)throw Error('Insufficient complete time windows');
 const models=scoreConfig();
 models.regular={winner:fit(train,0,()=>true),second:fit(train,1,()=>true)};
 models.mansha={winner:fit(train,0,r=>r.cross&&r.high),second:fit(train,1,r=>r.cross&&r.high)};
 models.third=fit(train,2,r=>r.cross&&r.high);
 const kinds=['score','regular','mansha'],K=[1,3,6,10],thirdModes=['score2','score3','trained2','trained3','pairlines','all'];
 const configs=[];for(const kind of kinds)for(const k of K)for(const t of thirdModes)configs.push({kind,k,third:t});
 const scenarios=configs.map(s=>({id:s.kind+'-'+s.k+'-'+s.third,...s,
  validation:calc(validation,s.kind,s.k,s.third,models),
  holdout:calc(holdout,s.kind,s.k,s.third,models),
  holdout_highrisk:calc(holdout.filter(x=>x.riskPriority),s.kind,s.k,s.third,models),
  holdout_highrisk_7cars:calc(holdout.filter(x=>x.riskPriority&&x.n===7),s.kind,s.k,s.third,models),
  holdout_highrisk_9cars:calc(holdout.filter(x=>x.riskPriority&&x.n===9),s.kind,s.k,s.third,models)
 }));
 const hist=r=>({races:r.length,high:sum(r,x=>x.high),crossline:sum(r,x=>+x.cross),manshaCross:sum(r,x=>+(x.high&&x.cross)),
   mid:sum(r,x=>+(x.band==='50-100')),avgPayout:avg(r.map(x=>x.payout)),
   riskHigh:sum(r,x=>+x.riskPriority)});
 const bins=['under50','50-100','100-300','300+'];
 const postCats={};
 for(const cat of CATS)postCats[cat]={total:hist(holdout.filter(x=>x.cat===cat)),
   mansha:hist(holdout.filter(x=>x.cat===cat&&x.high)),third:analyzeThirds(holdout.filter(x=>x.cat===cat))};
 const output={study:'crossline-pair-thirds-v1',requested:[START,END],available_days:available.length,missing_days:missing.length,
  excluded,development:hist(train),validation:hist(validation),holdout:hist(holdout),
  mansha_outcome_payouts:Object.fromEntries(bins.map(b=>[b,hist(holdout.filter(x=>x.band===b))])),
  third_dev:analyzeThirds(train),third_holdout:analyzeThirds(holdout),
  by_category:postCats,
  models:{regular:{winner:models.regular.winner,second:models.regular.second},
   mansha:{winner:models.mansha.winner,second:models.mansha.second},third:models.third},
  scenarios};
 await fs.mkdir('reports/mansha',{recursive:true});
 await fs.writeFile('reports/mansha/crossline-pair-third-v1.json',JSON.stringify(output,null,2)+'\n');
 const keyOf=(a)=>a.kind+' / '+a.k+'組 / '+a.third;
 const pct=x=>x==null?'-':(x*100).toFixed(2)+'%',yen=x=>Math.round(x).toLocaleString('ja-JP');
 const md=['# 万車向け別線1・2着／3着買い目検証','',
  '- データ取得：'+available.length+'日、男子'+cards.length+'R。リザルトが揃ったA7/C7/S7/S9のみ。欠損'+missing.length+'日。',
  '- 6〜8月：役割・競走得点などの発走前特徴量から1着・2着・3着の候補順位を学習（通常成績と万車別線限定の2方式）。',
  '- 9月：比較用の開発外期間。**10〜11月の独立検証は買い目やモデルの選択に使用しない。**',
  '- 10〜11月：最終評価。**実際の万車を知ってから購入することはしない**。収支は各レース100円/点の単純計算。',
  '- 別線は「1着・2着が別ライン」と定義。3着は第1ライン・第2ライン・第三ラインに分ける。',
  '- 3着全通り＝選択した1・2着別線ペアごとに、残る5（7車）または7（9車）を購入。',
  '',
  '## 実際の3着の位置','',
  '| 対象 | R | 1着ライン3着 | 2着ライン3着 | その他ライン3着 | 残り得点上位2人の3着 |',
  '|---|---:|---:|---:|---:|---:|'];
 for(const [name,x] of [['開発 万車・別線',output.third_dev.mansha],['最終 万車・別線',output.third_holdout.mansha]]){
  md.push('|'+name+'|'+x.n+'|'+pct(x.third_first_line/x.n)+'|'+pct(x.third_second_line/x.n)+'|'+pct(x.third_other_line/x.n)+'|'+pct(x.third_score_rank2/x.n)+'|');
 }
 md.push('', '## 未学習期間の成績（10〜11月）','',
  '| 1・2着の候補 | 組 | 3着 | 全レース平均点数 | 全レース的中率 | 全レース回収率 | 高リスクレース万車的中 | 高リスクレース回収率 |',
  '|---|---:|---|---:|---:|---:|---:|---:|');
 for(const q of scenarios){
  const t=q.holdout,h=q.holdout_highrisk;
  md.push('|'+q.kind+'|'+q.k+'|'+q.third+'|'+(t.avg_tickets||0).toFixed(1)+'|'+pct(t.rate)+'|'+pct(t.roi)+'|'+h.high_hits+'|'+pct(h.roi)+'|');
 }
 md.push('','## 注意','',
 '本検証に予測オッズ（発走前時点）は含まれないため、期待値EVは計算していない。全レースの買い目をベットしたと仮定した「実現払戻に基づく単純回収率」のみ。',
 '後半の勝敗からは特徴の採用や閾値の調整をしない。改善ロジックは新たな発走前予想の保存と未来レースで検証すべき。',
 '本番の予想エンジンや買い目は変更しない。');
 await fs.writeFile('reports/mansha/crossline-pair-third-v1.md',md.join('\n')+'\n');
 if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,md.slice(0,33).join('\n')+'\n');
 console.log('CROSSLINE_SUMMARY='+JSON.stringify({available_days:available.length,excluded,development:output.development,validation:output.validation,holdout:output.holdout,third_holdout:output.third_holdout,examples:scenarios.filter(x=>[1,3,6].includes(x.k)&&['all','score2','trained3'].includes(x.third)).map(x=>({id:x.id,holdout:x.holdout,highrisk:x.holdout_highrisk}))}));
}
if(require.main===module)main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
module.exports={createCard,riderCols,orderedPairs,thirds,tickets,fit,calc,analyzeThirds};
