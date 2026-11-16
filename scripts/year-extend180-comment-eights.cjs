#!/usr/bin/env node
'use strict';
/* RESEARCH ONLY: current eight engines on selected preceding-90 cards with comment-inferred lineups.
 * NO claim that source was frozen pre-race. NO inference from actual outcome.
 * NEVER pool this deliberately selected subset with the next 90-day full eligible cohort.
 */
const fs=require('node:fs'),path=require('node:path');
const Feed=require('../js/race-feed.js'),Policy=require('../js/routing/policy.js');
const Router=require('../js/routing/router.js'),B=require('../js/b-upset/engine.cjs');
const E=require('../js/b-upset/evaluation.cjs');
const root=path.resolve(__dirname,'../reports/year-race-type');
const input=JSON.parse(fs.readFileSync(path.join(root,'extended180-comment-inputs-temporary.json'),'utf8'));
if(input.summary?.schema!=='tk-keirin-extended180-comment-reconstructed-prep/v1'||!Array.isArray(input.cards))throw Error('Source audit missing');
if(input.summary.cross_source_verification?.counts?.disagreed>0)throw Error('Line benchmark mismatch');
const ways=['auto','physical','causal','lab_v5','line','roi_coverage','b_upset_ad','b_upset_expanded'];
const seen=new Set(),valid=[],failures={},counter={};
function count(k){counter[k]=(counter[k]||0)+1}
function fail(k,e){const v=failures[k]??={count:0,samples:[]};v.count++;if(v.samples.length<4)v.samples.push(String(e).slice(0,180))}
for(const src of input.cards){
 const key=src.date+':'+src.venue+':'+src.race_no;
 if(seen.has(key)){fail('duplicate',key);continue}seen.add(key);
 if(src.line_source!=='strict_named_comment_inference'){fail('line_source',key);continue}
 try{
  const obs={combos:src.observed.combos};
  if(!obs.combos?.length||obs.combos.some(x=>!x.key||!Number.isInteger(x.payout)||x.payout<=0))throw Error('No valid payout');
  const card={entries:src.entries,start_time:src.start_time,venue:src.venue,race_number:src.race_no,round_name:'未取得',grade:'未確認',is_girls:false};
  const raw=Feed.convert(card,{date:src.date,generated_at:''});
  raw.source={mode:'historical-archive-replay',label:'Strict comment-derived line with exact CSV rider/class match',
   generated_at:'',verified:false,lineup_verified:false,missing_fields:['official_lineup','round','s','b','wins','recent','ex']};
  const category=Policy.classify(raw).key;
  if(category!==src.category)throw Error('Category mismatch '+category+' vs '+src.category);
  const at=Date.parse(src.date+'T'+src.start_time+':00+09:00')-600000;
  const predictions={},modelIds={};
  for(const name of ways.filter(x=>!x.startsWith('b_upset'))){
   try{
    const output=Router.build(raw,{}, {asOf:at,engine:name});
    if(output.race_id!==key)throw Error('Race identity mismatch');
    predictions[name]=E.settle(output.tickets.map(x=>x.key),obs);
    modelIds[name]=output.model?.model_id||null;
   }catch(e){fail(name,e.message)}
  }
  try{
   const output=B.build(raw,{asOf:at,replay:true});
   if(output.race_id!==key)throw Error('B-upset identity mismatch');
   predictions.b_upset_ad=E.settle(output.research.ad.map(x=>x.key),obs);
   predictions.b_upset_expanded=E.settle(output.research.expanded.map(x=>x.key),obs);
   modelIds.b_upset_ad=output.model?.model_id||null;modelIds.b_upset_expanded=modelIds.b_upset_ad;
  }catch(e){fail('b_upset',e.message)}
  if(ways.some(x=>!predictions[x])){count('incomplete_eight');continue}
  valid.push({date:src.date,race_id:src.race_id,category,venue:src.venue,race_no:src.race_no,
   predictions,modelIds,result_source:src.result_source});
  count('complete_eight');
 }catch(e){fail('invalid_card',e.message)}
}
valid.sort((a,b)=>a.date.localeCompare(b.date)||a.race_id.localeCompare(b.race_id));
function pack(rows){return {races:rows.length,engines:Object.fromEntries(ways.map(k=>[k,E.metrics(rows.map(r=>r.predictions[k]))]))}}
function by(field){return Object.fromEntries([...new Set(valid.map(r=>r[field]))].sort().map(x=>[x,pack(valid.filter(r=>r[field]===x))]))}
const out={schema:'tk-keirin-extend180-comment-replayed-subset-eight-engine/v1',created_at:new Date().toISOString(),
 source:input.summary.source,counts:{...input.summary.counts,...counter},benchmark:input.summary.cross_source_verification,
 failures,all:pack(valid),by_category:by('category'),by_result_source:by('result_source'),
 by_month:Object.fromEntries([...new Set(valid.map(r=>r.date.slice(0,7)))].sort().map(m=>[m,pack(valid.filter(r=>r.date.startsWith(m)))])),
 limitations:[
  'STRICT COMMENT-INFERRED lineups, not independently verified in historical May-Aug cohort',
  'SELECTION BIAS: only reconstructible comments; NOT a full 180-day ROI or full additional-90-day ROI',
  'Race round/meeting stage absent; cannot split by actual final, special selection or losers',
  '2026-11 current engine retrospective replay, NOT 2026-05-08 frozen pre-race predictions',
  'Archived publication time of rider comments is not independently verified',
  'Historical B/S/recent/EX inputs unavailable and deliberately not invented',
  'Third-party trifecta payouts are not official audited',
  'DO NOT POOL with existing 90-day all-race results or represent as uniform 180-day sample'
 ]};
