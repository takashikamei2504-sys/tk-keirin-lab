/* Outcome accounting only. Never imported by the prediction engine. */
(function(root){'use strict';
const Audit=typeof module!=='undefined'?require('../results-audit.js'):root.ResultsAudit;
const P=typeof module!=='undefined'?require('../model-provenance.js'):root.ModelProvenance;
const excluded=category=>({status:'excluded',category});
function evaluate(record,observed){try{
 const o=record?.out,r=o?.input?.race,cutoff=Audit.startAt(r),saved=Date.parse(record.saved_at),at=Date.parse(o.input.as_of),generated=Date.parse(o.generated_at),source=Date.parse(r.source?.generated_at);
 if(record.schema!=='tk-keirin-line-frozen/v1'||o.mode!=='pre-race'||record.race_id!==Audit.raceKey(r)||!Number.isFinite(cutoff)||!(source<=at&&at<=generated&&generated<=saved&&saved<cutoff)||r.source.mode!=='live-public-feed'||Date.parse(o.input.cutoff)!==cutoff)return excluded('発走前の保存・入力・出走表時刻を確認できない');
 if(!o.provenance?.model?.model_id||o.provenance.input_sha256!==P.sha256(o.input)||o.provenance.input_as_of!==o.input.as_of||o.provenance.cutoff!==o.input.cutoff)return excluded('保存入力の整合性を確認できない');
 if(record.output_sha256&&record.output_sha256!==P.sha256(o))return excluded('保存出力のハッシュが一致しない');
 const ids=r.riders.map(x=>x.no),tickets=o.tickets,valid=t=>Array.isArray(t.trio)&&t.trio.length===3&&new Set(t.trio).size===3&&t.trio.every(n=>Number.isInteger(n)&&ids.includes(n))&&t.key===t.trio.join('-');
 if(![7,9].includes(ids.length)||new Set(ids).size!==ids.length||!Array.isArray(tickets)||!tickets.length||new Set(tickets.map(t=>t.key)).size!==tickets.length||!tickets.every(valid))return excluded('保存買い目が不正');
 if(!observed)return {status:'pending',category:'結果待ち'};
 if(observed.race_id!==Audit.raceKey(observed.race)||JSON.stringify(Audit.identity(observed.race))!==JSON.stringify(observed.identity))return excluded('結果の出走者・識別情報が不一致');
 if(!(Date.parse(observed.source_updated_at)>cutoff&&Date.parse(observed.collected_at)>=Date.parse(observed.source_updated_at))||!Array.isArray(observed.combos)||!observed.combos.length||!observed.combos.every(valid))return excluded('結果の時刻・組合せを確認できない');
 const e=Audit.evaluate({pre_race:true,cutoff:o.input.cutoff,saved_at:record.saved_at,race_id:record.race_id,input:r,identity:Audit.identity(r),chosen:tickets,ranked_keys:tickets.map(t=>t.key),version:o.version,model_id:o.provenance.model.model_id},observed);
 return {...e,axis:o.decision.axis,main_pair_hit:e.status==='evaluated'?observed.combos.some(c=>c.trio[0]===o.main.finish.pair[0]&&c.trio[1]===o.main.finish.pair[1]):null,story_verified:false,note:'着順だけで展開仮説の正しさは判定しない。予想・特徴量・係数は変更しない。'};
 }catch(_){return excluded('保存記録の形式が不正');}}
function summarize(rows){const counts={evaluated:0,hits:0,pending:0,excluded:0},byModel={},byAxis={};
 for(const row of rows){const e=row.evaluation;counts[e.status]=(counts[e.status]||0)+1;if(e.status!=='evaluated')continue;counts.hits+=Number(e.hit);const model=byModel[row.model_id]||(byModel[row.model_id]={evaluated:0,hits:0,main_pair_hits:0,points:0}),key=row.model_id+' / '+e.axis,axis=byAxis[key]||(byAxis[key]={evaluated:0,hits:0});for(const group of [model,axis]){group.evaluated++;group.hits+=Number(e.hit);}model.main_pair_hits+=Number(e.main_pair_hit);model.points+=e.points;}
 return {...counts,by_model:byModel,by_axis:byAxis,scope:'発走前保存された予想だけの実測件数。モデルを混ぜず集計。比較評価を予測確率に変換しない。'};
}
const api={evaluate,summarize};if(typeof module!=='undefined')module.exports=api;root.LineEvaluation=api;
})(typeof globalThis!=='undefined'?globalThis:this);
