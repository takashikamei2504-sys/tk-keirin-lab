/* MRT V3 independent odds reallocation (research only, no bet execution). */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MRTOddsReallocate=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
const assert=(v,msg)=>{if(!v)throw Error(msg)};
const key=t=>t.cars.join('-');
const condition=(line,rule)=>line===null?'auto':line+':'+rule;
function check(p,out,quote,line=null,rule='leader',now=Date.now()){
 assert(p&&out&&quote?.schema==='tk-mrt-odds-quote/v1','オッズ応答形式が不正です');
 assert(quote.race_id===p.race_id&&quote.identity_sha256===p.identity_sha256&&quote.model_sha256===p.model_sha256,'レースまたは予想版が不一致です');
 assert(quote.condition===condition(line,rule),'Bライン指定が一致しません');
 assert(quote.market==='trifecta'&&quote.state==='live'&&quote.reference_only===true,'購入可能なオッズではありません');
 assert(typeof quote.source_url==='string'&&/^https:\/\/www\.winticket\.jp\/keirin\//.test(quote.source_url),'オッズ出典を確認できません');
 const a=Date.parse(quote.published_at),b=Date.parse(quote.captured_at),c=Date.parse(quote.sales_close_at),limit=Date.parse(p.sales_close_at);
 assert([a,b,c,limit].every(Number.isFinite) && a<=b && b<=now+10000 && now-a<=300000 && now>=b-10000,'オッズが古いか取得時刻が不正です');
 assert(now<c-30000 && c<=limit,'発売締切直前または締切済みです');
 assert(Array.isArray(out.tickets)&&out.tickets.length>0&&out.tickets.length<=100,'買い目が確認できません');
 assert(quote.odds && Object.getPrototypeOf(quote.odds)===Object.prototype,'オッズ形式が不正です');
 for(const t of out.tickets){
   const o=quote.odds[key(t)];
   assert(Number.isFinite(o)&&o>=1&&o<=1e7,'一部の三連単オッズが未取得です');
   assert(Number.isFinite(t.allocation_score)&&t.allocation_score>0,'モデル順位スコアが不正です');
 }
 return true;
}
function allocate(out,quote,budget=5000){
 assert(Number.isInteger(budget)&&budget>=100&&budget<=5000&&budget%100===0,'上限は5,000円、100円単位です');
 const bets=out.tickets;
 const base=bets.length*100;
 if(budget<base)throw Error('予算が購入点数の最低100円を下回っています');
 // Scores are only uncalibrated relative ordering, NOT winning probabilities.
 // Use odds to rebalance *within the model-selected tickets*; no EV claims.
 const values=bets.map(t=>{
   const score=t.allocation_score;
   const odd=quote.odds[key(t)];
   // Clip extreme long shots to avoid excessive stakes from unstable quotes.
   return Math.pow(score,0.7)*Math.sqrt(Math.min(odd,30));
 });
 const weights=values.map(x=>x/values.reduce((a,b)=>a+b,0));
 const units=budget/100, cap=Math.max(1,Math.floor(units*0.20)),alloc=weights.map(()=>1);
 let left=units-bets.length;
 while(left>0){
   const candidates=alloc.map((n,i)=>({i,room:n<cap,shortfall:(units*weights[i])-n})).filter(v=>v.room);
   if(!candidates.length)break;
   candidates.sort((a,b)=>b.shortfall-a.shortfall||a.i-b.i);
   alloc[candidates[0].i]++;left--;
 }
 const tickets=bets.map((t,i)=>({...t,yen:alloc[i]*100,odds:quote.odds[key(t)],relative_score:t.allocation_score}));
 return {budget_cap:budget,stake:tickets.reduce((a,t)=>a+t.yen,0),tickets,
   unspent:left*100,method:'odds_weighted_relative_score_v1',purchase_eligible:false};
}
function build(p,out,quote,line=null,rule='leader',now=Date.now()){
 check(p,out,quote,line,rule,now);
 const flat=out.tickets.map(t=>({...t,yen:100,odds:quote.odds[key(t)],relative_score:t.allocation_score}));
 return {schema:'tk-mrt-odds-reallocation/v1',generated_at:new Date(now).toISOString(),
    source_url:quote.source_url,odds_published_at:quote.published_at,odds_captured_at:quote.captured_at,
    sales_close_at:quote.sales_close_at,race_id:p.race_id,condition:condition(line,rule),
    baseline:{stake:flat.length*100,tickets:flat},cap3000:allocate(out,quote,3000),
    cap5000:allocate(out,quote,5000),calibrated_probability:false,
    status:'research_only',message:'相対スコアと最新取得オッズによる参考配分です。スコアは的中確率ではなく、期待値・利益を保証しません。購入・見送りの推奨には使えません。'};
}
return {check,allocate,build,condition};
});