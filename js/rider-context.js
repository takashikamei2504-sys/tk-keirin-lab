/* Registration facts and attributed public statements; intention is always an inference. */
(function(root){'use strict';
const prefectures={北海道:['函館'],青森:['青森'],福島:['いわき平'],新潟:['弥彦'],群馬:['前橋'],茨城:['取手'],栃木:['宇都宮'],埼玉:['大宮','西武園'],東京:['京王閣','立川'],千葉:['松戸','千葉'],神奈川:['川崎','平塚','小田原'],静岡:['伊東','伊東温泉','静岡'],愛知:['名古屋','豊橋'],岐阜:['岐阜','大垣'],富山:['富山'],三重:['松阪','四日市'],福井:['福井'],奈良:['奈良'],京都:['向日町'],和歌山:['和歌山'],大阪:['岸和田'],岡山:['玉野'],広島:['広島'],山口:['防府'],香川:['高松'],徳島:['小松島'],高知:['高知'],愛媛:['松山'],福岡:['小倉','久留米'],佐賀:['武雄'],長崎:['佐世保'],大分:['別府'],熊本:['熊本']};
const norm=x=>String(x||'').replace(/[\s\u3000]/g,'');
const rank={SS:6,S1:5,S2:4,A1:3,A2:2,A3:1};
function relations(r,pack){
 const cutoff=Date.parse(`${r.date}T${r.start}:00+09:00`),names=new Map(r.riders.map(x=>[norm(x.name),x.no])),seen=new Set();
 return (pack.relationships||[]).filter(e=>{
  const id=[e.rider,e.peer,e.url,e.kind].join('|');
  if(seen.has(id)||e.body_verified!==true||!/^https:\/\//.test(e.url||'')||!names.has(norm(e.rider))||!names.has(norm(e.peer))||e.rider===e.peer||!['assistance_received','mentor','trust'].includes(e.kind)||!(Date.parse(e.published_at)<=Date.parse(e.collected_at)&&Date.parse(e.collected_at)<cutoff)||cutoff-Date.parse(e.published_at)>1095*86400000)return false;
  seen.add(id);return true;
 }).map(e=>({...e,no:names.get(norm(e.rider)),peer_no:names.get(norm(e.peer))}));
}
function build(r,pack={}){
 const linked=relations(r,pack),by=new Map(r.riders.map(x=>[x.no,x]));
 const lines=r.lineup.map(line=>{
  const leader=by.get(line[0]),facts=[],sources=[];let motivation=0;
  for(const n of line.slice(1)){
   const follower=by.get(n),lt=Number(leader.meta?.term),ft=Number(follower.meta?.term);
   if(Number.isFinite(lt)&&lt>0&&Number.isFinite(ft)&&ft>0&&ft<lt){facts.push(`${n}番${follower.name}は${ft}期で、${lt}期の${leader.name}より先輩`);motivation+=.06;}
   const lr=rank[leader.meta?.rank],fr=rank[follower.meta?.rank];
   if(fr&&lr&&fr>lr){facts.push(`${n}番は級班が上位`);motivation+=.05;}
   else if(follower.score-leader.score>=5){facts.push(`${n}番は競走得点が${(follower.score-leader.score).toFixed(1)}点上位`);motivation+=.04;}
   const pref=norm(follower.meta?.prefecture).replace(/県$|府$|都$/,'');
   if(Object.entries(prefectures).some(([p,venues])=>(p===pref||p==='神奈川'&&pref==='神奈')&&venues.includes(r.venue))){facts.push(`${n}番は開催地と登録地が同じ（地元は登録地ベース）`);motivation+=.06;}
   for(const e of linked.filter(e=>e.no===leader.no&&e.peer_no===n)){
    facts.push(`${leader.name}の過去の本人発言に${follower.name}との${e.kind==='assistance_received'?'援護への謝意':e.kind==='mentor'?'師弟関係':'信頼関係'}がある`);sources.push(e);motivation+=.04;
   }
  }
  const linkedFacts=facts.length,comment=(r.race_material?.comments||[]).find(e=>norm(e.rider)===norm(leader.name));
  const intention=comment?.declaration||comment?.excerpt.split(/[。！？]/).filter(Boolean).at(-1)||'';
  const declared=/^(?:自力|先行|突っ張|積極|前で)/.test(intention)&&!/(?:昨日|前回|ではない|しない|なかった)/.test(intention);
  if(declared){facts.push(`今回の本人コメント「${intention}」`);sources.push(comment);motivation+=/先行|突っ張|積極/.test(intention)?.1:.04;}
  return {leader:leader.no,facts,sources,motivation:Math.min(.18,motivation),inference:linkedFacts?'この連係では後続を連れ出す意欲を少し高く見る。ただし今回の意思は推測。':declared?'本人の今回の意思表示を仕掛けの材料にする。実行の保証ではない。':'連係上の特別な動機は確認できず、脚質・B・現在位置を中心に考える。'};
 });
 const missing=[];
 if(r.riders.some(x=>!Number.isFinite(x.s)||x.meta?.absent_fields?.includes('s')))missing.push('S回数の実測がない選手は、S取りを暫定判断');
 if(r.riders.some(x=>!x.meta?.term||!x.meta?.prefecture))missing.push('期別・登録地が不明な選手あり');
 if(!linked.length)missing.push('今回の出走者同士の援護・師弟・信頼を結ぶ本文根拠は未取得');
 return {lines,relationships:linked,missing,lineup_status:r.source?.lineup_verified===true?'確認済みの並び':'配信上の想定並び（当日の変更・競りは未確認）'};
}
const api={build,relations};if(typeof module!=='undefined')module.exports=api;root.RiderContext=api;
})(typeof globalThis!=='undefined'?globalThis:this);
