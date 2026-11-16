#!/usr/bin/env node
'use strict';
/* RESEARCH ONLY: archive coverage check, no line inference, no predictions, no raw rider data committed. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha='6ea68de4d92d3a8294e1a7d168e918a8a90eb155';
const base='https://raw.githubusercontent.com/snarfnet/keirin-data/'+sha+'/';
const days=Array.from({length:90},(_,i)=>new Date(Date.parse('2026-05-20T00:00:00Z')+i*86400000).toISOString().slice(0,10));
const C={entry_days:0,result_days:0,paired_days:0,entry_races:0,result_races:0,paired_races:0,paired_seven_nine_all_gender:0,trifecta_results:0,missing_lines_seven_nine:0,missing_round_seven_nine:0,duplicate_ids:0,results_not_joined:0,entries_not_joined:0};
async function load(prefix,date){
 const url=base+prefix+'_'+date.replaceAll('-','')+'.json';
 for(let retry=0;retry<3;retry++)try{
  const response=await fetch(url,{headers:{'User-Agent':'tk-keirin-lab historical source research'},signal:AbortSignal.timeout(30000)});
  if(response.status===404)return {ok:false};
  if(!response.ok)throw Error(prefix+' '+date+' HTTP '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer()),obj=JSON.parse(bytes.toString('utf8'));
  if(obj.date!==date.replaceAll('-','')||!Array.isArray(obj[prefix==='entries'?'races':'results']))throw Error('Unexpected schema '+url);
  return {ok:true,data:obj,digest:crypto.createHash('sha256').update(bytes).digest('hex')};
 }catch(e){if(retry===2)throw e;await new Promise(r=>setTimeout(r,700*(retry+1)))}
}
async function audit(date){
 const [a,b]=await Promise.all([load('entries',date),load('results',date)]);
 const x={date,entries:a.ok,results:b.ok,entry_count:0,result_count:0,joined:0,sha256:{}};
 if(a.ok){C.entry_days++;C.entry_races+=a.data.races.length;x.entry_count=a.data.races.length;x.sha256.entries=a.digest;const seen=new Set();
  for(const r of a.data.races){if(seen.has(r.race_id))C.duplicate_ids++;seen.add(r.race_id);
   if([7,9].includes(r.entries?.length)){if(!r.entries.every(e=>/^\d+-\d+$/.test(e.line_position||'')))C.missing_lines_seven_nine++;if(!r.round_name)C.missing_round_seven_nine++}
  }
 }
 if(b.ok){C.result_days++;C.result_races+=b.data.results.length;x.result_count=b.data.results.length;x.sha256.results=b.digest;const seen=new Set();
  for(const r of b.data.results){if(seen.has(r.race_id))C.duplicate_ids++;seen.add(r.race_id);
   if(r.paybacks?.some(p=>p.type==='3連単'&&/^[1-9]-[1-9]-[1-9]$/.test(p.combination||'')&&Number(p.payout)>0))C.trifecta_results++;
  }
 }
 if(a.ok&&b.ok){C.paired_days++;const entries=new Map(a.data.races.map(r=>[r.race_id,r])),ids=new Set(b.data.results.map(r=>r.race_id));
  for(const r of b.data.results){if(!entries.has(r.race_id)){C.results_not_joined++;continue}C.paired_races++;x.joined++;if([7,9].includes(entries.get(r.race_id).entries?.length))C.paired_seven_nine_all_gender++}
  for(const id of entries.keys())if(!ids.has(id))C.entries_not_joined++;
 }
 return x;
}
(async()=>{
 const daily=[];for(let i=0;i<90;i+=5){daily.push(...await Promise.all(days.slice(i,i+5).map(audit)));console.log('ARCHIVE_COVERAGE',i+5,'/90')}
 const out={schema:'tk-keirin-180day-prior90-source-coverage/v1',generated_at:new Date().toISOString(),start:days[0],end:days.at(-1),days:90,
  source:{repository:'snarfnet/keirin-data',pinned_commit:sha,raw_data_not_redistributed:true},counts:C,daily,
  missing_results_dates:daily.filter(d=>!d.results).map(d=>d.date),
  critical_missing_fields:['verified line_position','published race round_name','graded A/S/Challenge category','2026-05-20 to 2026-06-07 results'],
  evaluation_status:'SOURCE_AUDIT_ONLY; EIGHT_ENGINE_180_DAY_ROI_NOT_AVAILABLE'};
 const dir=path.resolve(__dirname,'../reports/year-race-type');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'extended180-preceding90-source-audit.json'),JSON.stringify(out,null,2)+'\n');
 const lines=['# 180日延長：追加90日（2026-05-20〜2026-08-17）データ監査','',
  '固定ソース：snarfnet/keirin-data@'+sha,'',
  '| 指標 | 件数 |','|---|---:|',
  '| 出走表がある日 | '+C.entry_days+'/90 |','| 結果がある日 | '+C.result_days+'/90 |',
  '| 両方がある日 | '+C.paired_days+'/90 |','| 出走表レース | '+C.entry_races+' |',
  '| 結果レース | '+C.result_races+' |','| ID一致レース | '+C.paired_races+' |',
  '| ID一致7/9車（女子未除外） | '+C.paired_seven_nine_all_gender+' |',
  '| 三連単払戻あり | '+C.trifecta_results+' |',
  '| 並び情報がない7/9車 | '+C.missing_lines_seven_nine+' |',
  '| 番組名称がない7/9車 | '+C.missing_round_seven_nine+' |','',
  '正確なライン・級班・番組の情報がないため、追加期間について現行8エンジンの公正な比較は未実行。',
  '発走前に凍結した当時の予想と、現在のモデルによる過去再生成は区別する。',
  '原データは保存・再配布せず、監査集計とSHAのみ保存。本番main/Railwayは変更しない。','',
  '未取得の結果日：'+out.missing_results_dates.join(', '),'',
  '詳細は対応するJSONを参照。'];
 fs.writeFileSync(path.join(dir,'extended180-preceding90-source-audit-ja.md'),lines.join('\n')+'\n');
 console.log('AUDIT_COMPLETE',JSON.stringify({counts:C,missing_results_dates:out.missing_results_dates}));
 if(C.entry_days!==90||C.result_days<65)throw Error('Unexpected archive coverage');
})().catch(e=>{console.error(e);process.exitCode=1});
