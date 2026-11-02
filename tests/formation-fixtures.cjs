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
module.exports={race,scene,cases:[initial,red,parallel,seat,block,vertical,finish]};
