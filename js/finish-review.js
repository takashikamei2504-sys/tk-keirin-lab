/* Independent lead-versus-chase finish comparison from the complete path.
 * Exposure and effort are symbolic workload indices, never measured metres. */
(function(root){'use strict';
function build(r,{ability,trait}){
 const by=new Map(r.riders.map(x=>[x.no,x])),who=n=>n+'番'+by.get(n).name;
 function assess(s){
  const leader=s.leader,defender=s.defender,weights=[0,.20,.35,.25,.20];
  const exposure=s.scenes.slice(0,5).reduce((n,x,i)=>n+(x.order[0]===leader?weights[i]:0),0);
  const contests=s.decisions.filter(d=>d.actor===leader&&((d.choice==='resist'||d.choice.endsWith(':kamashi'))||d.key==='home-front-response'&&d.choice==='resist'||d.key==='back-front-response'&&d.choice==='resist')).length;
  const threats=(s.outside||[]).filter(n=>n!==leader).length+(s.survivingAttack?1:0);
  const rows=r.riders.map(x=>{
   const no=x.no,position=s.order.indexOf(no)+1,spent=s.energy[no]||0,finish=trait(no,'finish',{...s,stage:5}),tracking=trait(no,'track',{...s,stage:5});
   const leadLoad=no===leader?exposure*.18+contests*.025:0;
   const followLoad=no===defender?spent*.08+(1-tracking)*.04+(s.defense==='block'?.055:0):0;
   const saved=no===defender?exposure*.16:0,reaccel=no===leader?trait(no,'resist',{...s,stage:5})*.10:0;
   const score=ability(no)*.48+finish*.25-spent*.30-(position-1)*.06-leadLoad-followLoad+saved+reaccel+(no===s.innerRider?.12:0)+(no===s.survivingAttack?.12:0)+(no===defender&&s.defense==='vertical'?.04:0)-(no===leader?threats*.025:0);
   return {no,score,position,spent,finish,tracking,lead_load:leadLoad,follow_load:followLoad,saved,reacceleration:reaccel};
  });
  const lead=rows.find(x=>x.no===leader),chaser=rows.find(x=>x.no===defender),difference=chaser?lead.score-chaser.score:null;
  const summary=chaser?`${who(leader)}は${exposure>=.7?'前半から長く主導権を担った負担':exposure<=.4?'後半に主導権を奪って踏む区間を短くできた利点':'主導権を握ってからの消耗'}と踏み直しを評価する。${who(defender)}は追走の負担${s.defense==='block'?'と横の仕事の消耗':''}を差し引き、先行の残り脚と直線の伸びを比較する。`:`${who(leader)}の先行負担と、後続が外から届く位置・余力を比べる。`;
  return {schema:'tk-finish-review/v1',leader,defender,exposure,contests,threats,rows,pair:chaser?{lead_first:[leader,defender],chase_first:[defender,leader],difference,favored:difference>=0?'lead':'chase',scope:'first-two comparison; not outcome probability'}:null,summary};
 }
 function explain(review,trio){const [first,second]=trio,pair=review.pair;if(!pair)return review.summary;
  if(first===review.leader&&second===review.defender)return review.summary+`${who(first)}の踏み直しと残り脚を上に取り、${who(second)}の差しを退ける決着を選ぶ。`;
  if(first===review.defender&&second===review.leader)return review.summary+`${who(first)}が前で脚を使った${who(second)}を直線で差し切る決着を選ぶ。`;
  return review.summary+`${who(first)}が位置と直線の脚色を生かし、${who(second)}より先着すると読む。`;
 }
 return {assess,explain};
}
const api={build};if(typeof module!=='undefined')module.exports=api;root.FinishReview=api;
})(typeof globalThis!=='undefined'?globalThis:this);
