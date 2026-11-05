'use strict';
const assert=require('node:assert/strict'),S=require('../js/s-counts.js');
const raw={date:'2026-11-05',venue:'大宮',race_no:9,start:'14:24',riders:[{no:1,name:'小畑勝広',s:0,meta:{absent_fields:['s','b']}},{no:2,name:'野崎将史',s:0,meta:{absent_fields:['s']}}]};
const base={date:raw.date,venue:raw.venue,race_no:raw.race_no,race_id:'202611052509',complete:true,source_url:'https://keirin.netkeiba.com/race/entry/?race_id=202611052509',collected_at:'2026-11-05T03:00:00Z',riders:[{no:1,name:'小畑勝広',s:0},{no:2,name:'野崎将史',s:2}]};
const pack={schema:S.schema,snapshots:[base]};
const result=S.attach(raw,pack,Date.parse('2026-11-05T03:10:00Z'));
assert.deepEqual(result.riders.map(x=>x.s),[0,2]);assert.deepEqual(result.riders[0].meta.absent_fields,['b']);assert.equal(result.riders[0].s_source.race_id,base.race_id);
for(const change of [{...base,riders:[{no:1,name:'別人',s:3},{no:2,name:'野崎将史',s:2}]},{...base,collected_at:'2026-11-05T06:00:00Z'},{...base,riders:[{no:1,name:'小畑勝広',s:3}]}]){
 assert.equal(S.attach(raw,{...pack,snapshots:[change]},Date.parse('2026-11-05T06:10:00Z')).riders[0].meta.absent_fields.includes('s'),true);
}
console.log('S counts race binding: OK');
