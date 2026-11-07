/* B-AXIS independent mobile app. RaceFeed + LineInput only for shared pre-race materials.
 * Neither LAB's nor LINE's prediction engine is loaded.
 */
(function(){'use strict';
const $=id=>document.getElementById(id),escape=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const venues=['函館','青森','いわき平','弥彦','前橋','取手','宇都宮','大宮','西武園','京王閣','立川','松戸','川崎','平塚','小田原','伊東','静岡','名古屋','岐阜','大垣','豊橋','富山','松阪','四日市','福井','奈良','向日町','和歌山','岸和田','玉野','広島','防府','高松','小松島','高知','松山','小倉','久留米','武雄','佐世保','別府','熊本'];
let day=null,loadedInput=null,output=null,requestId=0,packs={},manualB=false;
$('venue').replaceChildren(...venues.map(v=>new Option(v,v)));$('venue').value='防府';
$('race').replaceChildren(...Array.from({length:12},(_,i)=>new Option((i+1)+'R',i+1)));$('race').value='12';
$('date').value=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function status(message){$('status').textContent=message;}
async function json(url){const c=new AbortController(),timer=setTimeout(()=>c.abort(),14000);try{const response=await fetch(url,{signal:c.signal,cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);return await response.json();}finally{clearTimeout(timer);}}
async function fetchDay(date){let err;for(const base of ['https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/','https://kurinaka12-afk.github.io/keirin-app-data/'])try{const p=await json(base+date+'.json');if(p.date!==date||!Array.isArray(p.races)||p.races.length>250)throw Error('日付かデータ形式が不正');return p;}catch(e){err=e;}throw err||Error('日別データ未取得');}
async function fetchPacks(){
 const sources={intelligence:'data/intelligence.json',recent:'data/recent_form.json',material:'data/race_material.json',s:'data/s_counts.json'};
 const result=await Promise.allSettled(Object.entries(sources).map(async ([name,url])=>[name,await json(url)]));
 for(const r of result)if(r.status==='fulfilled')packs[r.value[0]]=r.value[1];
 return result.filter(r=>r.status!=='fulfilled').length;
}
function races(){if(!day)return;const p=$('venue').value,found=day.races.filter(r=>r.venue===p&&!r.is_girls&&[7,9].includes(r.entries?.length));if(found.length)$('race').replaceChildren(...found.map(r=>new Option(r.race_number+'R',r.race_number)));}
async function refresh(){
 const token=++requestId;status('開催情報を取得しています');try{const date=$('date').value,p=await fetchDay(date);if(token!==requestId)return;day=p;const available=[...new Set(p.races.filter(r=>!r.is_girls&&[7,9].includes(r.entries?.length)).map(r=>r.venue))];if(!available.length)throw Error('対象の男子7/9車データなし');const old=$('venue').value;$('venue').replaceChildren(...available.map(v=>new Option(v,v)));$('venue').value=available.includes(old)?old:available[0];races();status('開催日・競輪場・Rを選んで予想してください');}catch(e){if(token===requestId)status('公開出走表未取得：'+e.message+'。下の保存例で画面を確認できます。');}
}
function lineText(input){return input.race.lineup.map(l=>l.join('-')).join(' / ');}
function chooseB(no){
 if(!loadedInput)return;
 manualB=false;
 const prev=$('b-choice').value;const bs=BAxisEngine.candidates(loadedInput);
 $('b-choice').replaceChildren(...bs.map(b=>new Option(b.no+'番 '+b.name+' ｜ '+b.support.toFixed(1)+'pt',b.no)));
 $('b-choice').value=String(no??bs[0].no);
 $('tactic-choice').value='auto';
 tacticOptions();render();
}
function tacticOptions(){
 const no=Number($('b-choice').value),available=BAxisEngine.tacticsFor(loadedInput,no),old=$('tactic-choice').value;
 $('tactic-choice').replaceChildren(new Option('AI推奨','auto'),...available.map(t=>new Option(BAxisEngine.TACTICS[t],t)));
 $('tactic-choice').value=available.includes(old)?old:'auto';
}
function scoreLabel(){return '相対スコア（未校正）';}
function compress(tickets){
 const map=new Map();
 for(const t of tickets){
  const [a,b,c]=t.trio,k=a+'-'+b;if(!map.has(k))map.set(k,[]);map.get(k).push(c);
 }
 return [...map].map(([k,thirds])=>k+'-'+thirds.join('')+' ('+thirds.length+'点)');
}
function renderPhases(scenes){
 return scenes.map((s,i)=>{
  const entries=s.positions.slice().sort((a,b)=>a.ordinal-b.ordinal);
  const parts=s.lineOrder?.map(l=>l.join('-')).join(' / ')||entries.map(p=>p.no).join('-');
  const cards=entries.map(p=>'<span class="phase-rider'+(p.no===scenes[3].leader?' phase-b':'')+(p.lane>0?' phase-outer':'')+'">'+p.no+(p.lane>0?' 外':'')+'</span>').join('');
  const events=(s.events||[]).slice(0,6).map(e=>'<li>'+escape(e.reason)+'</li>').join('');
  const head=s.leader===undefined?'':s.leader+'番が先頭';
  return '<details class="phase-card"'+([2,3,4].includes(i)?' open':'')+'><summary><strong>'+escape(s.label)+'</strong><span>'+escape(head)+'</span></summary>'+
  '<p class="phase-lines">'+escape(parts)+'</p><div class="phase-riders">'+cards+'</div><ul>'+events+'</ul></details>';
 }).join('');
}
function show(){
 const r=loadedInput.race,chosen=output.b,tickets=output.tickets,lead=output.bCandidates.find(x=>x.no===chosen.bNo),allB= tickets.some(t=>t.leaderIsWinner),outsiders=tickets.filter(t=>!t.leaderIsWinner).length;
 $('context').innerHTML='<small>'+escape(r.date+' '+r.venue+r.race_no+'R / '+r.grade+' '+r.class)+'</small><h2>'+escape(lineText(loadedInput))+'</h2><p class="muted">B予想 '+output.bCandidates.slice(0,3).map(x=>x.no+'番 '+x.support.toFixed(1)+'pt').join(' ／ ')+'。予測確率ではなく相対比較です。</p>';
 $('b-headline').textContent='B：'+chosen.bNo+'番 '+chosen.tacticLabel;
 $('scenario').innerHTML='<p>'+escape(chosen.logic[0])+'。'+escape(chosen.logic[1])+'。</p><p>最終B時点の全選手の位置と脚の状態から着順を生成。Bライン以外の1着・2着・3着、別線による上位独占も除外しません。</p><p class="muted">B支持度：'+lead.support.toFixed(1)+'pt ／ B選手の消耗 '+chosen.leadingCost.toFixed(2)+'（0〜1のモデル指標）</p>';
 $('phases').innerHTML=renderPhases(chosen.phases||[]);
 const post=chosen.interactions;
 if(post){
  const available=post.attackers.filter(x=>x.blockable);
  const drops=post.detachment.map(x=>x.no+'番').join('・');
  $('scenario').innerHTML+='<p class="muted">B後の攻防仮説：別線反撃 '+post.attackers.length+'候補、牽制が成立し得る攻防 '+available.length+'組、追走離れ想定 '+(drops||'なし')+'。いずれも実測回数ではありません。</p>';
 }
 $('positions').innerHTML=chosen.states.map(s=>'<div class="place"><strong>'+s.no+' '+escape(s.name)+'</strong><span>'+escape(s.role)+'</span><span>'+escape(s.atB)+'・残脚'+s.remaining.toFixed(2)+'</span></div>').join('');
 $('ticket-count').textContent=tickets.length+'点';
 $('tickets').innerHTML=tickets.length?tickets.map((t,i)=>'<div class="ticket"><div class="ticket-head"><span class="rank">'+(i+1)+'</span><strong>'+t.key+'</strong><span class="tiny">'+scoreLabel()+' '+t.score.toFixed(3)+'</span></div><div class="ticket-reason">'+escape(t.reason)+'</div></div>').join(''):'<p>成立条件を満たす候補がありません。戦法を変更してください。</p>';
 $('compressed').textContent=compress(tickets).join(' ／ ');
 $('model-remark').textContent=output.caveat;
 $('extras').hidden=false;
 const isLive=!loadedInput.replay&&Date.parse(loadedInput.as_of)<Date.parse(loadedInput.cutoff)&&Date.now()<Date.parse(loadedInput.cutoff);
 if(isLive)try{const id='tk-baxis:first:'+r.date+':'+r.venue+':'+r.race_no;
  if(!localStorage.getItem(id))localStorage.setItem(id,JSON.stringify({savedAt:new Date().toISOString(),inputAsOf:loadedInput.as_of,model:output.version,first:output}));
 }catch(e){}
}
function render(){
 if(!loadedInput)return;
 try{output=($('model-choice').value==='baseline'?BAxisBaseline:BAxisEngine).build(loadedInput,{bNo:manualB?Number($('b-choice').value):undefined,tactic:$('tactic-choice').value,limit:Number($('limit').value)});window.bAxisOutput=output;show();status('B通過選手・戦法に応じて決着を再計算しました');}
 catch(e){status('再計算できません：'+e.message);$('extras').hidden=true;}
}
async function prepareExample(n){
 const token=++requestId;status('保存入力を取得しています');try{
 const record=await json('reports/line/example-'+n+'.json');if(token!==requestId)return;
 const input=LineInput.prepare(record.input.race,{intelligence:record.input.replay_pack},Date.parse(record.input.as_of));
 input.replay=true;loadedInput=input;
 $('selector').hidden=false;chooseB();status('保存された発走前の材料を使った動作例です（当時のB-AXIS予測ではありません）');
 }catch(e){status('動作例を開けません：'+e.message);}
}
$('load').onclick=async()=>{
 const token=++requestId,date=$('date').value,venue=$('venue').value,no=Number($('race').value);$('load').disabled=true;status('出走表・選手情報を読み込んでいます');
 try{const p=await fetchDay(date),source=p.races.find(r=>r.venue===venue&&Number(r.race_number)===no);if(!source)throw Error('指定レースが日別データにありません');
 await fetchPacks();if(token!==requestId)return;
 const raw=SCounts.attach(RaceFeed.convert(source,p),packs.s);
 loadedInput=LineInput.prepare(raw,packs);$('selector').hidden=false;chooseB();status(venue+no+'RのB-AXIS予想を生成しました');
 }catch(e){if(token===requestId){status('予想できません：'+e.message);$('selector').hidden=true;$('extras').hidden=true;loadedInput=null;}}
 finally{$('load').disabled=false;}
};
$('b-choice').addEventListener('change',()=>{manualB=true;$('tactic-choice').value='auto';tacticOptions();render();});
$('tactic-choice').addEventListener('change',render);
$('limit').addEventListener('change',render);
$('model-choice').addEventListener('change',render);
$('example7').onclick=()=>prepareExample(7);$('example9').onclick=()=>prepareExample(9);
$('venue').onchange=races;$('date').onchange=refresh;
$('copy').onclick=async()=>{
 if(!output)return;
 const text=compress(output.tickets).join('\n');
 try{await navigator.clipboard.writeText(text);$('save-status').textContent='買い目をコピーしました';}catch(e){$('save-status').textContent='コピーできません。下の買い目を選択してください';}
};
$('export').onclick=()=>{
 if(!output)return;
 const info={...output,input_as_of:loadedInput.as_of,source:loadedInput.race.source,b_model:'B条件付きで着順を予測。着順は学習・入力に使わない'};
 const url=URL.createObjectURL(new Blob([JSON.stringify(info,null,2)],{type:'application/json'})),a=document.createElement('a');
 a.href=url;a.download='B-AXIS_'+output.race.date+'_'+output.race.venue+output.race.race_no+'R.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
};
refresh();
})();
