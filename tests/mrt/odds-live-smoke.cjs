/* One-request diagnostic only. Does not place bets; a provider outage is reported, not hidden. */
(async()=>{
 const api='https://shibuki-mobile-production.up.railway.app/api/mrt/live-odds';
 const origin='https://takashikamei2504-sys.github.io';
 const d=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 const indexUrl='https://raw.githubusercontent.com/takashikamei2504-sys/tk-keirin-lab/main/data/mrt/'+d+'/index.json';
 try{
   const indexResponse=await fetch(indexUrl,{signal:AbortSignal.timeout(8000)});
   if(!indexResponse.ok){console.log('LIVE_DIAGNOSTIC no_index '+indexResponse.status);return;}
   const index=await indexResponse.json();
   const now=Date.now();
   const candidates=index.races.filter(x=>x.file && x.checked_at && x.sales_close_at &&
      Date.parse(x.sales_close_at)>now+3*60000 && Date.parse(x.checked_at)<=now &&
      now-Date.parse(x.checked_at)<60*60000);
   if(!candidates.length){console.log('LIVE_DIAGNOSTIC no_eligible_race');return;}
   candidates.sort((a,b)=>Date.parse(a.sales_close_at)-Date.parse(b.sales_close_at));
   const race=candidates[0];
   const response=await fetch(api,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
       body:JSON.stringify({race_id:race.race_id,mode:'automatic'}),signal:AbortSignal.timeout(30000)});
   let body={};try{body=await response.json()}catch{}
   console.log('LIVE_DIAGNOSTIC',JSON.stringify({race_id:race.race_id,status:response.status,
     error:body.error||null,quote_source:body.source_url||null,market_size:Object.keys(body.odds||{}).length,
     captured:body.captured_at||null,origin:response.headers.get('access-control-allow-origin')||null}));
 }catch(e){console.log('LIVE_DIAGNOSTIC connection_unavailable',String(e?.message||e));}
})().catch(e=>{console.log('LIVE_DIAGNOSTIC unexpected',e.message);});
