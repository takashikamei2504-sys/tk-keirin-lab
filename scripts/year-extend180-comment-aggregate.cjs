#!/usr/bin/env node
'use strict';
/* Research only; aggregate and audit all 12 source-selected eight-engine shards. */
const fs=require('node:fs'),path=require('node:path'),E=require('../js/b-upset/evaluation.cjs');
const root=path.resolve(__dirname,'../reports/year-race-type');
const summary=JSON.parse(fs.readFileSync(path.join(root,'extended180-comment-input-summary.json'),'utf8'));
const ways=['auto','physical','causal','lab_v5','line','roi_coverage','b_upset_ad','b_upset_expanded'],total=12;
const seen=new Set(),all=[],failures={},chunks=[];
let count=0;
for(let i=0;i<total;i++){
 const o=JSON.parse(fs.readFileSync(path.join(root,'extend180-comment-shards','part-'+i+'.json'),'utf8'));
 if(o.schema!=='tk-keirin-extend180-comment-eights-shard/v1'||o.shard!==i||o.total!==total)throw Error('Shard version/order mismatch '+i);
 if(o.source_ref!==summary.source?.entries_results)throw Error('Source commit mismatch '+i);
 count+=o.processed;chunks.push({shard:i,processed:o.processed,complete:o.rows.length});
 for(const [key,v] of Object.entries(o.failures||{})){const f=failures[key]??={count:0,examples:[]};f.count+=v.count;f.examples.push(...v.examples.slice(0,2));}
 for(const r of o.rows){
  if(seen.has(r.race_id))throw Error('Duplicate race '+r.race_id);
  seen.add(r.race_id);
  if(ways.some(x=>!r.predictions?.[x]))throw Error('Missing engine '+r.race_id);
  all.push(r);
 }
}
if(count!==summary.counts.replay_ready||all.length!==count||Object.keys(failures).length)throw Error('Coverage failures '+JSON.stringify({count,expected:summary.counts.replay_ready,n:all.length,failures}).slice(0,1400));
all.sort((a,b)=>a.date.localeCompare(b.date)||a.race_id.localeCompare(b.race_id));
function pack(rows){return{races:rows.length,engines:Object.fromEntries(ways.map(k=>[k,E.metrics(rows.map(r=>r.predictions[k]))]))}}
function group(field){return Object.fromEntries([...new Set(all.map(r=>r[field]))].sort().map(k=>[k,pack(all.filter(r=>r[field]===k))]))}
const months=[...new Set(all.map(r=>r.date.slice(0,7)))].sort();
const out={
 schema:'tk-keirin-extend180-comment-only-exploratory-8engine/v1',
 created_at:new Date().toISOString(),
 period:{start:'2026-05-20',end:'2026-08-17',days:90},
 source:summary.source,
 counts:{...summary.counts,complete_eight:all.length},
 stage:'unavailable',
 line_benchmark:summary.cross_source_verification,
 shards:chunks,
 all:pack(all),by_category:group('category'),by_result_source:group('source_result'),
 by_month:Object.fromEntries(months.map(m=>[m,pack(all.filter(r=>r.date.startsWith(m)))])),
 limitations:[
 'NOT a full 180-day or full preceding 90-day backtest: 661 selection-biased source-complete cases only',
 'Comments are historical retrospective records without independently proved publication time',
 'Lineup is a strict inference, not source-confirmed truth in the May-Aug historical period',
 'Published stage and meeting day not known for these cards; no retrospective special-race comparison',
 'This is November 2026 model applied to older data and NOT frozen predictions from those dates',
 'Original rider form/B/S/EX missing rather than invented',
 'Payouts are third-party records not independently official audited',
 'No pooling with established 2026-08-18 to 2026-11-15 exhaustive 90-day 5745R cohort'
 ]};
fs.writeFileSync(path.join(root,'extended180-preceding90-comment-eights-summary.json'),JSON.stringify(out,null,2)+'\n');
const pct=n=>n===null||n===undefined?'N/A':(n*100).toFixed(1)+'%';
const md=[
 '# 競輪LAB・180日拡張：追加90日をコメント由来の全車ライン復元に限定した8方式比較',
 '',
 '対象期間：2026-05-20〜2026-08-17（90日）。対象レースはコメント中の追走意思が完全に読み取れ、月次CSVの選手名・級班と払戻に照合できた限定群です。**同期間の全レースを評価したものではありません。**',
 '',
 '## データ監査','',
 '| 段階 | R数 |','|---|---:|',
 '| 男子候補の7・9車レース | '+summary.counts.seven_nine_potential_male+' |',
 '| 厳格コメントで全車ライン復元 | '+summary.counts.strict_lines+' |',
 '| 出走選手・級班突合まで成功 | '+summary.counts.strict_plus_grade_name+' |',
 '| 払戻・8方式すべて評価 | '+all.length+' |',
 '| 独立ラインとのテスト（一致/完全復元） | '+summary.cross_source_verification.counts.agreed+'/'+summary.cross_source_verification.counts.reconstructed+' |',
 '',
 '## 同一対象で8方式を比較（1点100円）','',
 '| エンジン | 的中R | 投資円 | 払戻円 | 回収率 | 最大1件除外 | 最大5件除外 |',
 '|---|---:|---:|---:|---:|---:|---:|',
 ...ways.map(k=>{const v=out.all.engines[k];return '| '+k+' | '+v.hits+' | '+v.stake+' | '+v.payout+' | '+pct(v.roi)+' | '+pct(v.trim1)+' | '+pct(v.trim5)+' |';}),
 '',
 '## 月別（全方式比較はJSONへ）','',
 '| 月 | R数 | AUTO | LAB LINE |','|---|---:|---:|---:|',
 ...months.map(m=>{const v=out.by_month[m];return '| '+m+' | '+v.races+' | '+pct(v.engines.auto.roi)+' | '+pct(v.engines.line.roi)+' |';}),
 '',
 '## 評価上の注意','',
 '- 独立ライン49/49の一致率は復元可能例に限った評価。未復元レースを含めた全体の正解率ではない。',
 '- 661Rの結果は、元の90日5,745Rの全件評価と同じ抽出条件ではない。合算した180日回収率は提示できない。',
 '- 原本の正しい番組名や発走前の情報更新時刻が不明のため、最終日敗者戦・決勝・初日特選を確定分類していない。',
 '- 現行モデルの過去再生成。真の過去に凍結した発走前予想ではない。',
 '- 最高1件・5件除外で高配当依存度を点検。本番運用の切替は行わない。',
 '',
 '## 次の実行要件',
 '- 追加期間の正確な並びとレース種別を合法的に取得できるアーカイブで照合する。',
 '- 期間中に結果が残らない2026-05-20〜06-07は追加払い戻し資料で分母欠落を検証する。',
 '- 連続180日の比較には全件同等品質のライン・払戻が必要。現状は比較群を分離して扱う。',
 '',
 'GitHub Actions 12分割の各シャード、ID重複0、同一対象の8方式全件成功を確認。',
 ];
fs.writeFileSync(path.join(root,'extended180-preceding90-comment-eights-ja.md'),md.join('\n')+'\n');
console.log('EXTEND180_AUDITED_EIGHT_SUMMARY',JSON.stringify({races:all.length,engines:Object.fromEntries(ways.map(k=>[k,{roi:pct(out.all.engines[k].roi),trim5:pct(out.all.engines[k].trim5),hits:out.all.engines[k].hits}])),by_month:Object.fromEntries(months.map(m=>[m,{races:out.by_month[m].races,auto:pct(out.by_month[m].engines.auto.roi)}]))}).slice(0,10000));
