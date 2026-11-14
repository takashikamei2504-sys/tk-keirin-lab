/* Independent, user-directed handoff to official purchase sites.
 * This module NEVER sends ticket data to another site, submits bets, or stores credentials. */
(function(root){'use strict';
const VERSION='crossline-handoff-v1-20261114';
const OFFICIAL_SITES=Object.freeze({
 winticket:Object.freeze({label:'WINTICKET',url:'https://www.winticket.jp/keirin'}),
 kdreams:Object.freeze({label:'楽天Kドリームス',url:'https://keirin.kdreams.jp/'})
});
function validRow(row,now=Date.now()){
 const forecast=row?.forecast,cutoff=Number(row?.startAt);
 return !!(row&&Number.isFinite(cutoff)&&now<cutoff&&
  (row.source==='live'||row.source==='frozen')&&forecast?.eligible===true&&
  forecast.stake===400&&Array.isArray(forecast.tickets)&&forecast.tickets.length===4&&
  Array.isArray(forecast.candidate4)&&forecast.candidate4.length===4&&
  forecast.tickets.every((t,i)=>t===forecast.candidate4[i]&&
    typeof t==='string'&&/^[1-9]-[1-9]-[1-9]$/.test(t)&&
    new Set(t.split('-')).size===3));
}
function ticketText(row,now=Date.now()){
 if(!validRow(row,now))throw Error('発走前の4点購入候補ではありません');
 return [row.date+'　'+row.venue+'　'+row.race_no+'R　発走予定 '+row.start,
  '三連単（各100円）',
  ...row.forecast.tickets.map(t=>t+'　100円'),
  '合計4点・400円',
  '購入サイトで開催場・R・投票締切・買い目・金額をご自身で確認してください。'].join('\n');
}
function destination(site){
 if(!Object.hasOwn(OFFICIAL_SITES,site))throw Error('未登録の移動先です');
 return OFFICIAL_SITES[site].url;
}
const api=Object.freeze({VERSION,OFFICIAL_SITES,validRow,ticketText,destination});
if(typeof module!=='undefined')module.exports=api;
root.CrosslinePurchaseHandoff=api;
})(typeof globalThis!=='undefined'?globalThis:this);
