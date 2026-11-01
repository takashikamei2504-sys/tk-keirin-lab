/* Public population browser: full roster denominator, measured data only. */
(function(){'use strict';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),key=v=>String(v||'').replace(/[\s\u3000]/g,''),jst=s=>new Date(s).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}),grade={SS:'S級S班',S1:'S級1班',S2:'S級2班',S3:'S級3班'};
let roster=[],records=new Map(),limit=50;
async function feed(path){
 let error;const rev=Math.floor(Date.now()/60000);
 for(const base of ['https://raw.githubusercontent.com/takashikamei2504-sys/tk-keirin-lab/main/','']){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),12000);
  try{const r=await fetch(base+path+'?v='+rev,{cache:'no-cache',signal:c.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}catch(e){error=e;}finally{clearTimeout(timer)}
 }throw error;
}
function snapshot(r){const s=records.get(r.rider_id);return s&&key(s.name)===key(r.name)&&RecentForm.valid(s)?s:null;}
function render(){
 const search=key($('rider-search').value),chosen=$('rider-grade').value;
 const rows=roster.filter(r=>(!chosen||r.class_rank===chosen)&&(!search||key(r.name+' '+r.rider_id+' '+r.prefecture).includes(search)));
 $('rider-count').textContent=`${rows.length}人が該当／${Math.min(limit,rows.length)}人を表示`;
 $('s-riders').innerHTML=rows.slice(0,limit).map(r=>{
  const s=snapshot(r),st=s?.stats,age=s?(Date.now()-Date.parse(s.source_updated_at))/3600000:0;
  const summary=st?`勝率 ${st.win_rate.toFixed(1)}%・3連対率 ${st.top3_rate.toFixed(1)}%${age>72?'／資料更新から72時間超':''}`:'近況の自動収集待ち';
  const current=(s?.current_meeting_results||[]).map(c=>`<p>${esc(c.date)} ${esc(c.venue_grade)} ${esc(c.race)}：${esc(c.finish)}${c.b?' B':''}</p>`).join('');
  const meets=(s?.recent_meetings||[]).slice(0,5).map(m=>`<p>${esc(m.date)} ${esc(m.venue_grade)}：${esc(m.finishes.join('・')||'着順未掲載')}</p>`).join('');
  return `<details class="rider"><summary><span class="grade">${esc(grade[r.class_rank]||r.class_rank)}</span><strong>${esc(r.name)}</strong><span class="number">${esc(r.rider_id)}</span><br><span class="muted">${esc(r.prefecture)}・${esc(r.style)} ／ ${esc(summary)}</span></summary><div class="detail">`+(s?`<p>直近4ヶ月 ${st.total}走／1着${st.wins}・2着${st.seconds}・3着${st.thirds}<br>勝率${st.win_rate.toFixed(1)}%・2連対率${st.top2_rate.toFixed(1)}%・3連対率${st.top3_rate.toFixed(1)}%<br>B${st.b}／S未取得</p>${current?'<p>今開催の確定済み成績</p>'+current:''}<p>最近5開催（開催初日・出典順）</p>${meets}<p class="muted">資料更新 ${esc(jst(s.source_updated_at))}<br>初回取得 ${esc(jst(s.collected_at))}（日本時間）</p><a href="${esc(s.source_url)}" target="_blank" rel="noopener noreferrer">KEIRIN.JPで確認</a>`:'<p>この選手も収集対象です。取得・氏名照合が完了すると自動表示します。</p>')+'</div></details>';
 }).join('');$('show-more').hidden=limit>=rows.length;
}
async function load(){
 try{
  const [manifest,pack]=await Promise.all([feed('data/s_riders.json'),feed('data/recent_form.json')]);
  if(manifest.schema!=='tk-keirin-s-roster/v1'||manifest.complete!==true||!Array.isArray(manifest.riders)||manifest.total!==manifest.riders.length||new Set(manifest.riders.map(r=>r.rider_id)).size!==manifest.total||!manifest.riders.every(r=>grade[r.class_rank]))throw Error('公式名簿の整合性を確認できません');
  if(pack.schema!==RecentForm.schema||!Array.isArray(pack.snapshots))throw Error('近況データ形式が不正です');
  roster=manifest.riders.slice().sort((a,b)=>Object.keys(grade).indexOf(a.class_rank)-Object.keys(grade).indexOf(b.class_rank)||a.rider_id.localeCompare(b.rider_id));
  for(const s of pack.snapshots){if(!RecentForm.valid(s)||Date.parse(s.collected_at)>Date.now())continue;const old=records.get(s.rider_id);if(!old||Date.parse(s.source_updated_at)>Date.parse(old.source_updated_at)||s.source_updated_at===old.source_updated_at&&Date.parse(s.collected_at)>Date.parse(old.collected_at))records.set(s.rider_id,s);}
  const count=roster.filter(r=>snapshot(r)).length;$('population-total').textContent=roster.length;$('population-covered').textContent=count;$('population-missing').textContent=roster.length-count;$('population-progress').max=roster.length;$('population-progress').value=count;
  $('population-status').textContent=count===roster.length?'現役S級全選手の名簿照合・近況取得が完了しています。':'現役S級全選手を対象に、未取得の選手から順次収集しています。';
  if(pack.s_class_coverage?.roster_refresh_error)$('population-status').textContent+=' 名簿更新を再試行中のため、前回の完全名簿を表示しています。';
  $('population-grades').textContent=Object.keys(grade).map(g=>{const rs=roster.filter(r=>r.class_rank===g);return rs.length?`${grade[g]} ${rs.filter(r=>snapshot(r)).length}/${rs.length}人`:'';}).filter(Boolean).join(' ／ ');
  $('population-time').textContent=`公式名簿取得 ${jst(manifest.generated_at)}／近況集約 ${jst(pack.generated_at)}（日本時間）`;
  render();
 }catch(e){$('population-status').textContent='データを読み込めませんでした。再読込してください。'+e.message;$('population-status').classList.add('error');}
}
for(const id of ['rider-search','rider-grade'])$(id).addEventListener('input',()=>{limit=50;render();});$('show-more').addEventListener('click',()=>{limit+=50;render();});load();
})();
