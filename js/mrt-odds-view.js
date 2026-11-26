/* Periodic quotes and a separate, immutable, price-aware MICRO comparison. */
(function(root){'use strict';
const key=t=>t.cars.join('-'),sum=ts=>ts.reduce((n,t)=>n+t.yen,0),time=s=>Date.parse(s);
function assess(item,s,entry,at=Date.now()){
 if(!item||item.schema!=='tk-mrt-odds-latest/v1')return {state:'unavailable',reason:'定期オッズはまだ取得されていません。'};
 const q=item.quote,p=item.plan;
 if(!q||q.schema!=='tk-mrt-trifecta-quote/v1'||q.market!=='trifecta'||q.state!=='live'||q.race_id!==s.race_id||item.race_id!==s.race_id||item.identity_sha256!==s.identity_sha256||q.identity_sha256!==s.identity_sha256||entry?.identity_sha256&&entry.identity_sha256!==s.identity_sha256)return {state:'unavailable',reason:'出走情報が変更されています。オッズの再取得待ちです。'};
 if(!/^https:\/\/keirin\.kdreams\.jp\/[a-z0-9-]+\/racedetail\/\d{16}\/\?pageType=odds&kakeshikiType=3rentan$/.test(q.source_url||''))return {state:'unavailable',reason:'オッズ出典を確認できません。'};
 const ids=Object.keys(s.roster||{});
 if(![7,9].includes(ids.length)||!q.roster||Object.keys(q.roster).length!==ids.length||!ids.every(c=>q.roster[c]===s.roster[c]))return {state:'unavailable',reason:'選手照合が一致しません。'};
 const market=q.odds||{},expected=ids.length*(ids.length-1)*(ids.length-2);
 if(Object.keys(market).length!==expected||Object.entries(market).some(([k,v])=>!/^\d-\d-\d$/.test(k)||new Set(k.split('-')).size!==3||!k.split('-').every(c=>ids.includes(c))||!Number.isFinite(v)||v<1||v>1e8))return {state:'unavailable',reason:'三連単オッズが揃っていません。'};
 const published=time(q.published_at),captured=time(q.captured_at),close=Math.min(time(q.sales_close_at),time(s.sales_close_at));
 if(![published,captured,close].every(Number.isFinite)||published>captured||captured>=close||at<captured||time(s.generated_at)>captured)return {state:'unavailable',reason:'取得時刻を確認できません。'};
 if(q.pool!=='all')return {state:'unavailable',reason:'全体発売のオッズを待っています。',quote:q};
 if(!p)return {state:'unavailable',reason:'調整案は保留：'+(item.unavailable_reason||'MICRO固定予想との照合待ち'),quote:q};
 const generated=time(p.generated_at),baseline=s.methods.D_hybrid,known=new Map(baseline.map(t=>[key(t),t.yen]));
 if(p.schema!=='tk-mrt-odds-plan/v1'||p.identity_sha256!==s.identity_sha256||p.race_id!==s.race_id||p.micro_protocol_id!==s.protocol_id||p.micro_generated_at!==s.generated_at||p.policy?.id!=='micro-odds-cover-v1'||p.policy.odds_haircut!=='0.80'||p.policy.minimum_return_ratio!=='1.10'||p.safety?.paper_only!==true||p.safety.automatic_promotion!==false||!Number.isFinite(generated)||generated>at||generated<captured||generated<time(s.generated_at)||generated>=close-120000||generated-Math.min(published,captured)>1200000||!Array.isArray(p.tickets))return {state:'unavailable',reason:'調整案の固定情報が一致しません。',quote:q};
 if(new Set(p.tickets.map(key)).size!==p.tickets.length||p.tickets.some(t=>known.get(key(t))!==t.yen||!Number.isInteger(t.yen)||t.yen<100||t.yen%100||!Number.isFinite(t.protected_return_yen)||t.protected_return_yen<0||t.protected_return_yen>Math.floor(market[key(t)]*t.yen*.8+1e-6))||sum(p.tickets)!==p.stake_yen||p.stake_yen>10000||!['ready','skip'].includes(p.status)||p.status==='ready'&&!p.tickets.length||p.status==='skip'&&p.tickets.length||p.tickets.some(t=>t.protected_return_yen<Math.ceil(p.stake_yen*1.1-1e-6)))return {state:'unavailable',reason:'調整案の金額または払戻条件が不正です。',quote:q};
 if(at>=close)return {state:'historical',reason:'締切済み：締切前に保存した比較記録です。',quote:q,plan:p};
 if(at>=close-120000)return {state:'unavailable',reason:'締切が近いため、新しい判断には使いません。',quote:q};
 if(at-Math.min(published,captured)>1200000)return {state:'unavailable',reason:'オッズが20分以上前のため、更新待ちです。',quote:q};
 return {state:p.status,reason:p.status==='skip'?'取得オッズで払戻条件を満たす買い目がなく、見送りです。':'取得時点のオッズを反映した比較案です。',quote:q,plan:p};
}
const api={assess};
if(typeof module!=='undefined'&&module.exports){module.exports=api;return;}
const $=id=>document.getElementById(id),yen=n=>n.toLocaleString('ja-JP')+'円';
const date=s=>new Date(s).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
let token=0,timer=null,active=null;
function clear(){token++;clearTimeout(timer);active=null;$('odds-rows').replaceChildren();$('odds-panel').hidden=true;}
async function render(s,entry){
 clearTimeout(timer);active={s,entry};
 const current=++token;const panel=$('odds-panel');panel.hidden=false;$('odds-rows').replaceChildren();$('odds-summary').textContent='';$('odds-time').textContent='';$('odds-source').hidden=true;$('odds-state').textContent='定期オッズを確認しています。';
 try{
  const response=await fetch('data/mrt_odds/latest/'+s.race_id+'.json',{cache:'no-store'});
  const item=response.status===404?null:response.ok?await response.json():(()=>{throw Error('HTTP '+response.status)})();
  if(current!==token)return;
  const result=assess(item,s,entry);$('odds-state').textContent=result.reason;
  if(result.quote){$('odds-time').textContent='取得 '+date(result.quote.captured_at)+' ／ 元オッズ更新 '+date(result.quote.published_at);$('odds-source').href=result.quote.source_url;$('odds-source').hidden=false;}
  if(!result.plan)return;
  const p=result.plan;$('odds-summary').textContent=p.tickets.length+'点 ・ 合計 '+yen(p.stake_yen)+'（元MICRO D '+yen(10000)+'）'+(p.tickets.length?' ／ 20%下落を見込んだ最低払戻 '+yen(p.minimum_protected_return_yen):'');
  for(const t of p.tickets){const tr=document.createElement('tr');for(const text of [key(t),yen(t.yen),result.quote.odds[key(t)].toFixed(1)+'倍',yen(t.protected_return_yen)]){const td=document.createElement('td');td.textContent=text;tr.append(td);}$('odds-rows').append(tr);}
 }catch(e){if(current===token)$('odds-state').textContent='定期オッズを取得できません：'+e.message;}
 finally{if(current===token&&Date.now()<time(s.sales_close_at))timer=setTimeout(()=>render(s,entry),60000);}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&active)render(active.s,active.entry);});
root.MrtOddsView={...api,render,clear};
})(typeof globalThis!=='undefined'?globalThis:this);
