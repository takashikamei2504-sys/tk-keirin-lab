'use strict';
/* Predeclared, equal-stake EX A/B evaluation selection.
 * These are ranks and simulated uniform ¥100 tickets, not calibrated odds or buy signals.
 */
const VERSION='ex-roi-shadow-v1.0.0';
const TICKETS=8;
function select(out,limit=TICKETS){
 if(!Number.isInteger(limit)||limit<1||limit>10)throw Error('TICKET_LIMIT_INVALID');
 const entries=(out?.tickets||[]).filter(t=>/^[1-9]-[1-9]-[1-9]$/.test(t.key||'')&&
   Array.isArray(t.trio)&&t.trio.length===3&&
   new Set(t.trio).size===3&&t.trio.join('-')===t.key&&
   Number.isFinite(t.score)&&t.score>0);
 const best=new Map();
 for(const t of entries){const old=best.get(t.key);if(!old||t.score>old.score)best.set(t.key,{key:t.key,trio:t.trio,score:t.score});}
 const pool=[...best.values()].sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
 const chosen=[],pairUse=new Map(),headUse=new Map();
 for(const t of pool){
  const pair=t.trio.slice(0,2).join('-'),first=t.trio[0];
  if((pairUse.get(pair)||0)>=3||(headUse.get(first)||0)>=5)continue;
  chosen.push({key:t.key,trio:t.trio});
  pairUse.set(pair,(pairUse.get(pair)||0)+1);
  headUse.set(first,(headUse.get(first)||0)+1);
  if(chosen.length===limit)break;
 }
 return chosen;
}
const keys=a=>a.map(x=>x.key);
function diff(a,b){
 const old=new Set(keys(a)),next=new Set(keys(b));
 const oldPairs=new Set(a.map(x=>x.trio.slice(0,2).join('-')));
 const newPairs=new Set(b.map(x=>x.trio.slice(0,2).join('-')));
 return {changed:keys(b).filter(x=>!old.has(x)),dropped:keys(a).filter(x=>!next.has(x)),
  pair_added:[...newPairs].filter(x=>!oldPairs.has(x)),pair_dropped:[...oldPairs].filter(x=>!newPairs.has(x)),
  same:old.size===next.size&&[...old].every(k=>next.has(k))};
}
function pickPair(trio){return trio.slice(0,2).join('-');}
function accuracy(ticketRows,winners){
 const tickets=new Set(keys(ticketRows)),heads=new Set(ticketRows.map(x=>x.trio[0])),
   pairs=new Set(ticketRows.map(x=>pickPair(x.trio)));
 return {first:winners.some(w=>heads.has(w.trio[0])),
   pair:winners.some(w=>pairs.has(pickPair(w.trio))),
   trifecta:winners.some(w=>tickets.has(w.key))};
}
module.exports={VERSION,TICKETS,select,diff,accuracy};
