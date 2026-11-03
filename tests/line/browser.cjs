'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/kurinaka12-afk/**',route=>route.fulfill({status:404,body:'not yet available'}));
 await page.route('https://kurinaka12-afk.github.io/**',route=>route.fulfill({status:404,body:'not yet available'}));
 await page.goto(process.env.LINE_URL||'http://127.0.0.1:8765/line.html');
 await page.locator('details summary').first().click();await page.locator('#example9').click();await page.waitForFunction(()=>window.lineOutput?.input.race.riders.length===9);
 assert.equal(await page.locator('.scene').count(),6);assert.equal(await page.locator('.formation svg').count(),6);
 assert.equal(await page.evaluate(()=>lineOutput.mode),'historical-replay');assert.match(await page.locator('.race-title').innerText(),/再計算/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'390px overflow');
 for(let i=0;i<6;i++){const displayed=await page.locator('.formation').nth(i).getAttribute('data-order');assert.deepEqual(JSON.parse(displayed),await page.evaluate(i=>lineOutput.main.scenes[i].order,i));}
 await page.locator('#compare').click();await page.waitForFunction(()=>window.lineComparison);assert.ok(await page.evaluate(()=>lineComparison.old.chosen.length>0));
 const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise,exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(exported.provenance.input_sha256,await page.evaluate(()=>lineOutput.provenance.input_sha256));
 await page.locator('#example7').click();await page.waitForFunction(()=>window.lineOutput?.input.race.riders.length===7);assert.equal(await page.locator('.scene').count(),6);
 assert.equal(await page.locator('.formation').first().locator('.rider').count(),7);
 await page.setViewportSize({width:320,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'320px overflow');
 await page.setViewportSize({width:390,height:844});
 const fixture=require('../../race_sample.json'),date='2098-10-31',entries=fixture.riders.map(x=>({car_number:x.no,rider_full_name:x.name,competition_score:x.score,running_style:x.style,line_position:(fixture.lineup.findIndex(l=>l.includes(x.no))+1)+'-'+(fixture.lineup.find(l=>l.includes(x.no)).indexOf(x.no)+1)}));
 const day={date,generated_at:new Date(Date.now()-1000).toISOString(),races:[{venue:'防府',race_number:12,start_time:'16:25',entries}]};
 await page.route('**/2098-10-31.json',route=>route.fulfill({json:day,headers:{'access-control-allow-origin':'*'}}));
 await page.locator('#date').fill(date);await page.locator('#date').dispatchEvent('change');await page.waitForFunction(()=>document.getElementById('status').textContent.includes('開催情報を取得しました'));
 await page.locator('#load').click();await page.waitForFunction(()=>window.lineOutput?.input.race.date==='2098-10-31');assert.equal(await page.evaluate(()=>lineOutput.mode),'pre-race');
 const frozen=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('tk-line:first:')).map(k=>[k,localStorage[k]]));assert.equal(frozen.length,1);
 await page.locator('#load').click();await page.waitForFunction(()=>document.getElementById('save-status').textContent.includes('最初の発走前予想を保持'));assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('tk-line:first:')).map(k=>[k,localStorage[k]])),frozen);
 await page.locator('#example9').click();await page.waitForFunction(()=>window.lineOutput?.input.race.riders.length===9);
 await page.locator('.axis details summary').click();await page.screenshot({path:'reports/line/iphone-preview.png',fullPage:true});
 assert.equal(errors.length,0,errors.join('\n'));await browser.close();console.log('PASS LAB LINE mobile: 7/9 riders, 6 exact engine diagrams, 320/390px, same-input comparison, live feed selection, immutable device storage, JSON export and replay labeling');
})().catch(e=>{console.error(e);process.exit(1);});
