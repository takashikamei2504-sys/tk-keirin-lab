/* Pre-bell strategic game: compare leaders' incentives AND opponents' response
 * before choosing the first attacking line. This is a heuristic thought
 * experiment, not inferred rider intention or calibrated probability.
 */
(function(root){'use strict';
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
function build(r,context,{ability,trait}){
 const by=new Map(r.riders.map(x=>[x.no,x])),leaders=r.lineup.map(l=>l[0]);
 const lines=new Map(r.lineup.map(l=>[l[0],l]));
 const ctx=new Map((context.lines||[]).map(x=>[x.leader,x]));
 const who=n=>n+'番'+(by.get(n)?.name||'');
 function backRate(n){
  const x=by.get(n),recent=x.recent_form?.stats;
  // Use only the already attached race input, never any result or web call.
  if(Number.isFinite(recent?.total)&&recent.total>=8&&Number.isFinite(recent?.b))
   return {rate:clamp(recent.b/recent.total,0,1),source:'recent_form'};
  // No denominator = no reliable per-start B rate. Leave it neutral.
  return {rate:null,source:'unavailable'};
 }
 function profile(n,s){
  const x=by.get(n),line=lines.get(n),p=s.order.indexOf(n),b=backRate(n);
  const self=x.style==='逃'?.70:x.style==='両'?.40:.18;
  const long=(trait(n,'kamashi',s)+trait(n,'resist',s))*.5;
  const sustained=b.rate===null?0:clamp((b.rate-.23)*1.1,-.24,.24);
  const urgency=clamp((p-1)*.025,0,.13);
  return {no:n,position:p+1,support:line.length-1,style:x.style,ability:ability(n),
   leadPreference:clamp(self*.42+long*.30+sustained+urgency+(ctx.get(n)?.motivation||0)*.18,.1,.85),
   bRate:b.rate,bSource:b.source};
 }
 function review(s,choices){
  const profiles=leaders.map(n=>profile(n,s));
  const start=s.front,front=profiles.find(p=>p.no===start);
  // Competing incentives are symmetric: rank all other lines before choosing.
  const others=profiles.filter(p=>p.no!==start);
  const strongest=others.slice().sort((a,b)=>b.leadPreference-a.leadPreference||a.no-b.no)[0];
  const rows=choices.map(c=>{
   if(c.key==='wait'){
    const frontBenefit=.28+front.leadPreference*.45;
    const threat=others.length?Math.max(...others.map(p=>p.leadPreference)):.2;
    const utility=frontBenefit-.16*threat;
    return {key:c.key,actor:null,tactic:'wait',utility,immediate:'前受け側が先に主導権を作る',
     opponent:strongest?who(strongest.no)+'が赤板から上昇するなら待機は崩れる':'別線なし',
     rival:strongest?.no||null,profile:null};
   }
   const n=c.actor,p=profiles.find(x=>x.no===n),tactic=c.key.split(':')[1],fp=front;
   if(!p)return {key:c.key,actor:n,tactic,utility:-1,immediate:'ライン先頭ではない',opponent:'',rival:null,profile:null};
   const powerEdge=clamp(p.ability-fp.ability,-.6,.6);
   const fromRear=p.position>=6;
   // An early press and a full-speed kamashi solve different tactical needs.
   const press=.34+p.leadPreference*.30+(.23-p.leadPreference)*.14+
    (p.position>=4?.12:.02)+(p.support>=1?.04:0)+powerEdge*.10;
   const kamashi=.10+p.leadPreference*.60+powerEdge*.25+
    (p.support>=1?.035:0)-(fromRear?.08:0)-
    (p.bRate!==null&&p.bRate<=.055?.16:0);
   let utility=tactic==='kamashi'?kamashi:press;
   // The front rider can oppose, and other leaders need not surrender.
   const frontResistance=clamp(fp.leadPreference*.30+Math.max(0,fp.ability-p.ability)*.20,.04,.37);
   utility-=tactic==='kamashi'?frontResistance:.38*frontResistance;
   const third=others.filter(x=>x.no!==n).sort((a,b)=>b.leadPreference-a.leadPreference||a.no-b.no)[0];
   if(third){
    const contest=clamp(third.leadPreference*.18+Math.max(0,third.ability-p.ability)*.07,0,.22);
    utility-=contest;
   }
   return {key:c.key,actor:n,tactic,utility,immediate:tactic==='kamashi'?'一気に主導権を奪う':'前を押さえて好位置を作る',
    opponent:who(start)+'の'+(front.leadPreference>=.42?'突っ張り':'引いて捲り返し')+'を想定',
    rival:third?.no||null,thirdResponse:third?who(third.no)+'が先に動いたラインを利用して反撃する筋も比較':null,
    profile:p};
  });
  const viable=rows.filter(z=>choices.find(c=>c.key===z.key)?.feasibility!=='blocked');
  const best=viable.slice().sort((a,b)=>b.utility-a.utility||a.key.localeCompare(b.key))[0];
  const min=viable.length?Math.min(...viable.map(x=>x.utility)):0;
  const assessments=new Map(rows.map(x=>{
   const regret=Math.max(0,(best?.utility??0)-x.utility);
   const multiplier=clamp(Math.exp((x.utility-(best?.utility??0))*2.5),.36,1);
   // Preserve alternatives; lower plausibility is not a physical prohibition.
   const compared=viable.filter(t=>t.key!==x.key).sort((a,b)=>b.utility-a.utility).slice(0,3);
   return [x.key,{phase:'赤板の全ライン駆け引き',phase_key:'red',choice:x.key,actor:x.actor,
    regret:Math.round(regret*1e6)/1e6,passed:true,multiplier,
    selected_reason:x.actor?who(x.actor)+'が'+x.immediate+'。'+x.opponent:
      '前受けが主導権を作る。'+x.opponent,
    rejected:compared.map(c=>({actor:c.actor,tactic:c.tactic,reason:c.immediate,relative:Math.round((x.utility-c.utility)*1000)/1000})),
    opponents:profiles.filter(p=>p.no!==x.actor).map(p=>({no:p.no,position:p.position,leadPreference:p.leadPreference,bRate:p.bRate})),
    comparisons:rows.map(z=>({key:z.key,actor:z.actor,tactic:z.tactic,utility:Math.round(z.utility*1e6)/1e6,opponent:z.opponent,rival:z.rival})),
    objection:regret>.20?'他ラインの先手・反撃を比較すると、より自然な初動がある':null}];
  }));
  return {assessments,profiles,best:best?.key||null,utilityRange:(best?.utility??0)-min};
 }
 return {review};
}
const api={build};
if(typeof module!=='undefined')module.exports=api;
root.CrossLineTactics=api;
})(typeof globalThis!=='undefined'?globalThis:this);
