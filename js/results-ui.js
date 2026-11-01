/* Frozen system forecasts and device display history stay separately labelled. */
(function(root){'use strict';
const Audit=root.ResultsAudit,store='tk-keirin-sequential-history/v1';
const $=id=>document.getElementById(id),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let report=null,current=null,loading=false;
function read(){try{const rows=JSON.parse(localStorage.getItem(store)||'[]');return Array.isArray(rows)?rows:[];}catch{return [];}}
function track(out,race){
 current={race_id:Audit.raceKey(race)};
 if(race.source?.mode==='live-public-feed')try{
  const entry=Audit.snapshot(race,out,new Date().toISOString()),rows=read(),i=rows.findIndex(p=>p.race_id===entry.race_id&&p.version===entry.version);
  // Keep the last displayed pre-race version; post-race redraws must not replace it.
  if(i<0){if(entry.pre_race||!rows.some(p=>p.race_id===entry.race_id&&p.pre_race))rows.push(entry);}else if(entry.pre_race)rows[i]=entry;
  rows.sort((a,b)=>b.saved_at.localeCompare(a.saved_at));localStorage.setItem(store,JSON.stringify(rows.slice(0,300)));
 }catch(error){$('evaluation-storage').textContent='端末への保存不可：'+error.message+'。共通の自動保存記録は引き続き確認できます。';}
 render();
}
function render(){
 if(!$('evaluation-summary'))return;
 const summary=report?.summary;
 $('evaluation-summary').textContent=summary?`発走前保存 ${summary.evaluated}件を評価 ／ 的中${summary.hits}件${summary.hit_rate===null?'':`（${(summary.hit_rate*100).toFixed(1)}%）`} ／ 結果待ち${summary.pending}件 ／ 事前予想なし・対象外${summary.excluded}件`:'共通の自動保存記録を読み込み中。発走後に作った予想は成績へ含めません。';
 $('evaluation-paired').textContent=summary?.paired.count?`同じ事前入力・同一点数で旧エンジンと比較：${summary.paired.count}件中 新${summary.paired.new_hits}的中／旧${summary.paired.baseline_hits}的中。少数件の差だけで改善と断定しません。`:'新旧比較は発走前に両方を保存したレースから蓄積します。';
 if(summary?.by_policy)$('evaluation-paired').textContent+=' バージョン・点数別：'+Object.entries(summary.by_policy).map(([key,v])=>`${key} ${v.count}件中${v.hits}的中`).join(' ／ ');
 const recommendations=summary?.recommendations||[];
 $('evaluation-improvements').innerHTML=recommendations.length?recommendations.map(r=>`<p><strong>${esc(r.reason)} ${r.count}件</strong>：${esc(r.action)}</p>`).join(''):'評価できるレースが増えたら、1着・1／2着の組合せ・3着の候補漏れを集計します。';
 const filter=$('evaluation-date'),selected=filter.value||'all',dates=[...new Set((report?.rows||[]).map(r=>r.date))];
 filter.innerHTML='<option value="all">全日</option>'+dates.map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');filter.value=dates.includes(selected)?selected:'all';
 const rows=(report?.rows||[]).filter(r=>filter.value==='all'||r.date===filter.value);
 $('evaluation-races').innerHTML=rows.slice(0,80).map(r=>`<article class="intel-record"><strong>${esc(r.date)} ${esc(r.venue)}${r.race_no}R</strong><p>${r.result?esc(r.result.combos.map(c=>c.key+(c.payout?`（払戻${c.payout.toLocaleString()}円）`:'')).join(' ／ ')):'結果未取得'}<br>${esc(r.evaluation.category)}${r.evaluation.best_rank?` ／ 決着買い目のモデル内順位 ${r.evaluation.best_rank}位`:''}</p><p class="small">${r.saved_at?'共通予想保存 '+esc(new Date(r.saved_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})):'発走前に保存した予想なし'}${r.result?` ／ <a href="${esc(r.result.source_url)}" target="_blank" rel="noopener noreferrer">結果配信元</a>（公式未照合）`:''}</p></article>`).join('')||'結果記録はまだありません。配信結果が取得でき次第、自動で追加します。';
 $('evaluation-limit').textContent=rows.length>80?`${rows.length}件中80件を表示。日付で絞り込めます。`:'';
 const matching=read().filter(p=>p.race_id===current?.race_id),local=matching.find(p=>p.pre_race)||matching[0],observed=report?.rows.find(r=>r.race_id===current?.race_id)?.result;
 $('evaluation-device').textContent=local?`この端末で表示した予想：${new Date(local.saved_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}保存。${!local.pre_race?'発走後の参考予想のため評価対象外。':observed?Audit.evaluate(local,observed).category+'。':'発走前保存済み・結果待ち。'} 共通予想の成績とは別に照合します。`:'この端末の記録：公開出走表で予想を表示すると自動保存します。端末の時計を使うため、共通の自動保存とは区別します。';
}
async function refresh(){
 if(loading)return;loading=true;$('evaluation-update').disabled=true;
 $('evaluation-status').textContent='結果と評価記録を取得中…';
 try{
  let response;
  for(const url of ['https://raw.githubusercontent.com/takashikamei2504-sys/tk-keirin-lab/main/data/lab_evaluation.json','data/lab_evaluation.json']){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
   try{response=await fetch(url,{cache:'no-store',signal:controller.signal});if(response.ok)break;}catch{}finally{clearTimeout(timer);}
  }
  if(!response?.ok)throw Error('配信データ未取得');
  const value=await response.json();if(value.schema!==Audit.SCHEMA||!Array.isArray(value.rows)||value.rows.length>20000||!value.summary||!Array.isArray(value.collection?.errors))throw Error('評価データの形式が不正です');
  report=value;
  const scheduled=value.collection.last_scheduled_at,automatic=value.collection.last_automatic_at;
  const trigger=({schedule:'定期実行',workflow_run:'他収集後の自動実行',workflow_dispatch:'手動実行',push:'設定更新時の実行'})[value.collection.event]||'起動元未取得';
  const timing=scheduled?`最終定期成功 ${new Date(scheduled).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}。${Date.now()-Date.parse(scheduled)>90*60000?'定期更新が遅れています。':''}`:automatic?`予備経路で自動更新済み。定期実行は未確認。`:'定期実行は未確認。';
  $('evaluation-status').textContent=`${trigger}。${timing}最終収集 ${new Date(value.generated_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}（日本時間）。${value.collection.errors.length?'一部未取得 '+value.collection.errors.length+'件。':''}結果は配信更新後に反映。未取得は外れに数えません。`;
 }catch(error){$('evaluation-status').textContent='取得できませんでした：'+error.message+'。既に表示している記録は保持します。';}
 finally{loading=false;$('evaluation-update').disabled=false;render();}
}
function backup(){
 const blob=new Blob([JSON.stringify({schema:Audit.SCHEMA,exported_at:new Date().toISOString(),device_predictions:read(),system_evaluation:report},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='TK_KEIRIN_EVALUATION_'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
$('evaluation-update').addEventListener('click',refresh);$('evaluation-export').addEventListener('click',backup);$('evaluation-date').addEventListener('change',render);
root.ResultsUI={track,refresh};render();refresh();
})(globalThis);
