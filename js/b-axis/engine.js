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
 const owner=race.lineup.find(l=>l.includes(no)),idx=owner.indexOf(no);
 const riders=new Map(race.riders.map(r=>[r.no,r]));
 const get=(n,key,def)=>feature(input,n,key,def);
 const otherLines=race.lineup.filter(l=>l!==owner);
 const threat=line=>{
  const head=riders.get(line[0]),n=head.no,self=head.style!=='追';
  const initiative=get(n,'initiative',.3),speed=get(n,'sprint',.4),skill=get(n,'ability',.4);
  return self?clamp(initiative*.3+speed*.36+skill*.27+(line.length>=3?.07:0)):.08+skill*.10;
 };
 const threatMap=new Map(otherLines.map(l=>[l[0],threat(l)]));
 const sorted=otherLines.slice().sort((a,b)=>threat(b)-threat(a)||a[0]-b[0]);
 const mainThreat=sorted.length?threat(sorted[0]):0;
 const baseCost={press:.43,hold:.33,kamashi:.47,makuri:.47,surge:.39}[mode];
 const effort=clamp(baseCost+mainThreat*.18+max(0,sorted.length-1)*.025+(mode==='press'?.05:0),.27,.79);
 const states=[];
 for(const line of race.lineup)for(let i=0;i<line.length;i++){
  const n=line[i],r=riders.get(n),own=n===no,inOwner=line===owner;
  const ability=get(n,'ability',.4),finish=get(n,'finish',.4),speed=get(n,'sprint',.4);
  const endurance=get(n,'endurance',.4),initiative=get(n,'initiative',.3),tracking=get(n,'track',.45),makuri=get(n,'makuri',.4);
  let gap=0,role='',track='追走',attack=false;
  let spent=.15,entry='';
  if(own){
   role='B先頭';track='先頭';spent=effort;entry='最終Bを先頭通過';
  }else if(inOwner){
   if(i<idx){
    gap=2.15+(idx-i-1)*1.0;role='先頭を譲った元ライン前方';track='切替待ち';spent=.42;
    entry='番手以降の選手がBを取り、前の選手は再配置';
   }else{
    const follow=i-idx;
    gap=.70*follow+(mode==='kamashi'||mode==='makuri'?.36*follow:0)+max(0,.50-tracking)*1.4;
    role=follow===1?'B番手':'Bライン追走';
    track=gap>=2.45?'追走離れ気味':'追走';
    spent=.12+.055*follow+(mode==='kamashi'||mode==='makuri'?.09:0)+max(0,.50-tracking)*.19;
    entry='B取得戦法に応じた踏み出しと追走を評価';
   }
  }else{
   const head=riders.get(line[0]),rank=sorted.indexOf(line),self=head.style!=='追';
   const force=threatMap.get(head.no)??0;
   const competitive=self&&(force>=.42||makuri>=.62&&i===0);
   const outside=competitive&&force>=.54;
   const headGap=outside?max(1.1,2.75-(force-.54)*5.6):competitive?2.45+rank*.50:3.15+rank*.60;
   gap=headGap+i*(outside?.86:1.03)+max(0,.52-tracking)*.35*i+(mode==='kamashi'?.25:0);
   role=i===0?(self?'別線自力・仕掛け候補':'単騎／別線追込・切替待ち'):'別線追走';
   attack=i===0&&competitive;
   track=outside&&i===0?'外並走・追撃可能':attack?'仕掛けの射程':self?'追走':'中団・後方待機';
   spent=i===0&&attack?.27+max(0,force-.52)*.12:.15+.045*i;
   entry=i===0?attack?'バック後に仕掛けを継続可能':'直線の進路・切替を待つ':'自力選手に追走・連結を維持';
  }
  const remaining=clamp(.95-spent+.12*endurance,.05,.99);
  const closing=clamp(.17+speed*.34+ability*.21+finish*.12+makuri*.09+remaining*.11);
  const reachable=gap<=2.4||attack&&gap<=4.0&&closing>=.48;
  states.push({no:n,name:r.name,line:line.slice(),lineIndex:i,riderStyle:r.style,role,track,entry,attack,gap:Math.round(gap*100)/100,spent:Math.round(spent*100)/100,remaining:Math.round(remaining*100)/100,closing:Math.round(closing*100)/100,ability,finish,speed,initiative,reachable,atB:own?'先頭':gap<1.55?'直後':gap<3?'射程内':'後方'});
 }
 states.sort((a,b)=>a.gap-b.gap||a.no-b.no);
 const topOpponents=sorted.slice(0,2).map(l=>l[0]);
 return {bNo:no,tactic:mode,tacticLabel:TACTICS[mode],line:owner.slice(),leadingCost:Math.round(effort*100)/100,pressure:Math.round(mainThreat*100)/100,states,topOpponents,logic:[
  no+'番が最終Bを先頭通過（これだけを固定）',
  'B獲得経路は'+TACTICS[mode]+'。競合ラインの抵抗を加味した先頭の消耗指数'+effort.toFixed(2),
  '外を踏める別線と、位置取りを待つ追込選手を区別。全選手のB後の勝ち筋を比較',
  'B選手・Bラインの入着は条件としない。位置は仮説上の相対値で実測車間ではない'
 ]};
}
function finishRanking(input,snap,limit=10){
 const states=snap.states,byNo=new Map(states.map(s=>[s.no,s])),b=byNo.get(snap.bNo);
 const inLine=states.filter(s=>s.line.join('-')===snap.line.join('-')&&s.no!==snap.bNo);
 const mark=inLine.find(s=>s.role==='B番手'),third=inLine.find(s=>s.role==='Bライン追走'&&s.track!=='追走離れ気味');
 const attackers=states.filter(s=>s.attack&&s.reachable);
 const rivals=states.filter(s=>s.no!==b.no&&s.reachable&&s.role!=='B番手');
 const coverage=states.filter(s=>s.no!==b.no&&s.gap<5.0);
 function strength(s){
  return s.ability*.34+s.speed*.19+s.finish*.20+s.remaining*.22+s.closing*.18;
 }
 function pace(s){
  return strength(s)+s.closing*.25-s.gap*.075;
 }
 const externalPressure=attackers.reduce((v,s)=>max(v,pace(s)-pace(b)+.20),0);
 const sustainability=clamp(b.remaining-.15*externalPressure);
 const routes=[];
 const scene={
  hold:'B選手がバックで主導権を維持。別線の仕掛けをしのぎ、直線で踏み直す',
  marker:'Bの番手が連結を維持。牽制・直線の伸びでB選手を差す',
  outside:'別線の自力選手がBではまだ先頭でないが、外並走・捲りを4角まで継続して逆転',
  inside:'内の進路を待った追込選手がコースを拾い差す'
 };
 const same=(x,y)=>x.line[0]===y.line[0];
 const fitSecond=(a,s)=>{
  if(s.no===a.no)return false;
  if(s.gap>4.7&&!s.reachable)return false;
  return true;
 };
 const pathReasons={
  hold:snap.tacticLabel+'からBを獲得、B選手が踏み直す',
  marker:'B番手が連結を維持し、最終3〜4角から直線で差す',
  outside:'別線の自力がB直後から外を踏み、最終3〜4角で先頭を捕える',
  inside:'前で競り合う間に内の進路へ切り替えて直線を伸びる'
 };
 function add(pair,mode,thirds,extra=0){
  const a=byNo.get(pair[0]),d=byNo.get(pair[1]);
  if(!a||!d||!fitSecond(a,d))return;
  for(const n of thirds){
   const c=byNo.get(n);
   if(!c||new Set([a.no,d.no,c.no]).size!==3||c.gap>5.1)continue;
   if(c.track==='追走離れ気味'&&c.gap>3.0)continue;
   let physical=0;
   if(mode==='outside'&&(!a.attack||!a.reachable))continue;
   if(mode==='marker'&&a.role!=='B番手')continue;
   if(mode==='hold'&&a.no!==b.no)continue;
   if(mode==='inside'&&(a.riderStyle!=='追'||a.gap>2.3||a.attack))continue;
   const scoreBase=pace(a)*1.10+strength(d)*.76+strength(c)*.55-.031*d.gap-.022*c.gap;
   const paired=same(a,d)? .035:0,attached=same(d,c)? .025:0;
   const approach=mode==='hold'?
      .15+(sustainability-.53)*.45-externalPressure*.19:
      mode==='marker'?
      .18+(b.spent-.36)*.48+(a.finish-b.finish)*.42:
      mode==='outside'?
      .15+(a.closing-b.closing)*.66+(b.spent-.38)*.36-a.gap*.022:
      .015+(b.spent-.40)*.28;
   if(mode==='outside'&&a.closing<b.closing-.20)physical-=.18;
   if(mode==='hold'&&b.spent>.64)physical-=.14;
   const score=scoreBase+approach+paired+attached+extra+physical;
   const road=pathReasons[mode]+'。'+d.no+'番は'+d.role+'、'+c.no+'番は'+c.role+'の位置から上位を争う';
   const reason=road+'。B位置・前半消耗・直線脚色を評価（勝者をB側に固定しない）';
   routes.push({trio:[a.no,d.no,c.no],key:[a.no,d.no,c.no].join('-'),score,reason,path:mode,corner:scene[mode],leaderIsWinner:a.no===snap.bNo,allWithinBLine:[a,d,c].every(s=>s.line.join('-')===snap.line.join('-'))});
  }
 }
 const others=coverage.map(s=>s.no);
 if(mark){
  const covers=[third?.no,...others].filter(Boolean);
  add([b.no,mark.no],'hold',covers);
  add([mark.no,b.no],'marker',covers);
  for(const o of attackers){
   if(o.no===mark.no)continue;
   add([b.no,o.no],'hold',[mark.no,...others]);
   add([mark.no,o.no],'marker',[b.no,third?.no,...others].filter(Boolean));
  }
  if(third){
   add([mark.no,third.no],'marker',[b.no,...others]);
  }
 }else for(const o of attackers)add([b.no,o.no],'hold',[...others]);
 for(const o of attackers){
  const follower=states.find(s=>same(s,o)&&s.lineIndex===o.lineIndex+1&&s.track!=='追走離れ気味');
  const candidateSeconds=[b.no,mark?.no,follower?.no,...attackers.filter(x=>x.no!==o.no).map(x=>x.no)].filter(Boolean);
  for(const n of new Set(candidateSeconds)){
   add([o.no,n],'outside',[b.no,mark?.no,third?.no,follower?.no,...others].filter(Boolean));
  }
 }
 // Pure chase-only riders can finish first via an already reachable inner lane,
 // but never as fictitious self-propelled makuri riders.
 for(const s of rivals.filter(s=>s.riderStyle==='追'&&s.role==='単騎／別線追込・切替待ち'&&s.gap<=2.3)){
   add([s.no,b.no],'inside',[mark?.no,...others].filter(Boolean));
 }
 // Once B is known, race outcome still branches into hold, marker pass and outside attack;
 // no fixed allocation by B line or by first place. Collapse duplicate paths and
 // mildly penalize repeated same 1-2 pair to avoid 10 near-identical tickets.
 const best=new Map();
 for(const t of routes){
  if(!best.has(t.key)||best.get(t.key).score<t.score)best.set(t.key,t);
 }
 const pool=[...best.values()].sort((a,z)=>z.score-a.score||a.key.localeCompare(z.key)),selected=[],keys=new Set();
 const maxCount=max(1,min(10,Math.trunc(limit))),top=pool[0]?.score||0;
 while(selected.length<maxCount){
  const ranked=pool.filter(t=>!keys.has(t.key)).map(t=>{
   const pair=t.trio.slice(0,2).join('-'),repeatPair=selected.filter(x=>x.trio.slice(0,2).join('-')===pair).length,
     repeatPath=selected.filter(x=>x.path===t.path).length;
   const adjusted=t.score-repeatPair*.055-repeatPath*.012;
   return {...t,adjusted};
  }).sort((a,b)=>b.adjusted-a.adjusted||a.key.localeCompare(b.key));
  if(!ranked.length||ranked[0].adjusted<top-.42)break;
  const picked=ranked[0];
  keys.add(picked.key);
  selected.push({...picked,score:Math.round(picked.adjusted*10000)/10000});
 }
 return selected;
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
