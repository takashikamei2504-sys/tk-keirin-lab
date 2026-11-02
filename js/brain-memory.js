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
 for(const [kind,rows] of [['habitual_observation',pack.evidence||[]],['interview_comment',pack.observations||[]]])for(const row of rows.slice().sort((a,b)=>(b.confidence||0)-(a.confidence||0)||String(a.collected_at).localeCompare(String(b.collected_at))||(a.value??0)-(b.value??0)||String(a.id||a.excerpt||'').localeCompare(String(b.id||b.excerpt||'')))){
  const rider=byName.get(key(row.rider));
  if(!rider||!before(row,cutoff)||(row.rider_id&&String(row.rider_id).padStart(6,'0')!==String(rider.meta?.rider_id||rider.id||rider.rider_id).padStart(6,'0')))continue;
  if(kind==='habitual_observation'&&(!traits.has(row.trait)||!Number.isFinite(row.value)||row.value<0||row.value>1||!Number.isFinite(row.confidence)||row.confidence<=0))continue;
  const id=(kind==='interview_comment'?[rider.no,row.url,row.kind||kind,row.race_id||'',row.declaration||'',row.excerpt]:[rider.no,row.url,row.trait,JSON.stringify(Object.entries(row.context||{}).sort())]).join('|');if(seen.has(id))continue;seen.add(id);
  // Older generic comments stay readable but cannot affect numeric traits.
  let type=kind;
  if(kind==='interview_comment'&&row.kind==='race_intention'&&row.race_id===raceKey(r))type='race_intention';
  if(kind==='interview_comment'&&row.kind==='current_form'&&Date.parse(row.valid_until)>=cutoff)type='current_form';
  records.push({...row,no:rider.no,kind:type,scope:type==='race_intention'?raceKey(r):type==='current_form'?'period':'rider',
   numeric:kind==='habitual_observation',ageDays:Math.max(0,(cutoff-Date.parse(row.published_at))/86400000)});
 }
 return records.sort((a,b)=>a.no-b.no||a.url.localeCompare(b.url)||String(a.trait||a.kind).localeCompare(String(b.trait||b.kind))||JSON.stringify(a.context||{}).localeCompare(JSON.stringify(b.context||{})));
}
const PHASES=['並び確認・S取り','赤板周回～打鐘','最終ホーム','最終バック','最終3～4コーナー','最後の直線'];
function context(r,no,s={}){
 const line=r.lineup.find(l=>l.includes(no)),stage=s.stage??0;
 const head=line?.[0],attack=stage>=2&&(head===s.homeRider||head===s.backRider)?'makuri':head===s.attacker&&s.tactic==='kamashi'?'kamashi':head===s.attacker&&s.tactic==='press'?'press':'unknown';
 return {phase:s.phase||PHASES[stage],role:line?.[0]===no?'leader':'follower',attack_type:attack,connection:s.connected?.[no]===false?'detached':s.connected?.[no]===true?'connected':'unknown'};
}
function matching(records,no,trait,ctx={}){
 return records.filter(m=>m.no===no&&m.numeric&&m.trait===trait&&(!m.context||Object.entries(m.context).every(([k,v])=>ctx[k]===v)));
}
function review(prior,records,no,trait,ctx={}){
 // One article has at most one vote per situation, even if multiple rows match.
 const articles=new Map();
 for(const m of matching(records,no,trait,ctx)){
  const old=articles.get(m.url),specific=Object.keys(m.context||{}).length;
  if(!old||specific>Object.keys(old.context||{}).length||specific===Object.keys(old.context||{}).length&&(m.confidence>old.confidence||m.confidence===old.confidence&&m.id<old.id))articles.set(m.url,m);
 }
 const sources=[...articles.values()].sort((a,b)=>a.url.localeCompare(b.url));let mass=1.8,sum=prior*mass;
 for(const m of sources){const w=Math.min(1,m.confidence)*Math.exp(-m.ageDays/270);sum+=w*m.value;mass+=w;}
 return {trait,prior,value:Math.max(.08,Math.min(.92,sum/mass)),context:{...ctx},source_count:sources.length,sources,scope:sources.length>1?'複数本文の条件付き傾向':sources.length?'一記事の観察による小幅補正':'本文根拠なし・脚質等の暫定値'};
}
function trait(prior,records,no,name,ctx={}){return review(prior,records,no,name,ctx).value;}
const api={build,trait,review,matching,context,raceKey,cutoffOf};if(typeof module!=='undefined')module.exports=api;root.BrainMemory=api;
})(typeof globalThis!=='undefined'?globalThis:this);
