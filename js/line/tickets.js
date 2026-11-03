/* Ticket count follows hypotheses, never a target count. */
(function(root){'use strict';
function generate(main,alternatives){
 const tickets=[],seen=new Map(),reviews=[];
 for(const h of [main,...alternatives]){
  const primary=h.id===main.id,gap=main.score-h.score;
  if(!h.audit?.passed||(!primary&&gap>.35+1e-10)){reviews.push({hypothesis:h.id,accepted:false,gap,reason:!h.audit?.passed?'局面の整合性検査を通過していない':'本線との比較差が採用範囲を超える'});continue;}
  const events=h.scenes.flatMap(s=>s.events).filter(e=>['pass','resist','yield','long','kamashi','short','counter','relaunch','inside','seat_won'].includes(e.action));let added=0;
  for(const third of h.finish.thirds){const trio=[...h.finish.pair,third.no],key=trio.join('-');if(new Set(trio).size!==3||!third.reason)continue;
   if(seen.has(key)){seen.get(key).supporting_hypotheses.push(h.id);continue;}
   const t={trio,key,hypothesis:h.id,supporting_hypotheses:[h.id],group:primary?'main':'alternative',reason:primary?third.reason:`${h.finish.mode}の独立仮説：${events.map(e=>e.reason).join('。')}。${third.reason}`};tickets.push(t);seen.set(key,t);added++;
  }
  reviews.push({hypothesis:h.id,accepted:true,gap,added,reason:primary?'本線の主要決着と根拠のある3着候補':'整合性を満たす別展開と根拠のある3着候補'});
 }
 return {tickets,policy:{method:'hypothesis-derived-v2',comparison_margin:.35,fixed_count:false,reviews,note:'点数を埋める処理や一律の点数上限を設けない。比較差の閾値は未校正。'}};
}
const api={generate};if(typeof module!=='undefined')module.exports=api;root.LineTickets=api;
})(typeof globalThis!=='undefined'?globalThis:this);
