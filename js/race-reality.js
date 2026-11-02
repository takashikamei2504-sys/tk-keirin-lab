/* Conservative reality gates for 7/9 rider narrative simulation.
 * These are plausibility checks, NOT measured physics or legal adjudications.
 * Unknown speed, gaps and lanes must never be claimed as observed.
 */
(function(root){'use strict';
const VERSION='race-reality-v1.1.0';
const validOrder=(order,ids)=>Array.isArray(order)&&order.length===ids.length&&new Set(order).size===ids.length&&ids.every(n=>order.includes(n));
function attackOpportunity(s,no,phase){
 if(s.connected?.[no]===false&&(s.energy?.[no]||0)>.6&&!(s.recovery?.[no]>0))return {allowed:false,reason:'追走離れ直後で、再加速前の立て直しが足りない'};
 if((s.energy?.[no]||0)>=.85)return {allowed:false,reason:'既に高い仮説消耗。再加速の余地を確認できない'};
 if(phase==='late'&&s.homeRider===no&&s.homeResult==='takes'&&s.backRider&&s.backRider!==no){
   return {allowed:false,reason:'ホームで主導権を奪った直後に抜かれ、3角でもう一度全力で捲るには回復区間が不足'};
 }
 if(phase==='late'&&s.homeRider===no&&s.homeResult==='takes'&&s.backResult==='takes'){
   return {allowed:false,reason:'短い区間で仕掛けを繰り返す再加速を保守的に除外'};
 }
 return {allowed:true,reason:'位置・機会に基づく仮説。車間と実速度は未取得'};
}
function takeoverOpportunity(s,no,phase){
 const from=s.order?.indexOf(no);
 if(!Number.isInteger(from)||from<0)return {allowed:false,reason:'選手の現在位置が不明'};
 const continuous=(Array.isArray(s.outside)&&s.outside.includes(no))||
    (phase==='home'&&s.attacker===no&&s.outcome==='front-holds');
 // A rider may advance rapidly, but a model that has not represented a prior
 // run-up cannot silently promote a distant rider to first place.
 if(phase==='home'&&from>=5&&!continuous){
   return {allowed:false,reason:(from+1)+'番手から最終ホームで即座に先頭へ移る仕掛けの助走が記録されていない'};
 }
 if(phase==='back'&&from>=4&&!continuous){
   return {allowed:false,reason:(from+1)+'番手からバックまでに'+from+'人を一気に抜く軌跡・車間・速度が未収録。外並走の候補だけ残す'};
 }
 if(phase==='late'&&from>=3&&!continuous){
   return {allowed:false,reason:'3〜4角での大幅な順位ジャンプは、経路と勢いが確認できない'};
 }
 return {allowed:true,reason:'到達は未計測の仮説であり確定した物理シミュレーションではない'};
}
function finishingAccess(s,no,place){
 const index=s.order?.indexOf(no);
 if(index<0||place<1||place>3)return {allowed:false,reason:'位置または着位が不正'};
 const passing=Math.max(0,index+1-place);
 const attack=s.survivingAttack===no||s.innerRider===no||(s.outside||[]).includes(no);
 const vertical=s.defender===no&&s.defense==='vertical';
 const limit=attack?3:vertical?2:2;
 // Only the riders already in reach of the first group may win in the short
 // home straight; otherwise the model must first create an earlier surge.
 if(index>=5&&!attack)return {allowed:false,reason:'後方'+(index+1)+'番手から直線だけで急上昇する根拠がない'};
 if(passing>limit)return {allowed:false,reason:'直線だけで'+passing+'人を交わす移動を説明できない'};
 if(place===1&&index>3&&!attack)return {allowed:false,reason:'最終コーナーからの勝ち切り経路が未設定'};
 let route=vertical?'番手から縦に踏む':s.innerRider===no?'内の空きコースを使う':attack?'外の仕掛けをつなぐ':passing?'直線で'+passing+'人を交わす':'現在の位置を残す';
 return {allowed:true,passing,route,reason:'位置と仮説上の進路に基づく可到達性。速度・車間は未計測'};
}
function finishExplanation(s,trio,who){
 return trio.map((no,i)=>{
  const x=finishingAccess(s,no,i+1),from=s.order.indexOf(no)+1;
  const overtakers=trio.slice(0,i).filter(other=>s.order.indexOf(other)>s.order.indexOf(no));
  const result=from<i+1&&overtakers.length?
    who(no)+'は最終コーナー'+from+'番手から'+overtakers.map(who).join('・')+'に交わされるが、後続を抑えて'+(i+1)+'着に粘る。':
    who(no)+'は最終コーナー'+from+'番手から'+(i+1)+'着へ。'+x.route+'。';
  return result;
 }).join('');
}
function audit(s,ids){
 const issues=[];
 const fail=(code,reason)=>issues.push({code,reason});
 if(!validOrder(s.order,ids))fail('bad_order','隊列が全選手の順列になっていない');
 for(const [n,e] of Object.entries(s.energy||{}))if(!Number.isFinite(e)||e<0||e>1)fail('bad_energy',n+'番の消耗仮説値が範囲外');
 if(s.blockResult==='stopped'&&s.survivingAttack)fail('stopped_survives','ブロック成功なのに攻撃が継続している');
 if(s.cornerRider&&s.blockResult==='stopped'&&s.cornerOrderBefore){
  if(s.order.indexOf(s.cornerRider)<s.cornerOrderBefore.indexOf(s.cornerRider)){
   fail('blocked_advance','ブロックで止められた選手が前進している');
  }
 }
 if(s.backResult==='takes'&&s.backLeadPositionBefore>=5&&s.backRider&&!s.backWasContinuing)fail('back_teleport','バックで後方から突然先頭に出ている');
 if(s.cornerRider){
  const x=attackOpportunity(s.cornerEnergyBefore==null?s:{...s,energy:{...s.energy,[s.cornerRider]:s.cornerEnergyBefore}},s.cornerRider,'late');
  if(!x.allowed)fail('repeated_sprint',x.reason);
 }
 return {passed:issues.length===0,issues,level:'structural_consistency_only',limits:'車間・速度・走路・接触・正式な違反判定は未検証'};
}
const api={VERSION,validOrder,attackOpportunity,takeoverOpportunity,finishingAccess,finishExplanation,audit};
if(typeof module!=='undefined')module.exports=api;
root.RaceReality=api;
})(typeof globalThis!=='undefined'?globalThis:this);
