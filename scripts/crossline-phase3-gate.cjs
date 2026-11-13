#!/usr/bin/env node
'use strict';
/**
 * Phase 3 pre-race gate. Research only: no stake/order/production mutation.
 * Inputs are category, a frozen pre-race risk-priority boolean and the ranked
 * ordered first/second cross-line pairs. Results and payouts are never read.
 */
const CATEGORY = Object.freeze({'A7':'A7','C7':'C7','A級_7':'A7','チャレンジ_7':'C7'});
function parsedPair(v) {
 const a=Array.isArray(v)?v:String(v??'').split('-');
 if(a.length!==2||a.some(x=>!Number.isInteger(+x)||+x<1||+x>9)||+a[0]===+a[1])return null;
 return [+a[0],+a[1]];
}
function select({category,highrisk,pairs}={}) {
 const cat=CATEGORY[category]||null;
 if(!cat)return {eligible:false,reason:'unsupported_category',category:cat,reverse_pair:null};
 if(typeof highrisk!=='boolean')return {eligible:false,reason:'risk_unknown',category:cat,reverse_pair:null};
 if(!highrisk)return {eligible:false,reason:'risk_below_threshold',category:cat,reverse_pair:null};
 if(!Array.isArray(pairs)||pairs.length<2)return {eligible:false,reason:'pairs_missing',category:cat,reverse_pair:null};
 const a=parsedPair(pairs[0]),b=parsedPair(pairs[1]);
 if(!a||!b)return {eligible:false,reason:'pairs_invalid',category:cat,reverse_pair:null};
 const reverse=a[0]===b[1]&&a[1]===b[0];
 return {eligible:!reverse,reason:reverse?'reverse_pair':'selected',category:cat,reverse_pair:reverse};
}
module.exports={CATEGORY,parsedPair,select};
