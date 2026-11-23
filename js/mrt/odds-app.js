/* MRT odds-on-demand UI: no forecast mutation or automated betting. */
(function(){'use strict';
const $=id=>document.getElementById(id),O=MRTOddsReallocate;
const yen=n=>Number(n).toLocaleString('ja-JP')+'円';
let last=null,sequence=0;
const status=(s)=>{$('odds-status').textContent=s};
const endpoint=String(window.MRT_ODDS_API_URL||'').replace(/\/$/,'');
function clear(){
 sequence++;last=null;$('odds-result').hidden=true;$('odds-copy').disabled=true;
 status(endpoint?'予想を表示したら、取得ボタンでその時点のオッズを確認できます。':'オッズ取得APIの接続設定待ちです。現在はボタンで取得できません。');
}
const fields=['date','race','mode','line','rule'];
for(const id of fields)$(id).addEventListener('change',clear);
$('refresh').addEventListener('click',clear);
$('generate').addEventListener('click',clear);
// The original prediction is kept on the page, unchanged. This panel is separate.
const button=$('odds-refresh');
button.disabled=!endpoint;
function display(plan){
 const result=$('odds-result'),summary=$('odds-summary'),body=$('odds-ticket-rows');
 const variant=$('odds-budget').value,base=variant==='100'?plan.baseline:variant==='3000'?plan.cap3000:plan.cap5000;
 summary.textContent='三連単 '+base.tickets.length+'点 ／ 投資 '+yen(base.stake)+' ／ 予算上限 '+yen(variant==='100'?base.stake:Number(variant))+
  ' ／ 残額 '+yen(variant==='100'?0:base.unspent)+'。オッズ更新 '+new Date(plan.odds_published_at).toLocaleString('ja-JP')+
  ' ／ 取得 '+new Date(plan.odds_captured_at).toLocaleString('ja-JP');
 body.replaceChildren();
 for(const t of base.tickets){
   const tr=document.createElement('tr');
   for(const v of [t.cars.join('-'),yen(t.yen),t.odds.toFixed(1)+'倍']){
     const td=document.createElement('td');td.textContent=v;tr.append(td);
   }body.append(tr);
 }
 $('odds-source').href=plan.source_url;
 result.hidden=false;
 status('取得時点の公開オッズで試算しました。購入可否の推奨ではありません。');
}
$('odds-budget').addEventListener('change',()=>{if(last)display(last)});
button.addEventListener('click',async()=>{
 const id=++sequence;
 const ctx=window.mrtCurrentContext?.();
 last=null;$('odds-result').hidden=true;$('odds-copy').disabled=true;
 if(!ctx){status('先に「この条件で買い目を生成」を押してください。');return;}
 const {payload,shown,row,line,rule}=ctx;
 if(MRTManualB.eligibility(payload,row)){status('見送り：予想の入力が古いか締切済みです。出走情報を更新してください。');return;}
 if(!endpoint){status('オッズ取得APIが未接続です。');return;}
 button.disabled=true;status('公開オッズを取得・検証しています。');
 try{
   const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),24000);
   let response;
   try{
     response=await fetch(endpoint+'/api/mrt/live-odds',{method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({race_id:payload.race_id,mode:line===null?'automatic':'manual',line,rule}),cache:'no-store',signal:ctl.signal});
   }finally{clearTimeout(timer)}
   const quote=await response.json();
   if(!response.ok)throw Error(quote.error||'HTTP '+response.status);
   if(id!==sequence)return;
   const current=window.mrtCurrentContext?.();
   if(!current||current.payload!==payload||current.shown!==shown||current.line!==line||current.rule!==rule)return;
   const plan=O.build(payload,shown,quote,line,rule);
   if(id!==sequence)return;
   last=plan;display(plan);$('odds-copy').disabled=false;
 }catch(e){if(id===sequence)status('取得不可・見送り：'+e.message+'。以前のオッズで代用しません。')}
 finally{button.disabled=!endpoint}
});
$('odds-copy').addEventListener('click',async()=>{
 if(!last||Date.now()>=Date.parse(last.sales_close_at)-30000||
    Date.now()-Date.parse(last.odds_published_at)>300000){clear();status('オッズが期限切れです。再取得してください。');return;}
 const variant=$('odds-budget').value,p=variant==='100'?last.baseline:variant==='3000'?last.cap3000:last.cap5000;
 const text='MRT参考再配分 '+last.race_id+'\n'+p.tickets.map(t=>t.cars.join('-')+' '+yen(t.yen)+' '+t.odds+'倍').join('\n')+
  '\n投資 '+yen(p.stake)+'\nオッズ更新 '+last.odds_published_at+'\n研究用・購入推奨ではありません';
 try{await navigator.clipboard.writeText(text);status('参考配分をコピーしました。')}catch(e){status('コピーできません。個別表から確認してください。')}
});
setInterval(()=>{if(last && (Date.now()>=Date.parse(last.sales_close_at)-30000||Date.now()-Date.parse(last.odds_published_at)>300000)){
 clear();status('オッズが失効しました。再取得してください。');
}},15000);
clear();
})();