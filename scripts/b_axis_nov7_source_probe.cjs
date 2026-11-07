'use strict';
const venues={四日市:48,熊本:87,高知:74,京王閣:27,小倉:81,福井:51,弥彦:21};
(async()=>{
 for(const [venue,code] of Object.entries(venues)){
  const url='https://www.chariloto.com/keirin/results/'+code+'/2026-11-07';
  try{
   const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 (compatible; KeirinLabResearch/1.0)","Accept-Language":"ja,en;q=0.8"},signal:AbortSignal.timeout(14000)});
   const html=await r.text();
   const pos=html.indexOf('第1レース'),apos=html.indexOf('S/B'),bpos=html.indexOf('>B<');
   const event=html.match(/第[0-9０-９]+レース/g)?.length||0;
   const rows=[...html.matchAll(/<tr\b[^>]*>[\s\S]{0,3000}?<\/tr>/g)].slice(0,45).map(x=>x[0]);
   const bRows=rows.filter(x=>/>\s*B\s*</.test(x)||/>\s*S\s*B\s*</.test(x));
   console.log('B_AXIS_NOV7_SOURCE '+JSON.stringify({venue,url,status:r.status,size:html.length,events:event,first:html.slice(0,155),pos,apos,bpos,context:apos>=0?html.slice(apos-100,apos+175):null,
     firstB:bRows[0]?.slice(0,1600)||null,oneResultRow:rows.find(x=>/>5</.test(x))?.slice(0,1100)||null}));
  }catch(e){console.log('B_AXIS_NOV7_SOURCE '+JSON.stringify({venue,url,error:String(e.message||e)}));}
 }
})();