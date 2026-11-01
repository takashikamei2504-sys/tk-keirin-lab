/* Automatic UI enrichment. No data entry or source adoption step is needed. */
let recentFormPack={};
function recentFormRender(out){
 const rows=out.form?.riders||[],covered=rows.filter(r=>r.recent_form).length;
 const status=document.getElementById('recent-form-status'),body=document.getElementById('recent-form-riders');
 if(!status||!body)return;
 status.textContent=`近況成績 ${covered}/${rows.length}選手を自動反映。KEIRIN.JP・直近4ヶ月集計／最近の開催成績。Bも取得、Sは未取得。発走前に収集済みで更新から72時間以内の情報を使用。`;
 body.innerHTML=rows.map(r=>{
  const f=r.recent_form;if(!f)return `<div class="intel-record"><strong>${esc(r.no)}番 ${esc(r.name)}</strong><p>${esc(r.form_status)}</p></div>`;
  const s=f.stats,meetings=(f.recent_meetings||[]).slice(0,5),jst=t=>new Date(t).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
  return `<details class="causal-story"><summary>${esc(r.no)}番 ${esc(r.name)}｜勝率${s.win_rate.toFixed(1)}%・3連対率${s.top3_rate.toFixed(1)}%</summary><p class="small">直近4ヶ月：${s.total}走／1着${s.wins}・2着${s.seconds}・3着${s.thirds}／B${s.b}・S未取得<br>着外${s.unplaced}・棄権${s.withdrawals}・失格${s.disqualifications}（出典の区分。単純合算はしません）<br>2連対率 ${s.top2_rate.toFixed(1)}%</p>`+(f.current_meeting_results?.length?'<p class="small">今開催の確定済み成績</p>'+f.current_meeting_results.map(c=>`<p class="small">${esc(c.date)} ${esc(c.venue_grade)} ${esc(c.race)}：${esc(c.finish)}${c.b?' B':''}</p>`).join(''):'')+`<p class="small">最近5開催（開催初日・出典順の着順）</p>`+meetings.map(m=>`<p class="small">${esc(m.date)} ${esc(m.venue_grade)}：${esc(m.finishes.join('・')||'着順未掲載')}</p>`).join('')+`<p class="small"><a href="${esc(f.source_url)}" target="_blank" rel="noopener noreferrer">KEIRIN.JPの原資料</a><br>資料更新 ${esc(jst(f.source_updated_at))}<br>初回取得 ${esc(jst(f.collected_at))}（日本時間）</p></details>`;
 }).join('');
}
async function recentFormLoad(){
 const status=document.getElementById('recent-form-status');
 const urls=['https://raw.githubusercontent.com/takashikamei2504-sys/tk-keirin-lab/main/data/recent_form.json','data/recent_form.json'];
 let error;
 for(const url of urls){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),8000);
  try{const response=await fetch(url,{cache:'no-cache',signal:c.signal});if(!response.ok)throw Error('HTTP '+response.status);const p=await response.json();if(p.schema!==RecentForm.schema||!Array.isArray(p.snapshots)||p.snapshots.length>100000)throw Error('近況データ形式が不正');recentFormPack=p;causalRun();return;}catch(e){error=e;}finally{clearTimeout(timer)}
 }
 if(status)status.textContent='近況成績を取得できませんでした。未取得として予想を継続します。再読込で再取得します。'+(error?.message||'');
}
