'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Audit = require('../js/results-audit.js');
const Engine = require('../js/roi/engine.cjs');
const {readHistory, save} = require('./roi-audit.cjs');
const {pairs} = require('./roi-research.cjs');

const root = path.join(__dirname,'..');
const jst = epoch=>new Date(epoch+9*3600000).toISOString().slice(0,10);

function freeze(data, clock = Date.now) {
  const start = clock(), date = jst(start);
  const history = readHistory(data,{withResults:false,from:date});
  const output = path.join(data,'roi','forecasts');
  let frozen = 0;
  for (const {lab,out} of pairs(history,start)) {
    const now = clock();
    const cutoff = Audit.startAt(lab.input);
    if (!(Date.parse(out.evidence.lab.saved_at)<=now && Date.parse(out.evidence.line.saved_at)<=now && now<cutoff)) continue;
    const file = path.join(output,lab.input.date,
      require('node:crypto').createHash('sha256').update(lab.race_id+'|'+out.model.model_id).digest('hex')+'.json');
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const record = {schema:'tk-keirin-roi-frozen/v1',race_id:lab.race_id,
      saved_at:new Date(now).toISOString(), cutoff:lab.cutoff,
      race:{date:lab.input.date,venue:lab.input.venue,number:lab.input.race_no,start:lab.input.start},
      decision:{status:'pass',reason:'pre-race odds and prospective validation required',tickets:[]},
      ...out};
    const content = JSON.stringify(record)+'\n';
    if (Buffer.byteLength(content)>65536) throw Error('ROI forecast exceeds 64 KiB');
    try {
      fs.writeFileSync(file,content,{flag:'wx'});
      frozen++;
    } catch (error) {
      if (error.code!=='EEXIST') throw error;
    }
  }
  const dates = [...new Set([date,jst(start+86400000)])];
  for (const day of dates) {
    const dir = path.join(output,day);
    if (!fs.existsSync(dir)) continue;
    const rows = fs.readdirSync(dir).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(file=>{
      const {race_id, race, cutoff, saved_at, model, decision, chosen} = JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
      return {file,race_id,race,cutoff,saved_at,model:model.model_id,decision,
        candidates:chosen.map(t=>t.key)};
    }).sort((a,b)=>Date.parse(a.cutoff)-Date.parse(b.cutoff) || a.race_id.localeCompare(b.race_id));
    // Regeneration leaves a stable per-day index. Immutable forecasts are never replaced.
    save(path.join(dir,'index.json'),{date:day,model:Engine.model.model_id,rows});
  }
  return frozen;
}

if (require.main === module) console.log(JSON.stringify({frozen:freeze(path.join(root,'data'))}));
module.exports = {freeze};
