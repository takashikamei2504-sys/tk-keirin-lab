'use strict';
// B is read only from the explicit S/B column. Finish and winning move never infer B.
const codes={'函館':11,'青森':12,'いわき平':13,'弥彦':21,'前橋':22,'取手':23,'宇都宮':24,'大宮':25,'西武園':26,'京王閣':27,'立川':28,'松戸':31,'川崎':34,'平塚':35,'小田原':36,'伊東':37,'静岡':38,'名古屋':42,'岐阜':43,'大垣':44,'豊橋':45,'富山':46,'松阪':47,'四日市':48,'福井':51,'奈良':53,'向日町':54,'和歌山':55,'岸和田':56,'玉野':61,'広島':62,'防府':63,'高松':71,'小松島':73,'高知':74,'松山':75,'小倉':81,'久留米':83,'武雄':84,'佐世保':85,'別府':86,'熊本':87};
const clean=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').normalize('NFKC').replace(/\s/g,'');

function parse(html, date, venue, expected, collectedAt) {
  const found={};
  const sections=[...html.matchAll(/第(\d+)レース[\s\S]*?(?=第\d+レース|$)/g)];
  for(const section of sections){
    const raceNo=Number(section[1]),id=date+':'+venue+':'+raceNo,race=expected.get(id);
    if(!race)continue;
    const tables=[...section[0].matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/g)].map(m=>m[0]);
    const tablesWithB=tables.filter(t=>t.includes('S/B'));
    if(tablesWithB.length!==1)continue;
    const table=tablesWithB[0],heads=[...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(m=>clean(m[1]));
    const idx={car:heads.indexOf('車番'),name:heads.indexOf('選手名'),b:heads.indexOf('S/B'),place:heads.indexOf('着')};
    if(Object.values(idx).some(i=>i<0))continue;
    const rows=[...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m=>[...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(c=>clean(c[1]))).filter(r=>r.length===heads.length);
    const names=rows.map(r=>[Number(r[idx.car]),r[idx.name]]).sort((a,b)=>a[0]-b[0]);
    const known=race.identity.map(([no,,name])=>[no,clean(name)]).sort((a,b)=>a[0]-b[0]);
    const b=rows.filter(r=>/B/.test(r[idx.b]));
    if(JSON.stringify(names)!==JSON.stringify(known)||b.length!==1)continue;
    const podium=rows.filter(r=>/^[123]$/.test(r[idx.place])).map(r=>[Number(r[idx.place]),Number(r[idx.car])]);
    if(!race.combos.some(c=>c.trio.every((n,i)=>podium.some(([rank,no])=>rank===i+1&&no===n))))continue;
    found[id]={race_id:id,b_no:Number(b[0][idx.car]),identity:race.identity,combos:race.combos.map(c=>c.key),
      source_url:'https://www.chariloto.com/keirin/results/'+codes[venue]+'/'+date,
      source_column:'S/B',collected_at:collectedAt,verified_identity:true,verification:'independent_public_result_table'};
  }
  return found;
}

async function collect(expected, previous={}, maxPages=16, checkedPages=[]) {
  const result={...previous},errors=[],checked=[];
  const groups=[...new Set([...expected.values()].filter(r=>!result[r.race_id]).map(r=>r.race.date+'|'+r.race.venue))].filter(g=>!checkedPages.includes(g)).sort().reverse().slice(0,maxPages);
  // One venue/day page contains every race. Bound requests and retain prior evidence.
  for(const group of groups){
    const [date,venue]=group.split('|');
    if(!codes[venue])continue;
    const url='https://www.chariloto.com/keirin/results/'+codes[venue]+'/'+date;
    try{
      const res=await fetch(url,{signal:AbortSignal.timeout(12000)});
      if(!res.ok)throw Error('HTTP '+res.status);
      const html=await res.text();
      const parsed=parse(html,date,venue,expected,new Date().toISOString());
      Object.assign(result,parsed);
      if(Object.keys(parsed).length)checked.push(group);
    }catch(e){errors.push({url,error:e.message});}
  }
  return {records:result,errors,checked_pages:checked};
}

module.exports={parse,collect,codes};
