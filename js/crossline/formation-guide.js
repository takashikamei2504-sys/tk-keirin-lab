/* Exact, zero-extra-ticket trifecta formation guide. No betting-site automation. */
(function(root){'use strict';
function validTickets(tickets){
 return Array.isArray(tickets)&&tickets.length===4&&new Set(tickets).size===4&&
 tickets.every(t=>typeof t==='string'&&/^[1-9]-[1-9]-[1-9]$/.test(t)&&new Set(t.split('-')).size===3);
}
function cartesian(first,second,third){
 const output=[];
 for(const a of first)for(const b of second)for(const c of third){
  if(a===b||a===c||b===c)return null; // Never rely on an app silently discarding invalid picks.
  output.push([a,b,c].join('-'));
 }
 return output;
}
function exactFormations(tickets){
 if(!validTickets(tickets))throw Error('異なる三連単4点が必要です');
 const target=new Set(tickets);
 const rows=tickets.map(t=>t.split('-'));
 const set=(index)=>[...new Set(rows.map(t=>t[index]))].sort((a,b)=>+a- +b);
 const first=set(0),second=set(1),third=set(2);
 const single=cartesian(first,second,third);
 let formations;
 if(single&&single.length===4&&single.every(t=>target.has(t))){
  formations=[{first,second,third,tickets:single}];
 }else{
  const byPair=new Map();
  for(const t of rows){const key=t[0]+'-'+t[1];if(!byPair.has(key))byPair.set(key,[]);byPair.get(key).push(t[2]);}
  formations=[...byPair.entries()].map(([pair,third])=>{
   const [a,b]=pair.split('-');
   const f={first:[a],second:[b],third:third.slice().sort((x,y)=>+x- +y)};
   const expanded=cartesian(f.first,f.second,f.third);
   if(!expanded||expanded.length!==third.length)throw Error('フォーメーションの変換に失敗');
   return {...f,tickets:expanded};
  });
 }
 const expanded=formations.flatMap(f=>f.tickets);
 if(expanded.length!==4||new Set(expanded).size!==4||expanded.some(t=>!target.has(t)))throw Error('元の4点と一致しません');
 return {formations,points:4,stake:400,tickets:tickets.slice(),exact:true};
}
function guideText(tickets){
 const result=exactFormations(tickets);
 return result.formations.map((f,i)=>'フォーメーション'+(i+1)+': 1着 '+f.first.join('・')+' / 2着 '+f.second.join('・')+' / 3着 '+f.third.join('・')+
 '（'+f.tickets.length+'点）').join('\n')+'\n合計4点・各100円・400円\n余分な買い目なし。投票画面で4点と金額を確認してください。';
}
const api={validTickets,exactFormations,guideText};
if(typeof module!=='undefined')module.exports=api;
root.CrosslineFormationGuide=api;
})(typeof globalThis!=='undefined'?globalThis:this);
