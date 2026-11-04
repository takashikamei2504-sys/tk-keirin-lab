/* One event = one effort charge, with a non-recoverable reserve and re-acceleration surcharge. */
(function(root){'use strict';
const BASE=Object.freeze({
 wait:.012,draft:.04,pace:.17,cut:.30,press:.34,resist:.39,
 kamashi:.43,long:.48,short:.37,follow:.12,counter:.28,
 position:.24,withdraw:.13,recover:.30,block:.18,
 use:.12,continue:.09,stalled:.18,parallel:.15,pass:.22,pass_middle:.16,
 vertical:.13,relaunch:.37,reconnect:.16,seat:.17,
 seat_won:.19,seat_held:.16,seat_partial:.21,seat_fail:.13,
 inside:.18,counter_pass:.25,detach:.12,yield:.035,
 front:0,finish:0
});
const SURGE=new Set(['cut','press','resist','kamashi','long','short','counter','position','recover','relaunch']);
const round=x=>Math.round(x*10000)/10000;
function initial(ids){return Object.fromEntries(ids.map(id=>[id,{spent:0,surges:0,usedDraft:0,actions:[]}]));}
function budget(endurance=.5){return round(3.2+1.5*Math.max(0,Math.min(1,Number.isFinite(endurance)?endurance:.5)));}
function charge(state,id,action,opts={}){
 if(!Object.hasOwn(BASE,action))return null;
 if(!state.effort)state.effort={};
 const prev=state.effort[id]||{spent:0,surges:0,usedDraft:0,actions:[]};
 const surge=SURGE.has(action),repeat=surge?prev.surges*.15:0,drafting=opts.drafted===true?-.18:0;
 const gross=Math.max(action==='front'||action==='finish'?0:.01,(BASE[action]??.25)+repeat+drafting);
 const next={spent:round(prev.spent+gross),surges:prev.surges+(surge?1:0),usedDraft:prev.usedDraft+(opts.drafted?1:0),actions:[...prev.actions,{action,cost:round(gross),repeat:round(repeat),drafted:!!opts.drafted,phase:opts.phase??null}]};
 state.effort[id]=next;
 return {cost:round(gross),repeat:round(repeat),spent:next.spent,surges:next.surges};
}
function fatigue(state,id){return state.effort?.[id]?.spent||0;}
function reserve(state,id,endurance=.5){return round(Math.max(0,budget(endurance)-fatigue(state,id)));}
const api={BASE,SURGE,initial,budget,charge,fatigue,reserve};
if(typeof module!=='undefined')module.exports=api;
root.LineEffort=api;
})(typeof globalThis!=='undefined'?globalThis:this);
