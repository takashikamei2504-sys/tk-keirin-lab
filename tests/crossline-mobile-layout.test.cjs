'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const view=fs.readFileSync(path.join(__dirname,'../js/crossline/selected-view.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../crossline-selected.html'),'utf8');
const factory=view.split('\n').find(line=>line.startsWith('const tag='));
assert.ok(factory,'tag factory must remain inspectable');
const create=new Function('document',factory+'\nreturn tag;');
const tag=create({createElement:name=>({nodeName:name})});
for(const empty of [null,undefined]){
 const el=tag('div',empty,'candidate-tickets');
 assert.equal(el.textContent,undefined,'null / undefined MUST NOT create visible text');
 assert.equal(el.className,'candidate-tickets');
}
assert.equal(tag('span','三連単4点').textContent,'三連単4点');
assert.equal(tag('span',0).textContent,'0','real numeric zero is not missing');
assert.equal(tag('span','').textContent,'');
assert.equal(tag('span','4-7-3').textContent,'4-7-3');
assert.ok(view.includes("tag('details',null,'formation-details')"),'formation display must be collapsed per race');
assert.ok(view.includes("fold.append(tag('summary'"),'accessible summary for expandable formations');
assert.ok(html.includes('.candidate-tickets{grid-template-columns:repeat(2,minmax(0,1fr))'),'2-up readable ticket display');
assert.ok(html.includes('max-width:390px'),'small-screen CSS is present');
assert.ok(html.includes('js/crossline/selected-view.js?v=5'),'cache-busted UI after bug fix');
console.log('PASS mobile race list: no literal null cells, compact 2-column picks and expandable formations');
