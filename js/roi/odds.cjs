'use strict';
const BASE='https://www.winticket.jp';
function state(html) {
  const match=html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\});\s*window\.__CONFIG__/);
  if(!match)throw Error('source_format');
  return JSON.parse(match[1]);
}
function query(s,key) {
  const hits=(s.tanStackQuery?.queries||[]).filter(q=>q.queryKey?.includes(key));
  if(hits.length!==1)throw Error('source_query');
  return hits[0].state.data;
}
function links(html) {
  const venues=query(state(html),'FETCH_KEIRIN_VENUE_LIST').venues;
  return [...new Set([...html.matchAll(/href="(\/keirin\/[^/]+\/racecard\/\d{10}\/\d+\/\d+)"/g)].map(m=>m[1]))].map(path=>{
    const parts=path.split('/'),id=parts[4].slice(-2);
    return {url:BASE+path,venue:venues.find(v=>v.id===id)?.name,number:Number(parts[6])};
  });
}
const normal=s=>String(s).normalize('NFKC').replace(/\s/g,'');
function parse(html,url,expected,capturedAt) {
  if(!/^https:\/\/www\.winticket\.jp\/keirin\/[^/]+\/racecard\/\d{10}\/\d+\/\d+$/.test(url))throw Error('source_url');
  const s=state(html),data=query(s,'FETCH_KEIRIN_RACE'),quote=query(s,'FETCH_KEIRIN_RACE_ODDS');
  const race=data.race,day=data.schedule.date,venue=data.venues.find(v=>v.id===data.schedule.id.slice(-2));
  const date=day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6,8);
  const cutoff=Date.parse(expected.cutoff),captured=Date.parse(capturedAt);
  if(date!==expected.race.date || normal(venue?.name)!==normal(expected.race.venue) || race.number!==expected.race.number ||
     race.startAt*1000!==cutoff || race.cancel || race.status!==1 || data.results?.length ||
     quote.finalOdds!==false || quote.oddsDelayed!==false || /L級|ガールズ/.test(race.class+' '+race.raceType))throw Error('race_or_state');
  const identity=data.entries.map(e=>{
    const player=data.players.find(p=>p.id===e.playerId);
    if(e.absent||!player)throw Error('absent');
    return [e.number,String(e.playerId).replace(/^0+/,''),normal(player.name)];
  }).sort((a,b)=>a[0]-b[0]);
  const known=expected.identity.map(([no,id,name])=>[no,String(id).replace(/^0+/,''),normal(name)]).sort((a,b)=>a[0]-b[0]);
  if(![7,9].includes(identity.length)||JSON.stringify(identity)!==JSON.stringify(known))throw Error('identity');
  const updated=quote.oddsUpdatedAt*1000,close=race.closeAt*1000;
  if(!(updated>0&&updated<=captured&&captured-updated<=300000&&captured<close&&close<=cutoff))throw Error('quote_time');
  const ids=new Set(identity.map(x=>x[0])),odds={};
  for(const item of quote.trifecta||[]) {
    const key=item.key?.join('-');
    if(item.raceId!==race.id||item.absent||item.unitPrice!==100||item.key.length!==3||new Set(item.key).size!==3||
       item.key.some(n=>!ids.has(n))||!Number.isFinite(item.odds)||item.odds<1||key in odds)throw Error('quote_value');
    odds[key]=item.odds;
  }
  if(Object.keys(odds).length!==(ids.size===7?210:504))throw Error('incomplete_market');
  return {race_id:expected.race_id,market:'trifecta',state:'live',source_url:url,
    published_at:new Date(updated).toISOString(),captured_at:capturedAt,sales_close_at:new Date(close).toISOString(),odds};
}
async function get(url) {
  const response=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'TK-KEIRIN-LAB/1.0 (public odds; one request per race per run)'}});
  if(!response.ok)throw Error('http_'+response.status);
  if(!response.url.startsWith(BASE+'/keirin/'))throw Error('redirect');
  return response.text();
}
module.exports={links,parse,get};