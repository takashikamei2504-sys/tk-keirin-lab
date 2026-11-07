'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Odds=require('../js/roi/odds.cjs'),Policy=require('../js/roi/policy.cjs');
const {save}=require('./roi-audit.cjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
async function decide(data,clock=Date.now,source=Odds) {
  const date=new Date(clock()+9*3600000).toISOString().slice(0,10);
  const dir=path.join(data,'roi','forecasts',date),output=path.join(data,'roi','decisions',date);
  if(!fs.existsSync(path.join(dir,'index.json')))return {saved:0,attempted:0};
  const index=JSON.parse(fs.readFileSync(path.join(dir,'index.json'),'utf8'));
  const rows=index.rows.filter(r=>r.model===index.model&&Date.parse(r.cutoff)>clock()+5*60000&&Date.parse(r.cutoff)<=clock()+15*60000);
  if(!rows.length)return {saved:0,attempted:0};
  fs.mkdirSync(output,{recursive:true});
  let list;
  try{list=source.links(await source.get('https://www.winticket.jp/keirin/racecard'));}
  catch(e){return {saved:0,attempted:0,error:e.message};}
  let saved=0,attempted=0;
  for(const row of rows) {
    if(!/^[a-f0-9]{64}\.json$/.test(row.file))continue;
    const file=path.join(output,row.file);
    if(fs.existsSync(file))continue;
    const r=JSON.parse(fs.readFileSync(path.join(dir,row.file),'utf8'));
    if(!r.identity||!r.calibration||!r.probability_validation||Policy.model(r.calibration).model_id!==r.model.model_id)continue;
    const link=list.find(l=>l.venue===r.race.venue&&l.number===r.race.number);
    if(!link)continue;
    if(attempted>=8)break;
    if(attempted)await new Promise(resolve=>setTimeout(resolve,1000));
    attempted++;
    try {
      const html=await source.get(link.url),asOf=new Date(clock()).toISOString();
      const snapshot=source.parse(html,link.url,r,asOf),close=Date.parse(snapshot.sales_close_at);
      // First valid quote observed 2–8 minutes before the provider's sales close is fixed once.
      if(!(clock()>=close-8*60000&&clock()<close-2*60000))continue;
      const race={date:r.race.date,venue:r.race.venue,race_no:r.race.number,
        riders:r.identity.map(([no])=>({no}))};
      const decision=Policy.build(r,race,r.calibration,snapshot,asOf,r.cutoff);
      const savedAt=clock();
      if(!(savedAt<close-2*60000&&savedAt-Date.parse(snapshot.published_at)<=300000))continue;
      const record={schema:'tk-keirin-roi-decision/v1',race_id:r.race_id,race:r.race,forecast_file:row.file,
        forecast_sha256:sha(fs.readFileSync(path.join(dir,row.file))),model:r.model,
        saved_at:new Date(savedAt).toISOString(),cutoff:r.cutoff,expires_at:new Date(Math.min(close,Date.parse(snapshot.published_at)+300000)).toISOString(),
        stake_per_ticket:100,snapshot,decision};
      fs.writeFileSync(file,JSON.stringify(record)+'\n',{flag:'wx'});saved++;
    } catch(e) {if(e.code!=='EEXIST')console.log(JSON.stringify({race_id:r.race_id,odds_error:e.message}));}
  }
  const all=fs.readdirSync(output).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(file=>{
    const r=JSON.parse(fs.readFileSync(path.join(output,file),'utf8'));
    return {file,race_id:r.race_id,race:r.race,model:r.model.model_id,saved_at:r.saved_at,expires_at:r.expires_at,decision:r.decision};
  });
  save(path.join(output,'index.json'),{date,model:index.model,rows:all});
  return {saved,attempted};
}
if(require.main===module)decide(path.join(__dirname,'../data')).then(console.log).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={decide};