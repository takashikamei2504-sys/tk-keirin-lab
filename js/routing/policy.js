/* Fixed race categories; the selected race's outcome never enters routing. */
(function(root){'use strict';
const VERSION='race-policy-20261109-v1';
const names={physical:'成立条件修正版',causal:'因果展開・従来',roi_coverage:'ROI分散選択',lab_v5:'LAB現行v5.6',line:'LAB LINE'};
const rules={
 'A級_7':{engine:'physical',n:5558,roi:.8056337711406981,trim1:.7876664267722202,trim5:.7444269521410579},
 'S級_7':{engine:'roi_coverage',n:2386,roi:.8200471821756226,trim1:.7803669724770642,trim5:.687040629095675},
 'S級_9':{engine:'physical',n:1148,roi:.9043009581881533,trim1:.8394163763066202,trim5:.6969947735191637},
 'チャレンジ_7':{engine:'causal',n:2454,roi:.7607885085574572,trim1:.7197687449062755,trim5:.5991595354523227}
};
Object.values(rules).forEach(Object.freeze);Object.freeze(rules);Object.freeze(names);
const norm=x=>String(x||'').normalize('NFKC').replace(/[\s\u3000]/g,'');
function classify(r){
 if(!r||!Array.isArray(r.riders)||![7,9].includes(r.riders.length))throw Error('男子7車・9車の出走表が必要です');
 const rank=r.riders.map(x=>norm(x.meta?.rank)),label=norm(r.class),cars=r.riders.length;
 if(r.is_girls||rank.some(x=>/^L/.test(x))||/ガールズ|L級/.test(label))throw Error('ガールズは自動選択の対象外です');
 let grade=rank.some(x=>/^S(?:S|[12]|級)/.test(x))?'S級':rank.every(x=>/^(?:A3|A級3班)$/.test(x))?'チャレンジ':rank.some(x=>/^A(?:[123]|級)/.test(x))?'A級':null;
 if(!grade)grade=/チャレンジ|A級チ(?:・|予|選|準|決|一)/.test(label)?'チャレンジ':/S級/.test(label)?'S級':/A級/.test(label)?'A級':'級班不明';
 if(grade==='級班不明')throw Error('級班を取得できません。出走表を更新してください');
 return {grade,cars,key:grade+'_'+cars};
}
function select(r,choice='auto'){
 const category=classify(r),rule=rules[category.key],fallback=!rule;
 if(choice!=='auto'&&!Object.hasOwn(names,choice))throw Error('指定したエンジンは選択できません');
 const engine=choice==='auto'?(rule?.engine||'physical'):choice;
 return {policy_version:VERSION,requested:choice,engine,label:names[engine],category,fallback:choice==='auto'&&fallback,
  reason:choice!=='auto'?'手動で選択したエンジンを適用':rule?category.grade+category.cars+'車：半年比較の最大的中除外後回収率を優先':category.grade+category.cars+'車：区分別の比較件数が少ないため全体首位の標準エンジンを適用',
  benchmark:choice==='auto'&&rule?{...rule,start:'2026-05-08',end:'2026-11-07',points:8,stake_per_ticket:100,inputs:'basic-card',criterion:'trim-largest-winning-race'}:null};
}
const api={VERSION,names,rules,classify,select};if(typeof module!=='undefined')module.exports=api;root.RaceRoutingPolicy=api;
})(typeof globalThis!=='undefined'?globalThis:this);
