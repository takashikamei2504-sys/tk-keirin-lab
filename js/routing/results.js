(function(){'use strict';
const $=id=>document.getElementById(id),yen=n=>Number(n).toLocaleString('ja-JP')+'円',pct=n=>n==null?'—':(100*n).toFixed(1)+'%',stamp=t=>new Date(t).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}),names={physical:'成立条件修正版',roi_coverage:'ROI分散選択',causal:'因果展開・従来'},states={pending:'結果待ち',awaiting_payout:'払戻待ち',missed:'発走前保存なし',excluded:'照合除外',error:'保存エラー',pending_capture:'保存待ち'};
function node(tag,text,cls){const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;}
function table(target,groups){const t=document.createElement('table'),head=document.createElement('tr');for(const s of ['区分','照合済','的中','的中率','投資','払戻','回収率'])head.append(node('th',s));t.append(head);for(const [k,s] of Object.entries(groups)){const tr=document.createElement('tr');for(const text of [names[k]||k,s.evaluated,s.hits,pct(s.hit_rate),yen(s.stake),yen(s.payout),pct(s.roi)])tr.append(node('td',text));t.append(tr);}$(target).replaceChildren(t);}
function metrics(s){$('metrics').replaceChildren(...[['照合済レース',s.evaluated+' R'],['的中率',pct(s.hit_rate)],['回収率',pct(s.roi)],['収支',yen(s.net)],['投資',yen(s.stake)],['払戻',yen(s.payout)]].map(([label,value])=>{const d=node('div',label,'metric');d.append(node('strong',value));return d;}));$('coverage').textContent=`対象 ${s.races} R ／ 予想保存 ${s.saved} R ／ 結果待ち ${s.pending} R ／ 払戻待ち ${s.awaiting_payout} R ／ 保存なし ${s.missed} R ／ 除外 ${s.excluded} R ／ エラー ${s.error} R`;$('trimmed').textContent=s.without_max?`最大払戻の1レースを除いた回収率：${pct(s.without_max.roi)}`:'最大払戻除外の成績は照合後に表示します。';}
const dataRoot='https://raw.githubusercontent.com/takashikamei2504-sys/tk-keirin-lab/main/';
let data;
function compareRaces(a,b){
 return b.date.localeCompare(a.date)
  || a.venue.localeCompare(b.venue,'ja')
  || Number(a.race_no)-Number(b.race_no);
}
function render(){const date=$('day').value,engine=$('filter').value,rows=data.rows.filter(r=>(!date||r.date===date)&&(!engine||r.engine===engine)).sort(compareRaces);$('day-summary').textContent=rows.length+'レース';$('races').replaceChildren(...rows.map(r=>{const d=node('article','','race-row'),e=r.evaluation;d.append(node('h3',`${r.date} ${r.venue} ${r.race_no}R ${r.start}`),node('p',`${r.category||'級班不明'} ／ ${r.label||'エンジン未取得'}`));d.append(node('p',e.status==='evaluated'?`${e.hit?'的中':'不的中'} ／ ${e.category} ／ 投資 ${yen(e.stake)} → 払戻 ${yen(e.payout)} ／ 収支 ${yen(e.net)}`:(states[e.status]||e.status)+(e.status==='excluded'||e.status==='error'?'：'+e.category:''),e.hit?'win':''));if(r.tickets)d.append(node('p','保存買い目：'+r.tickets.join(' ／ '),'keys'));if(r.result?.length)d.append(node('p','結果：'+r.result.map(c=>c.key+' '+(c.payout==null?'払戻待ち':yen(c.payout))).join(' ／ ')));if(r.saved_at){d.append(node('p','保存：'+stamp(r.saved_at),'muted'));const a=node('a','保存した予想・根拠を見る（JSON）');a.href=dataRoot+'data/routed_history/'+r.record;d.append(a);}return d;}));}
async function json(url){let error;for(const source of [dataRoot+url,url])try{const r=await fetch(source+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}catch(e){error=e;}throw error;}
Promise.all([json('data/routed_history/evaluation.json'),json('data/routed_history/status.json')]).then(([d,s])=>{
 data=d;if(d.schema!=='tk-keirin-routed-evaluation/v1'||!Array.isArray(d.rows))throw Error('評価データの形式が不正');
 const errors=[...(s.errors||[]),...(d.errors||[]),...(s.collections||[]).flatMap(c=>c.errors||[])],age=Date.now()-Date.parse(s.generated_at),today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),todayFeed=s.collections?.find(c=>c.date===today);
 $('health').textContent=age>2*3600000?'更新から2時間以上経過しています。稼働状況を確認してください。':todayFeed?.feed==='not_available'?'本日の出走表はまだ配信されていません。':errors.length?`自動収集を実行済み。取得・照合エラー ${errors.length}件。保存済みの予想は保持しています。`:'自動収集を実行済み。次回も保存と結果照合を続けます。';
 const check=s.last_result_check,checkedAt=s.last_result_attempt_at;
 const labels={complete:'完了',results_pending:'結果・払戻待ち（自動再試行）',source_stale:'配信更新待ち（自動再試行）',source_missing:'配信未取得（自動再試行）',source_error:'取得失敗（自動再試行）'};
 const resultHealth=check?('結果照合 '+(labels[check.state]||'確認中')+' ／ 対象 '+check.race_date+
  ' ／ 確認済 '+(check.evaluated||0)+'R'+(check.unresolved?' ／ 未確定 '+check.unresolved+'R':'')+
  (checkedAt?' ／ 最終試行 '+stamp(checkedAt):'')):
  '結果照合：初回確認待ち';
 $('updated').textContent='自動保存更新：'+stamp(s.generated_at)+' ／ '+resultHealth;metrics(d.summary);for(const [target,key] of [['engines','by_engine'],['categories','by_category'],['days','by_date'],['models','by_model']])table(target,d[key]);
 const dates=Object.keys(d.by_date).sort().reverse();$('day').append(new Option('全期間',''),...dates.map(date=>new Option(date,date)));$('day').value=dates.includes(today)?today:dates[0]||'';
 for(const k of Object.keys(d.by_engine))$('filter').append(new Option(names[k]||k,k));$('day').addEventListener('change',render);$('filter').addEventListener('change',render);render();$('report').hidden=false;
}).catch(e=>{$('health').textContent='自動保存データを取得できません。初回の保存処理完了後に再読み込みしてください。';$('health').className='error';console.error(e);});
})();
