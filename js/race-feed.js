/* Shared public race input adapter. Provider predictions and results are never copied into model input. */
(function(root){'use strict';
function convert(source,day){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day?.date||'')||!source||source.is_girls||!Array.isArray(source.entries)||![7,9].includes(source.entries.length))throw Error('男子7車／9車の出走表ではありません');
 const used=new Set(),groups=new Map();
 const riders=source.entries.map(e=>{
  const no=Number(e.car_number),name=String(e.rider_full_name||e.rider_name||'').replace(/[\s\u3000]/g,''),score=Number(e.competition_score),style=String(e.running_style||'');
  const position=/^(\d{1,2})-(\d{1,2})$/.exec(String(e.line_position||''));
  if(!Number.isInteger(no)||no<1||no>9||used.has(no)||!name||name.length>40||!Number.isFinite(score)||score<50||score>145||!['逃','両','追'].includes(style)||!position)throw Error('選手・得点・並びに欠損または重複があります');
  used.add(no);const line=Number(position[1]),order=Number(position[2]);
  if(line<1||line>12||order<1||order>9)throw Error('並びが不正です');
  if(!groups.has(line))groups.set(line,[]);groups.get(line).push({no,order});
  return {no,name,score,style,s:0,b:0,wins:0,seconds:0,thirds:0,outs:0,meta:{rider_id:String(e.rider_id||''),term:e.term,prefecture:e.prefecture,rank:e.class_rank,supplied_fields:['name','score','style','line_position'],absent_fields:['s','b','wins','seconds','thirds','outs']}};
 });
 const lineup=[...groups.entries()].sort((a,b)=>a[0]-b[0]).map(([,line])=>{
  line.sort((a,b)=>a.order-b.order);if(line.some((p,i)=>p.order!==i+1))throw Error('並びの順序が不連続です');return line.map(p=>p.no);
 });
 const start=String(source.start_time||''),venue=String(source.venue||''),rn=Number(source.race_number);
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!venue||venue.length>20||!Number.isInteger(rn)||rn<1||rn>12)throw Error('レースの識別情報が不正です');
 return {date:day.date,venue,race_no:rn,start,lineup,riders,grade:({F1:'FI',F2:'FII',G1:'GI',G2:'GII',G3:'GIII',GP:'GP'})[String(source.grade||'').toUpperCase()]||'未確認',class:String(source.round_name||'未取得'),
  source:{mode:'live-public-feed',label:'公開日別データ（keirin-app-data）',url:'https://github.com/kurinaka12-afk/keirin-app-data',generated_at:String(day.generated_at||''),verified:false,missing_fields:['b_s_recent']}};
}
const api={convert};if(typeof module!=='undefined')module.exports=api;root.RaceFeed=api;
})(typeof globalThis!=='undefined'?globalThis:this);
