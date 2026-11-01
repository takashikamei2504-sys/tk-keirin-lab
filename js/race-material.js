/* Only pre-race, identity-matched S measurements and same-race comments are attached. */
(function(root){'use strict';
const norm=s=>String(s||'').replace(/[\s\u3000]/g,'');
function attach(r,pack={},now=Date.now()){
 const cutoff=Date.parse(`${r.date}T${r.start}:00+09:00`),cards=pack.schema==='tk-keirin-race-material/v1'?pack.cards||[]:[];
 const eligible=cards.filter(c=>Date.parse(c.collected_at)<cutoff&&Date.parse(c.collected_at)<=now&&cutoff-Date.parse(c.collected_at)<=72*3600000&&c.date<=r.date&&/^https:\/\/keirin\.tokyo-sports\.co\.jp\/list\/race\//.test(c.source_url||''));
 let covered=0;
 const riders=r.riders.map(x=>{
  const matches=eligible.flatMap(c=>c.riders.filter(y=>norm(y.name)===norm(x.name)&&Number.isInteger(y.s)&&y.s>=0&&((y.verified_identity===true&&x.meta?.rider_id&&String(y.rider_id).padStart(6,'0')===String(x.meta.rider_id).padStart(6,'0'))||(c.date===r.date&&c.venue===r.venue&&c.race_no===r.race_no&&y.no===x.no))).map(y=>({card:c,row:y}))).sort((a,b)=>Date.parse(b.card.collected_at)-Date.parse(a.card.collected_at));
  if(!matches.length)return {...x};const {card,row}=matches[0];covered++;
  return {...x,s:row.s,s_source:{url:card.source_url,collected_at:card.collected_at,period:card.period,identity_basis:row.identity_basis||'同一レース・車番・フルネームを照合'},meta:{...x.meta,term:x.meta?.term||row.term,prefecture:x.meta?.prefecture||row.prefecture,rank:x.meta?.rank||row.rank,s_measured:true,absent_fields:(x.meta?.absent_fields||[]).filter(k=>k!=='s')}};
 });
 const sameRace=eligible.filter(c=>c.date===r.date&&c.venue===r.venue&&c.race_no===r.race_no&&c.riders.length===r.riders.length&&c.riders.every(y=>r.riders.some(x=>x.no===y.no&&norm(x.name)===norm(y.name))));
 const latest=new Map(),raceId=`${r.date}:${r.venue}:${r.race_no}`;
 for(const card of sameRace.slice().sort((a,b)=>Date.parse(a.collected_at)-Date.parse(b.collected_at)))for(const note of card.comments||[]){
  const pub=Date.parse(note.published_at),col=Date.parse(note.collected_at);
  if(note.body_verified!==true||note.url!==card.source_url||note.race_id!==raceId||!(pub<=col&&col<=Date.parse(card.collected_at)&&col<cutoff&&col<=now)||!r.riders.some(x=>norm(x.name)===norm(note.rider)))continue;
  latest.set(norm(note.rider),note);
 }
 const comments=[...latest.values()],conflicts=[],checks=[];
 for(const c of comments){
  const actor=r.riders.find(x=>norm(x.name)===norm(c.rider)),line=r.lineup.find(l=>l.includes(actor.no)),at=line?.indexOf(actor.no);
  if(c.lineup_intention==='compete'){conflicts.push(`${c.rider}は競り・直付けを表明。現在の一本のライン表現では扱えないため並び確認が必要`);continue;}
  if(c.lineup_intention==='solo'&&line?.length!==1)conflicts.push(`${c.rider}の単騎コメントと配信の並びが不一致`);
  else if(c.lineup_intention==='unfixed'&&at>0)conflicts.push(`${c.rider}は位置を決めずと表明し、固定の追走先を置けない`);
  else if(c.follow_no&&(!line||!line.includes(c.follow_no)||line.indexOf(c.follow_no)>=at||(c.follow_position==='immediate'&&line[at-1]!==c.follow_no)))conflicts.push(`${c.rider}の追走先コメントと配信の並びが不一致`);
  else if(c.follow_no||c.lineup_intention==='solo')checks.push({no:actor.no,statement:c.declaration,follow_no:c.follow_no||null,url:c.url,collected_at:c.collected_at});
 }
 return {...r,riders,race_material:{covered,total:riders.length,comments,lineup_conflicts:[...new Set(conflicts)],lineup_checks:checks,generated_at:pack.generated_at||null}};
}
const api={attach};if(typeof module!=='undefined')module.exports=api;root.RaceMaterial=api;
})(typeof globalThis!=='undefined'?globalThis:this);
