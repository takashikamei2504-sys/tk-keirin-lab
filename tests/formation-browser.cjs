'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('fs');
const D=require('../js/formation-diagram.js'),B=require('../js/story-brain.js'),F=require('./formation-fixtures.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true}),page=await browser.newPage();
 const css=fs.readFileSync('css/formation-diagram.css','utf8'),race=require('../race_sample.json'),out=B.build(race);
 const previous=[null,F.cases[0],F.cases[1],F.cases[2],F.scene(4),F.scene(4),F.cases[5]];
 const examples=F.cases.map((s,i)=>({model:D.project(s,F.race,previous[i]),cars:7})).concat(out.story.main.scenes.map((s,i)=>({model:D.project(s,race,out.story.main.scenes[i-1]),cars:9})));
 for(const width of [320,390]){
  await page.setViewportSize({width,height:844});
  await page.setContent('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#0b1420;color:#e8f3ff;font-family:system-ui,sans-serif}main{width:calc(100% - 88px);margin:auto}'+css+'</style><main>'+examples.map((e,i)=>'<section id="example-'+i+'">'+D.render(e.model,{storyId:'test-'+i})+'</section>').join('')+'</main></html>');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'whole page overflow at '+width);
  for(let i=0;i<examples.length;i++){
   const example=page.locator('#example-'+i),e=examples[i];
   assert.equal(await example.locator('.formation-rider').count(),e.model.finish?3:e.cars);
   const boxes=await example.locator('.formation-rider').evaluateAll(nodes=>nodes.map(n=>({x:n.getBoundingClientRect().x,right:n.getBoundingClientRect().right,width:n.getBoundingClientRect().width})));
   assert.ok(boxes.every(r=>r.x>=0&&r.right<=width&&r.width>=14),'visible rider chips at '+width+' case '+i);
   assert.equal(await example.locator('.formation-name, .formation-podium .formation-chip-name').evaluateAll(nodes=>nodes.every(n=>parseFloat(getComputedStyle(n).fontSize)>=13&&n.scrollWidth<=n.clientWidth+1&&n.textContent.length>0)),true,'names must be readable and uncropped');
   if(!e.model.finish){assert.equal(await example.locator('.formation-track').count(),1,'single continuous formation');assert.equal(await example.locator('.formation-roster-item').count(),e.cars);}
   assert.deepEqual(JSON.parse(await example.locator('figure').getAttribute('data-engine-order')),e.model.order);
  }
 }
 await browser.close();console.log('PASS 320/390px seven/nine-rider formation, resist, outside, gap, seat, block, inside, vertical and finish diagrams');
})().catch(e=>{console.error(e);process.exit(1);});
