/* Renderer contract examples. Synthetic states, not published race forecasts. */
const race={date:'2026-11-02',venue:'表示確認',race_no:1,start:'16:00',lineup:[[1,2,3],[4,5],[6,7]],riders:['先頭一郎','番手二郎','三番三郎','別線四郎','追走五郎','外方六郎','後方七郎'].map((name,i)=>({no:i+1,name,score:100,style:i===0||i===3||i===5?'逃':'追'}))};
const order=[1,2,3,4,5,6,7];
function scene(stage,extra={},arr=order){return {stage,phase:['並び確認・S取り','赤板周回～打鐘','最終ホーム','最終バック','最終3～4コーナー','最後の直線'][stage-1],action:'表示確認用の状態',shape:'一本棒',order:[...arr],tactical:{schema:'tk-keirin-scene-state/v1',leader:1,front:1,starter:2,control_line:[1,2,3],connected:Object.fromEntries(order.map(n=>[n,true])),outside:[],gap:'holds',defender:2,...extra}};}
const initial=scene(1),red=scene(2,{attacker:4,tactic:'kamashi',stand:'resist',outcome:'front-holds',encounter:{outside:4,front:1,tactic:'kamashi',stand:'resist',leader:1}});red.shape='踏み合い';
const parallel=scene(3,{homeRider:4,homeResult:'parallel',outside:[4],gap:'breaks',defender:null,connected:{1:true,2:false,3:false,4:true,5:true,6:true,7:true}},[1,4,5,2,3,6,7]);parallel.shape='併走';
const seat=scene(4,{seat:4,defender:4,gap:'breaks',connected:parallel.tactical.connected},[1,4,5,2,3,6,7]);
const block=scene(5,{cornerRider:4,cornerOrigin:'makuri',outside:[4],defense:'block',blockResult:'stopped',corner_order_before:order,openInside:true,innerRider:3,innerMode:'split'});block.shape='外の攻防・内に空き';
const vertical=scene(5,{cornerRider:4,outside:[4],defense:'vertical',blockResult:'free',corner_order_before:order});vertical.shape='外からの仕掛け';
const finish=scene(6,{finish_order:[2,1,3],finish_from:order,defense:'vertical'},[2,1,3,4,5,6,7]);finish.shape='ゴール前';
const doubleAttack=scene(4,{homeRider:4,homeResult:'parallel',backRider:6,backResult:'parallel',outside:[4,6]});doubleAttack.shape='二つの仕掛け';
const tripleBand=scene(5,{homeRider:4,homeResult:'parallel',backRider:6,backResult:'parallel',outside:[4,6],cornerRider:6,defense:'vertical',openInside:true,innerRider:3,innerMode:'split'});tripleBand.shape='外と内の攻防';
const race9={...race,lineup:[...race.lineup,[8,9]],riders:[...race.riders,{no:8,name:'追加八郎',score:100,style:'逃'},{no:9,name:'追加九郎',score:100,style:'追'}]};
const overlaps9=[doubleAttack,tripleBand].map(s=>({...s,order:[...s.order,8,9],tactical:{...s.tactical,connected:{...s.tactical.connected,8:true,9:true}}}));
const following=structuredClone(parallel);following.tactical.outside_groups=[{head:4,members:[4,5]}];
const dropped=structuredClone(following);dropped.tactical.connected[5]=false;dropped.tactical.outside_groups=[{head:4,members:[4]}];
const groupedDouble=structuredClone(doubleAttack);groupedDouble.tactical.outside_groups=[{head:4,members:[4,5]},{head:6,members:[6,7]}];
const followCorner=scene(5,{cornerRider:4,cornerOrigin:'outer',outside:[4],outside_groups:[{head:4,members:[4,5]}],defense:'vertical'},[1,2,4,3,5,6,7]);
const followRace9={...race9,lineup:[[1,2,3],[4,5,8],[6,7,9]]};
const following9=scene(4,{backRider:4,backResult:'parallel',outside:[4],outside_groups:[{head:4,members:[4,5,8]}],connected:Object.fromEntries([1,2,3,4,5,6,7,8,9].map(n=>[n,true]))},[1,2,3,4,5,8,6,7,9]);
module.exports={race,race9,followRace9,following9,following:[following,dropped,groupedDouble,followCorner],overlaps9,scene,overlaps:[doubleAttack,tripleBand],cases:[initial,red,parallel,seat,block,vertical,finish]};
