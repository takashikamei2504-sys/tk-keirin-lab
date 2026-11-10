(function(){'use strict';
const $=id=>document.getElementById(id),
 jp=n=>Number(n||0).toLocaleString('ja-JP'),
 yen=n=>jp(n)+'円',pct=n=>n==null?'未集計':(100*n).toFixed(1)+'%',
 stamp=t=>t?new Date(t).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}):'記録なし',
 node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=String(text);if(cls)e.className=cls;return e},
 root='https://raw.githubusercontent.com/takashikamei2504-sys/tk-keirin-lab/main/';
let data=null;
async function json(file){let error;for(const base of [root,''])try{const r=await fetch(base+file+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}catch(e){error=e;}throw error}
function metric(label,value){const a=node('div',label,'metric');a.append(node('strong',value));return a}
const modeName={baseline:'能力・基準',tactical:'Bライン・展開補正'},statusName={pending:'結果待ち',awaiting_payout:'払戻待ち',excluded:'照合対象外',evaluated:'照合済み'};
function table(id,stats){
 const t=node('table'),h=node('tr');
 for(const s of ['方式','レース','的中','万車的中','平均点数','回収率','最大払戻除外'])h.append(node('th',s));
 t.append(h);
 for(const mode of ['baseline','tactical'])for(const variant of ['A','B','C']){
  const v=stats?.by_variant?.[mode+'/'+variant],tr=node('tr');
  for(const s of [modeName[mode]+' '+variant,v?.races??'0',v?.hits??'0',v?.high_hits??'0',v?.avg_points?.toFixed(1)??'―',pct(v?.roi),pct(v?.roi_without_max)])tr.append(node('td',s));
  t.append(tr);
 }
 $(id).replaceChildren(t);
}
const dayKey=r=>r.date+' '+r.venue+' '+r.race_no+'R',sep=' ／ ';
function show(){
 if(!data)return;
 const dt=$('day').value,only=$('risk-only').checked;
 const rows=data.rows.filter(x=>(!dt||x.date===dt)&&(!only||x.risk?.priority))
  .sort((a,b)=>b.date.localeCompare(a.date)||a.venue.localeCompare(b.venue,'ja')||a.race_no-b.race_no);
 $('row-count').textContent=rows.length+'レース'+(rows.length>80?'（先頭80レースを表示）':'');
 const frag=document.createDocumentFragment();
 for(const r of rows.slice(0,80)){
  const a=node('article',null,'race');
  const h=node('h3',dayKey(r));a.append(h);
  const e=r.evaluation||{},rating=node('p',
   '万車推定 '+(r.risk?.percent?.toFixed(1)??'―')+'%　'+(r.risk?.band||'―')+
   '　'+(r.cat||'')+'　'+r.cars+'車','tags');a.append(rating);
  a.append(node('p',(statusName[e.status]||e.status||'結果待ち')+
   (e.status==='evaluated'?' ／ 確定 '+(e.actual||[]).map(x=>x.key+' '+yen(x.payout)).join(sep):'')));
  for(const m of r.modes||[]){
   const details=node('details'),summary=node('summary',modeName[m.name]+' ／ 別線の1・2着ペアと買い目');
   details.append(summary);
   details.append(node('p','上位ペア：'+(m.pairs||[]).slice(0,3).map(x=>
    x.key+(x.path_ids?.length?'（展開根拠'+x.path_ids.length+'経路）':'')).join('、'),'small'));
   for(const v of m.variants||[]){
    const d=node('div',null,'variant'),s=e.by_mode?.[m.name]?.[v.id];
    d.append(node('strong',v.id+'｜'+v.label+'｜'+v.tickets.length+'点'));
    d.append(node('p','三連単：'+v.tickets.join(sep),'tickets'));
    if(s)d.append(node('p',(s.hit?'的中':'不的中')+'　投資 '+yen(s.stake)+' ／ 払戻 '+yen(s.payout),'small '+(s.hit?'statusok':'muted')));
    if(v.scope?.includes('14点'))d.append(node('p','14点・上限超過のため研究比較のみ','small statusbad'));
    const path=v.evidence?.filter(x=>x.why?.length).slice(0,1);
    if(path?.length)d.append(node('p','展開根拠：'+path[0].why[0],'small'));
    details.append(d);
   }
   a.append(details);
  }
  a.append(node('p','固定保存 '+stamp(r.saved_at)+' ／ 確定前の買い目は変更しません','tags'));
  frag.append(a);
 }
 $('races').replaceChildren(frag);
}
Promise.all([json('data/routed_history/mansha_shadow_evaluation.json'),
 json('data/routed_history/mansha_shadow_status.json')]).then(([d,s])=>{
 if(d.schema!=='tk-keirin-mansha-shadow-evaluation/v1'||!Array.isArray(d.rows))throw Error('保存形式が異なります');
 data=d;
 const age=Date.now()-Date.parse(s.generated_at);
 $('health').textContent=age>2*3600000?'最終更新から2時間以上経過しています。GitHub Actionsをご確認ください。':
  s.summary?.errors?'万車予想は実行中。保存・照合エラー '+s.summary.errors+'件をご確認ください。':'万車シャドーを自動保存・結果照合しています。';
 $('updated').textContent='最終更新 '+stamp(d.generated_at)+' ／ モデル別の計算は仮想成績です';
 $('overview').replaceChildren(
  metric('保存済レース',d.summary.saved+' R'),metric('照合済レース',d.summary.evaluated+' R'),
  metric('万車リスク上位',d.risk_high.saved+' R'),metric('結果待ち',d.summary.pending+' R'));
 table('all-summary',d.summary);table('risk-summary',d.risk_high);
 const dates=[...new Set(d.rows.map(x=>x.date))].sort().reverse();
 $('day').append(...dates.map(date=>new Option(date,date)));
 $('day').value=dates[0]||'';
 $('day').addEventListener('change',show);$('risk-only').addEventListener('change',show);show();
}).catch(e=>{$('health').textContent='万車シャドーの初回保存・公開待ちです。通常予想と結果照合は別に稼働します。';
 $('health').className='statusbad';console.error(e);});
})();