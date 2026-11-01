/* Automatic, pre-race evidence memory. Comments never become executed actions. */
(function(root){'use strict';
const traits=new Set(['front','resist','withdraw','kamashi','makuri','track','seat','recover','finish','outer','block','vertical','inside','long_makuri']);
const key=s=>String(s||'').replace(/[\s\u3000]/g,'');
const raceKey=r=>`${r.date}:${r.venue}:${r.race_no}`;
const cutoffOf=r=>Date.parse(`${r.date}T${r.start}:00+09:00`);
function before(row,cutoff){
 const pub=Date.parse(row.published_at),col=Date.parse(row.collected_at);
 return row.body_verified===true&&/^https:\/\//.test(row.url||'')&&Number.isFinite(cutoff)&&
  Number.isFinite(pub)&&Number.isFinite(col)&&pub<=col&&pub<cutoff&&col<cutoff;
}
function build(r,pack={}){
 const cutoff=cutoffOf(r),byName=new Map(r.riders.map(x=>[key(x.name),x]));
 const records=[],seen=new Set();
 for(const [kind,rows] of [['habitual_observation',pack.evidence||[]],['interview_comment',pack.observations||[]]])for(const row of rows){
  const rider=byName.get(key(row.rider));
  if(!rider||!before(row,cutoff)||(row.rider_id&&String(row.rider_id).padStart(6,'0')!==String(rider.meta?.rider_id||rider.id||rider.rider_id).padStart(6,'0')))continue;
  if(kind==='habitual_observation'&&(!traits.has(row.trait)||!Number.isFinite(row.value)||row.value<0||row.value>1||!Number.isFinite(row.confidence)||row.confidence<=0))continue;
  const id=[rider.no,row.url,row.trait||row.excerpt].join('|');if(seen.has(id))continue;seen.add(id);
  // Older generic comments stay readable but cannot affect numeric traits.
  let type=kind;
  if(kind==='interview_comment'&&row.kind==='race_intention'&&row.race_id===raceKey(r))type='race_intention';
  if(kind==='interview_comment'&&row.kind==='current_form'&&Date.parse(row.valid_until)>=cutoff)type='current_form';
  records.push({...row,no:rider.no,kind:type,scope:type==='race_intention'?raceKey(r):type==='current_form'?'period':'rider',
   numeric:kind==='habitual_observation',ageDays:Math.max(0,(cutoff-Date.parse(row.published_at))/86400000)});
 }
 return records;
}
function trait(prior,records,no,trait,context={}){
 let mass=1.8,sum=prior*mass;
 for(const m of records){
  if(m.no!==no||!m.numeric||m.trait!==trait)continue;
  // Only structured observed context constrains use; free text is not guessed into a label.
  if(m.context&&Object.entries(m.context).some(([k,v])=>context[k]!==v))continue;
  const w=Math.min(1,m.confidence)*Math.exp(-m.ageDays/270);
  sum+=w*m.value;mass+=w;
 }
 return Math.max(.08,Math.min(.92,sum/mass));
}
const api={build,trait,raceKey,cutoffOf};if(typeof module!=='undefined')module.exports=api;root.BrainMemory=api;
})(typeof globalThis!=='undefined'?globalThis:this);
