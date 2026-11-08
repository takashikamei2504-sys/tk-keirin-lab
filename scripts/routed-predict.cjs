'use strict';
// Isolate expensive engine searches so one timeout cannot lose an entire day.
const fs=require('node:fs'),Router=require('../js/routing/router.js');
const {race,packs}=JSON.parse(fs.readFileSync(0,'utf8'));
const out=Router.build(race,packs,{engine:'auto',asOf:Date.now()});
const record=Router.snapshot(out,new Date().toISOString());
if(!record)throw Error('発走前に保存できませんでした');
process.stdout.write(JSON.stringify(record));
