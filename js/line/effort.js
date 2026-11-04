/* Finite effort and repeat-acceleration penalties. Scores are relative heuristics, NOT measured watts or physiological reserves. */
(function(root){'use strict';
const BASE=Object.freeze({
 wait:.015,draft:.04,pace:.17,cut:.30,press:.34,resist:.39,
 kamashi:.43,long:.48,short:.37,follow:.12,counter:.25,
 position:.24,withdraw:.13,recover:.30,block:.18
});
const SURGE=new Set(['cut','press','resist','kamashi','long','short','counter','position','recover']);
const round=x=>Math.round(x*10000)/10000;
function initial(ids){return Object.fromEntries(ids.map(id=>[id,{spent:0,surges:0,usedDraft:0,actions:[]}]));}
function charge(state,id,action,opts={}){
 if(!state.effort)state.effort={};
 const prev=state.effort[id]||{spent:0,surges:0,usedDraft:0,actions:[]};
 const surge=SURGE.has(action);
 const repeat=surge?prev.surges*.15:0;
 const drafting=opts.drafted===true?-.10:0;
 const gross=Math.max(.025,(BASE[action]??.25)+repeat+drafting);
 const next={spent:round(prev.spent+gross),surges:prev.surges+(surge?1:0),usedDraft:prev.usedDraft+(opts.drafted?1:0),actions:[...prev.actions,{action,cost:round(gross),repeat:round(repeat),drafted:!!opts.drafted,phase:opts.phase||null}]};
 state.effort[id]=next;
 return {cost:round(gross),repeat:round(repeat),spent:next.spent,surges:next.surges};
}
function fatigue(state,id){return state.effort?.[id]?.spent||0;}
const api={BASE,initial,charge,fatigue};
if(typeof module!=='undefined')module.exports=api;
root.LineEffort=api;
})(typeof globalThis!=='undefined'?globalThis:this);
