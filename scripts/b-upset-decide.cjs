'use strict';
const fs=require('node:fs'),path=require('node:path');
const Odds=require('../js/roi/odds.cjs'),Engine=require('../js/b-upset/engine.cjs');
const P=require('../js/model-provenance.js'),Audit=require('../js/results-audit.js');

function valid(decision,forecast){
  try{
    if(decision.schema!=='tk-b-upset-decision/v2'||decision.forecast_sha256!==forecast.output_sha256||
       decision.model_id!==forecast.out.model.model_id||decision.race_id!==forecast.race_id||
       !(Date.parse(decision.saved_at)<Date.parse(decision.quote.close_at)))return false;
    const selected=Engine.selectValue(forecast.out,decision.quote,decision.calibration,decision.saved_at)
      .filter(t=>!forecast.out.overlap?.includes(t.key));
    return P.sha256(selected)===P.sha256(decision.tickets);
  }catch(e){return false;}
}

async function collect(dir,forecasts,clock=Date.now,source=Odds){
  const file=path.join(dir,'calibration.json');
  if(!fs.existsSync(file))return {saved:0,attempted:0,reason:'B-UPSET固有の校正データ待ち'};
  const calibration=JSON.parse(fs.readFileSync(file,'utf8'));
  if(calibration.model_id!==require('../js/b-upset/build.json').model_id||calibration.calibrated!==true||
     !(calibration.validation_roi>1&&calibration.trim1_roi>1&&calibration.holdout_n>=200))return {saved:0,attempted:0,reason:'校正・収益性検証待ち'};
  const pending=forecasts.filter(r=>{
    const cutoff=Date.parse(r.out.cutoff);
    return r.out.mode==='pre-race'&&clock()<cutoff&&cutoff-clock()<=15*60000;
  });
  if(!pending.length)return {saved:0,attempted:0,reason:'直前対象なし'};
  const links=source.links(await source.get('https://www.winticket.jp/keirin/racecard'));
  let saved=0,attempted=0;const errors=[];
  for(const forecast of pending.slice(0,8)){
    const o=forecast.out;
    const dest=path.join(dir,o.race.date,'decisions',require('node:crypto').createHash('sha256').update(o.race_id+'|'+o.model.model_id).digest('hex')+'.json');
    if(fs.existsSync(dest))continue;
    const link=links.find(l=>l.venue===o.race.venue&&l.number===o.race.race_no);
    if(!link)continue;
    attempted++;
    try{
      const html=await source.get(link.url),capturedAt=new Date(clock()).toISOString();
      const expected={race_id:o.race_id,cutoff:o.cutoff,race:{date:o.race.date,venue:o.race.venue,number:o.race.race_no},identity:Audit.identity(o.input)};
      const snapshot=source.parse(html,link.url,expected,capturedAt);
      const quote={race_id:o.race_id,identity_verified:true,final:false,source_url:snapshot.source_url,
        updated_at:snapshot.published_at,captured_at:snapshot.captured_at,close_at:snapshot.sales_close_at,odds:snapshot.odds};
      const savedAt=new Date(clock()).toISOString();
      const tickets=Engine.selectValue(o,quote,calibration,savedAt).filter(t=>!o.overlap?.includes(t.key));
      const decision={schema:'tk-b-upset-decision/v2',race_id:o.race_id,model_id:o.model.model_id,
        forecast_sha256:forecast.output_sha256,saved_at:savedAt,quote,calibration,tickets};
      if(!valid(decision,forecast))throw Error('期待値選別の整合性検査に失敗');
      fs.mkdirSync(path.dirname(dest),{recursive:true});
      fs.writeFileSync(dest,JSON.stringify(decision)+'\n',{flag:'wx'});saved++;
    }catch(e){if(e.code!=='EEXIST')errors.push({race_id:o.race_id,error:e.message});}
  }
  return {saved,attempted,errors};
}
module.exports={collect,valid};
