'use strict';
// Independent read-only endpoint for MRT live-odds experiments.
// Start separately with: node server/mrt-odds.cjs
// GitHub Pages cannot host this process; it must be deliberately deployed.
const http=require('node:http');
const Odds=require('../js/roi/odds.cjs');
const RAW='https://raw.githubusercontent.com/takashikamei2504-sys/tk-keirin-lab/main/data/mrt/';
const ORIGIN=process.env.MRT_ODDS_ALLOWED_ORIGIN||'https://takashikamei2504-sys.github.io';
const recent=new Map();
const validId=x=>/^\d{12}$/.test(x||'');
const jstDay=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);

async function read(path) {
  const response=await fetch(RAW+path,{cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('snapshot_http_'+response.status);
  const body=await response.text();
  if(body.length>1000000)throw Error('snapshot_size');
  return JSON.parse(body);
}
function snapshotChoice(p,request) {
  if(request.mode==='automatic')return p.automatic;
  if(request.mode==='manual' && /^(?:[1-9]-)*[1-9]$/.test(request.line||'') && ['leader','members'].includes(request.rule)) {
    if(!p.lines.some(l=>l.join('-')===request.line))throw Error('unknown_line');
    return p.manual?.[request.line]?.[request.rule];
  }
  throw Error('invalid_condition');
}
function sourceIdentity(html,p) {
  const match=html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\});\s*window\.__CONFIG__/);
  if(!match)throw Error('source_format');
  const state=JSON.parse(match[1]);
  const queries=(state.tanStackQuery?.queries||[]).filter(q=>q.queryKey?.includes('FETCH_KEIRIN_RACE'));
  if(queries.length!==1)throw Error('source_query');
  const data=queries[0].state.data;
  const identities=data.entries.map(e=>{
    const rider=data.players.find(x=>x.id===e.playerId);
    if(!rider||e.absent)throw Error('absent');
    return [e.number,String(e.playerId).replace(/^0+/,''),rider.name];
  }).sort((a,b)=>a[0]-b[0]);
  const original=Object.entries(p.input.entry.players).map(([no,player])=>[Number(no),String(player.rider_id).replace(/^0+/, '')]).sort((a,b)=>a[0]-b[0]);
  if(![7,9].includes(identities.length) || JSON.stringify(identities.map(x=>x.slice(0,2)))!==JSON.stringify(original))throw Error('roster_mismatch');
  // The original MRT archive has rider IDs but not usable names.
  // Only ID and car number are independently compared here; names are taken
  // from WINTICKET for the existing odds parser's own consistency check.
  return identities;
}
async function latest(request) {
  if(!validId(request?.race_id) || !['automatic','manual'].includes(request.mode))throw Error('invalid_request');
  const date=request.race_id.slice(0,4)+'-'+request.race_id.slice(4,6)+'-'+request.race_id.slice(6,8);
  if(date!==jstDay())throw Error('not_today');
  const day=await read(date+'/index.json');
  const row=day.races?.find(r=>r.race_id===request.race_id);
  if(!row?.file || !/^\d{12}-[a-f0-9]{16}\.json$/.test(row.file))throw Error('no_pre_race_forecast');
  if(Date.now()>=Date.parse(row.sales_close_at)-30000)throw Error('sales_closed');
  if(Date.now()-Date.parse(row.checked_at)>75*60000)throw Error('roster_stale');
  const p=await read(date+'/'+row.file);
  if(p.race_id!==request.race_id || p.identity_sha256!==row.identity_sha256 || p.pre_race!==true ||
     p.model_id!=='MRT_V3_7126' || p.generated_at>=p.sales_close_at)throw Error('forecast_mismatch');
  const selection=snapshotChoice(p,request);
  if(!selection || selection.race_id!==p.race_id || !Array.isArray(selection.tickets)||!selection.tickets.length ||
     selection.tickets.length>100)throw Error('forecast_invalid');
  const catalog=Odds.links(await Odds.get('https://www.winticket.jp/keirin/racecard'));
  const link=catalog.find(r=>r.venue===p.venue_name&&r.number===p.race_no);
  if(!link)throw Error('race_not_listed');
  const html=await Odds.get(link.url);
  const identity=sourceIdentity(html,p);
  const capturedAt=new Date().toISOString();
  const expected={race_id:p.race_id,race:{date,venue:p.venue_name,number:p.race_no},identity,cutoff:p.start_at};
  const quote=Odds.parse(html,link.url,expected,capturedAt);
  const selections={};
  for(const ticket of selection.tickets) {
    const key=ticket.cars.join('-');
    if(!(key in quote.odds))throw Error('ticket_odds_missing');
    selections[key]=quote.odds[key];
  }
  return {
    schema:'tk-mrt-odds-quote/v1',race_id:p.race_id,identity_sha256:p.identity_sha256,
    model_sha256:p.model_sha256,condition:request.mode==='automatic'?'auto':request.line+':'+request.rule,
    source_url:quote.source_url,market:quote.market,state:quote.state,
    published_at:quote.published_at,captured_at:quote.captured_at,sales_close_at:quote.sales_close_at,
    odds:selections,reference_only:true
  };
}
function send(res,code,body,origin) {
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0',
    'X-Content-Type-Options':'nosniff','Vary':'Origin',
    ...(origin===ORIGIN?{'Access-Control-Allow-Origin':ORIGIN}:{})});
  res.end(JSON.stringify(body));
}
function serve(req,res) {
  const origin=req.headers.origin||'';
  if(req.method==='OPTIONS'){
    if(origin!==ORIGIN)return send(res,403,{error:'origin'},origin);
    res.writeHead(204,{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'POST, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'});return res.end();
  }
  if(req.method==='GET' && req.url==='/health')return send(res,200,{service:'mrt-odds',state:'ready'},origin);
  if(req.url!=='/api/mrt/live-odds'||req.method!=='POST')return send(res,404,{error:'not_found'},origin);
  if(origin!==ORIGIN)return send(res,403,{error:'origin'},origin);
  let data='';
  req.on('data',chunk=>{data+=chunk;if(data.length>4096)req.destroy()});
  req.on('end',async()=>{
    try {
      const input=JSON.parse(data),key=String(input.race_id);
      const last=recent.get(key)||0;
      if(Date.now()-last<20000)return send(res,429,{error:'rate_limited'},origin);
      recent.set(key,Date.now());
      const result=await latest(input);
      send(res,200,result,origin);
    } catch(e) {const code=/invalid_|unknown_line|not_today/.test(e.message)?400:
       /sales_closed/.test(e.message)?409:503;
       send(res,code,{error:e.message},origin)}
  });
}
if(require.main===module){
  http.createServer(serve).listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('MRT odds API listening'));
}
module.exports={latest,sourceIdentity,snapshotChoice,serve};