fs.writeFileSync(path.join(root,'extended180-preceding90-comment-eights-summary.json'),JSON.stringify(out,null,2)+'\n');
const md=[
 '# 競輪LAB 180日研究：追加90日の厳格コメント復元8方式（限定抽出）',
 '',
 '対象: 2026-05-20〜2026-08-17。過去コメントから明示された追走関係だけを再構成し、全車ライン完成・選手と級班照合・払戻突合ができたレースに限定。**90日間の全件ではありません。**',
 '',
 '| 指標 | 件数 |','|---|---:|',
 '| コメント評価対象（暫定男子7/9車） | '+(input.summary.counts?.seven_nine_potential_male||0)+' |',
 '| コメントによる厳格完全復元 | '+(input.summary.counts?.strict_lines||0)+' |',
 '| さらに選手・級班照合済み | '+(input.summary.counts?.strict_plus_grade_name||0)+' |',
 '| 8方式共通精算に成功 | '+valid.length+' |',
 '| 後半の独立ライン実測との重複期間テスト | '+input.summary.cross_source_verification.counts.agreed+'/'+input.summary.cross_source_verification.counts.reconstructed+' |',
 '',
 '## 8エンジン仮想精算（各買い目100円）','',
 '| エンジン | R | 的中R | 投資円 | 払戻円 | 回収率 | 最大1件除外 | 最大5件除外 |',
 '|---|---:|---:|---:|---:|---:|---:|---:|',
 ...ways.map(k=>{
   const v=out.all.engines[k],pct=n=>n===null?'N/A':(100*n).toFixed(1)+'%';
   return '| '+k+' | '+v.n+' | '+v.hits+' | '+v.stake+' | '+v.payout+' | '+pct(v.roi)+' | '+pct(v.trim1)+' | '+pct(v.trim5)+' |';
 }),
 '',
 '### 解釈と制約',
 '',
 '- 直近90日5,745Rとは抽出方式が異なる。180日全件収益率として合算することは禁止。',
 '- 追走関係の復元検証で一致したレースは復元成功群のみ。未復元レースを含む全面的な精度保証ではない。',
 '- 競走級班は出走選手と月次CSVの一致で確定したが、番組名・開催日程区分はこのソースでは未取得。',
 '- 入力は現行2026年11月版モデルを過去に適用した事後再生成。当時の事前凍結予測ではない。',
 '- 選手コメントのアーカイブ収録時刻も未検証。第三者配当と本番オッズの公式全件照合は未実施。',
 '- Railwayとmainは一切変更しない。',
 '',
 '検証不能/エラー: '+JSON.stringify(failures),
 '',
 '監査集計と級班別・月別の全表は extended180-preceding90-comment-eights-summary.json を参照。'
 ];
fs.writeFileSync(path.join(root,'extended180-preceding90-comment-eights-ja.md'),md.join('\n')+'\n');
console.log('EXTEND180_COMMENT_8WAYS',JSON.stringify({n:valid.length,counts:out.counts,
 verification:out.benchmark.counts,engine_roi:Object.fromEntries(ways.map(k=>[k,{roi:out.all.engines[k].roi,trim5:out.all.engines[k].trim5}])),failures}).slice(0,12000));
if(!valid.length||Object.keys(failures).length)process.exitCode=2;
