'use strict';
const urls=[
 'https://www.winticket.jp/keirin/yokkaichi/racecard/2026110548/races',
 'https://www.winticket.jp/keirin/cyclist/014838',
 'https://www.winticket.jp/keirin/column/ex_data',
 'https://www.winticket.jp/keirin/yokkaichi/racecard/2026110548/4/12',
 'https://www.winticket.jp/keirin/yokkaichi/racecard/2026110548/4/12?tab=exdata'
];
(async()=>{
 for(const url of urls){
  try{
   const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; TKKeirinLab-SourceCheck/1.0)'},
     signal:AbortSignal.timeout(11000)});
   const html=(await r.text()).slice(0,2200000);
   const keywords=['__NEXT_DATA__','__NUXT__','ちぎられ','ちぎり','かまし','つっぱり','exData','ex_data','EXデータ','EXDATA','競輪選手','tsuppari','chigiri','chigirare','kamashi','solo'];
   const snippets=Object.fromEntries(keywords.map(k=>{
    const i=html.toLowerCase().indexOf(k.toLowerCase());return [k,{index:i,snippet:i<0?null:html.slice(Math.max(0,i-80),i+155)}];
   }));
   const links=[...html.matchAll(/https?:\/\/[^"'<> ]{5,150}/g)].slice(0,6).map(x=>x[0]);
   const raceLinks=[...new Set([...html.matchAll(/href="([^"]*\/yokkaichi\/racecard\/2026110548[^"]*)"/g)].map(x=>x[1]))].slice(0,24);
   console.log('B_AXIS_EX_ACCESS '+JSON.stringify({url,status:r.status,size:html.length,contentType:r.headers.get('content-type'),title:html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]||null,snippets,links,raceLinks}));
  }catch(e){console.log('B_AXIS_EX_ACCESS '+JSON.stringify({url,error:String(e.message||e)}));}
 }
})();