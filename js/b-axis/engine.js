/* TK KEIRIN LAB B-AXIS v0.1: independently rank outcomes conditional on B passage.
 * Shared material feature collector ONLY; never call LAB / LAB LINE prediction engines.
 * Scores are relative heuristics, not calibrated probabilities. No results or odds input.
 */
(function(root){'use strict';
const VERSION='LAB_B_AXIS_V0.1.0',min=(a,b)=>Math.min(a,b),max=(a,b)=>Math.max(a,b),clamp=(x,a=0,b=1)=>max(a,min(b,x));
const TACTICS={press:'突っ張り',hold:'押さえ先行',kamashi:'カマシ',makuri:'早めの捲り',surge:'番手発進'};
const prefecture={
 '函館':'北海道','青森':'青森','いわき平':'福島','弥彦':'新潟','前橋':'群馬','取手':'茨城','宇都宮':'栃木','大宮':'埼玉','西武園':'埼玉','京王閣':'東京','立川':'東京','松戸':'千葉','川崎':'神奈川','平塚':'神奈川','小田原':'神奈川','伊東':'静岡','静岡':'静岡','名古屋':'愛知','岐阜':'岐阜','大垣':'岐阜','豊橋':'愛知','富山':'富山','松阪':'三重','四日市':'三重','福井':'福井','奈良':'奈良','向日町':'京都','和歌山':'和歌山','岸和田':'大阪','玉野':'岡山','広島':'広島','防府':'山口','高松':'香川','小松島':'徳島','高知':'高知','松山':'愛媛','小倉':'福岡','久留米':'福岡','武雄':'佐賀','佐世保':'長崎','別府':'大分','熊本':'熊本'};
function verify(input){
 const race=input?.race,ids=race?.riders?.map(r=>r.no)||[],lineup=race?.lineup||[];
 if(![7,9].includes(ids.length)||new Set(ids).size!==ids.length||ids.some(n=>!Number.isInteger(n)||n<1||n>9)||lineup.flat().length!==ids.length||new Set(lineup.flat()).size!==ids.length||!ids.every(n=>lineup.flat().includes(n))||!lineup.every(l=>l.length))throw Error('7/9車の全選手と並びが必要です');
 if(race.results||race.finish||race.combos||input.results||input.finish||input.combos||input.payouts)throw Error('着順情報の混入を検知しました');
 return race;
}
function feature(input,no,name,fallback=.45){const v=input.features?.[no]?.[name]?.value;return Number.isFinite(v)?clamp(v):fallback;}
function context(input,rider){
 const race=input.race,comments=(race.race_material?.comments||[]).filter(c=>c.rider?.replace(/\s/g,'')===rider.name.replace(/\s/g,'')&&c.body_verified===true);
 const body=comments.map(c=>String(c.comment||c.text||c.body||c.excerpt||'')).join(' ').slice(0,350);
 const denied=/先行(?:しない|しません|できない|無理)|無理に(?:駆け|先行)|主導権.{0,4}(?:狙わない|取らない)/.test(body);
 const clearIntent=!denied&&/主導権|先行|前で|積極的|駆ける|突っ張|カマシ/.test(body);
 const neutralIntent=/自在|位置|流れ|自力/.test(body);
 const locale=Boolean(prefecture[race.venue]&&prefecture[race.venue]===rider.meta?.prefecture);
 return {locale,clearIntent,neutralIntent,commentSources:comments.map(x=>x.url).filter(Boolean).slice(0,3),commentUsed:body.length>0};
}
function candidates(input){
 const race=verify(input),arr=race.riders.map(r=>{
  const line=race.lineup.find(l=>l.includes(r.no)),index=line.indexOf(r.no),c=context(input,r),initiative=feature(input,r.no,'initiative',r.style==='逃'?.68:.33),endurance=feature(input,r.no,'endurance'),sprint=feature(input,r.no,'sprint'),ability=feature(input,r.no,'ability'),front=feature(input,r.no,'front');
  const stage=String(race.class||''),championship=/決勝|特選|特別選抜/.test(stage),qualifying=/準決|予選/.test(stage),loserRound=/一般|特一般|敗者|負け戦|選抜/.test(stage)&&!/特別選抜/.test(stage),linePower=(line.length-1)*.12+(championship&&line.length>=3?.08:0);
  const leadTerm=Number(r.meta?.term),seniorBehind=Number.isInteger(leadTerm)&&leadTerm>0&&line.slice(index+1).some(n=>{const other=race.riders.find(x=>x.no===n),term=Number(other?.meta?.term);return Number.isInteger(term)&&term>0&&term<leadTerm;});
  const score=.24+initiative*.98+endurance*.28+sprint*.21+front*.12+ability*.14+linePower+(c.clearIntent?.19+(loserRound?.04:0):c.neutralIntent?.06:0)+(c.locale?.08:0)+(seniorBehind?.035:0)+(qualifying?.02:0)-(index>0?.51+.11*(index-1):0)-(line.length===1?.14:0);
  return {no:r.no,name:r.name,line:line.slice(),lineIndex:index,weight:max(.035,score),basis:[
    '先行傾向 '+initiative.toFixed(2),'ライン'+line.length+'車',index===0?'ライン先頭':'ライン'+(index+1)+'番手',c.clearIntent?'本人コメントの先行意向':c.commentUsed?'本人コメント参照':'先行意向コメント未取得',c.locale?'地元':null,seniorBehind?'ライン後位に上位期の先輩（期別比較・関係性は未断定）':null,championship?'特選・決勝':qualifying?'予選・準決勝':loserRound?'負け戦・選抜（本人の主導権意向を重視）':null
   ].filter(Boolean),commentSources:c.commentSources};
 });
 const total=arr.reduce((x,y)=>x+y.weight,0);
 return arr.map(x=>({...x,support:Math.round(x.weight/total*1000)/10})).sort((a,b)=>b.weight-a.weight||a.no-b.no);
}
function tacticsFor(input,no){
 const r=verify(input),line=r.lineup.find(l=>l.includes(no));
 return line[0]===no?['press','hold','kamashi','makuri']:['surge','makuri','kamashi'];
}
function chooseTactic(input,no){
 const allowed=tacticsFor(input,no),front=feature(input,no,'front'),kamashi=feature(input,no,'kamashi'),initiative=feature(input,no,'initiative');
 if(allowed.includes('surge'))return 'surge';
 if(front>.64&&initiative>.52)return 'press';
 if(kamashi>.63)return 'kamashi';
 return 'hold';
}
function snapshot(input,no,tactic){
 const race=verify(input),selected=race.riders.find(r=>r.no===no);
 if(!selected)throw Error('B指定選手が出走表にいません');
 const allowed=tacticsFor(input,no),mode=tactic==='auto'||!tactic?chooseTactic(input,no):tactic;
 if(!allowed.includes(mode))throw Error('B通過選手の並びと戦法が整合しません');
 const owner=race.lineup.find(l=>l.includes(no)),idx=owner.indexOf(no),riders=new Map(race.riders.map(r=>[r.no,r]));
 const otherHeads=race.lineup.filter(l=>l!==owner).map(l=>l[0]);
 const lead=feature(input,no,'ability'),power=feature(input,no,'sprint'),en=feature(input,no,'endurance');
 const leadingCost={press:.43,hold:.18,kamashi:.38,makuri:.39,surge:.27}[mode];
 const contest=otherHeads.map(n=>({no:n,resistance:feature(input,n,'initiative')*.43+feature(input,n,'ability')*.32+feature(input,n,'sprint')*.25})).sort((a,b)=>b.resistance-a.resistance);
 const opponentPressure=contest[0]?.resistance??.4;
 const cost=clamp(leadingCost+max(0,opponentPressure-(lead*.40+power*.35+en*.25))*.24,.08,.78);
 const states=[];
 const positionFor=(n,l,i)=>{
  if(n===no)return {gap:0,role:'B先頭',track:'先頭'};
  if(l===owner){
   if(i<idx)return {gap:2.25+(idx-i-1)*.7,role:'元ライン前方・踏み直し',track:'前後交代'};
   const follower=i-idx,track=feature(input,n,'track'),gap= follower*.75+max(0,.52-track)*2+(mode==='kamashi'||mode==='makuri'? .6*follower:0);
   return {gap,role:follower===1?'B番手':'Bライン追走',track:gap>2.25?'離れ気味':'追走'};
  }
  const rank=otherHeads.indexOf(l[0]),strength=feature(input,l[0],'sprint')*.46+feature(input,l[0],'ability')*.35+feature(input,l[0],'makuri')*.19;
  const base=1.85+rank*.85-max(0,strength-.55)*1.9+(mode==='press'?.37:0);
  return {gap:base+i*.85,role:i===0?'別線自力・捲り射程':'別線追走',track:i===0?'外並走候補':'追走'};
 };
 for(const line of race.lineup){
  for(let i=0;i<line.length;i++){
   const n=line[i],r=riders.get(n),p=positionFor(n,line,i),own=n===no,external=line!==owner;
   const ability=feature(input,n,'ability'),finish=feature(input,n,'finish'),speed=feature(input,n,'sprint'),endurance=feature(input,n,'endurance'),track=feature(input,n,'track'),initiative=feature(input,n,'initiative');
   const spent=own?cost:external?(i===0?.20+max(0,opponentPressure-.55)*.15:.15+i*.045):i<idx?.48:.10+max(0,.53-track)*.24+(mode==='kamashi'?.09:0);
   const remaining=clamp(.94-spent+endurance*.16,.06,.99);
   const closing=external&&i===0?clamp(.32+speed*.43+ability*.24+feature(input,n,'makuri')*.16-spent*.17):clamp(.1+finish*.34+speed*.2+ability*.18);
   const reachable=p.gap<2.5||p.gap<4.6&&closing>.49;
   states.push({no:n,name:r.name,line:line.slice(),lineIndex:i,role:p.role,track:p.track,gap:Math.round(p.gap*100)/100,remaining:Math.round(remaining*100)/100,closing:Math.round(closing*100)/100,ability,finish,speed,initiative,reachable,atB:own?'先頭':p.gap<1.6?'直後':p.gap<3.2?'射程内':'後方'});
  }
 }
 states.sort((a,b)=>a.gap-b.gap||a.no-b.no);
 return {bNo:no,tactic:mode,tacticLabel:TACTICS[mode],line:owner.slice(),leadingCost:Math.round(cost*100)/100,pressure:Math.round(opponentPressure*100)/100,states,logic:[
  no+'番が最終Bを先頭通過（この条件を固定）',
  '獲得経路は'+TACTICS[mode]+'、消耗指数'+Math.round(cost*100)/100,
  'Bラインの入着は必須とせず、別線の速度・位置・残脚を同じ条件で評価',
  '位置・消耗は戦術モデルの相対指標であり、実測車間ではない'
 ]};
}
function finishRanking(input,snap,limit=10){
 const states=snap.states,lookup=new Map(states.map(s=>[s.no,s]));
 const viable=states.filter(s=>s.gap<=5.5||s.reachable);
 const contender=s=>s.gap<=2.7||s.reachable&&s.gap<4.7;
 const traction=s=>clamp(s.closing*.52+s.remaining*.30+s.speed*.18);
 function first(s){
  let value=s.ability*.32+s.finish*.14+s.speed*.13+s.remaining*.24+traction(s)*.28-s.gap*.10;
  if(s.no===snap.bNo)value+=.12;
  if(s.role==='別線自力・捲り射程')value+=traction(s)*.11;
  if(s.track==='離れ気味')value-=.12;
  return value;
 }
 function follow(s){return s.ability*.27+s.finish*.24+s.speed*.12+s.remaining*.24+traction(s)*.18-s.gap*.07;}
 const points=[];
 for(const a of viable.filter(contender))for(const b of viable)for(const c of viable){
  if(a.no===b.no||a.no===c.no||b.no===c.no)continue;
  if(b.gap>5.6||c.gap>6.2)continue;
  // Avoid a rider who was clearly detached suddenly winning from deep behind.
  if(a.track==='離れ気味'&&a.gap>2.3)continue;
  const paired=a.line[0]===b.line[0]&&a.lineIndex>=0&&b.lineIndex>=0;
  const pairChange=paired?.025:0;
  const trio= a.line[0]===b.line[0]&&b.line[0]===c.line[0]?.015:0;
  const score=first(a)*1.18+follow(b)*.83+follow(c)*.61+pairChange+trio-
    max(0,b.gap-a.gap-2.2)*.025-max(0,c.gap-b.gap-2.4)*.015;
  const explanation=(a.no===snap.bNo?'B獲得選手の踏み直し':a.role==='別線自力・捲り射程'?'別線自力の捲り・直線強襲':a.line[0]===snap.line[0]?'B側の後位から抜け出し':'Bを取らない別線からの差し・強襲')+
    '。'+a.no+'番の残脚'+a.remaining.toFixed(2)+'、Bでの相対位置'+a.atB+'を起点に'+b.no+'番、'+c.no+'番の進路と脚を比較';
  points.push({trio:[a.no,b.no,c.no],key:[a.no,b.no,c.no].join('-'),score:Math.round(score*10000)/10000,reason:explanation,leaderIsWinner:a.no===snap.bNo,allWithinBLine:[a,b,c].every(s=>s.line.join('-')===snap.line.join('-'))});
 }
 points.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
 if(!points.length)return [];
 const threshold=points[0].score-.20;
 return points.filter(t=>t.score>=threshold).slice(0,max(1,min(10,Math.trunc(limit))));
}
function build(input,opts={}){
 const races=verify(input),bCandidates=candidates(input),bNo=opts.bNo===undefined?bCandidates[0].no:Number(opts.bNo),tactic=opts.tactic||'auto';
 const snap=snapshot(input,bNo,tactic),tickets=finishRanking(input,snap,opts.limit===undefined?10:opts.limit);
 return {version:VERSION,race:{date:races.date,venue:races.venue,race_no:races.race_no,start:races.start,grade:races.grade,class:races.class,lineup:races.lineup,riders:races.riders.map(r=>({no:r.no,name:r.name,score:r.score,style:r.style}))},bCandidates,b:snap,tickets,provenance:{input_time:input.as_of||null,mode:opts.bNo===undefined?'AI B推奨':'手動B指定',tactic_selection:tactic},caveat:'B通過を条件にする未校正の展開・着順ランキング。Bの相対支持度と三連単スコアは的中確率ではない。着順やオッズは入力に使わない。'};
}
const api={VERSION,TACTICS,candidates,tacticsFor,chooseTactic,snapshot,finishRanking,build,verify};
if(typeof module!=='undefined')module.exports=api;
root.BAxisEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this);
