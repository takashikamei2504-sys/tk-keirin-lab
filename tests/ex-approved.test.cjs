'use strict';
const assert=require('node:assert/strict');
const {ingest}=require('../scripts/ex_approved_ingest.cjs');
const pull=require('../scripts/ex_authorized_pull.cjs');
const Profile=require('../js/ex-profile.js');
const ExData=require('../js/b-axis/ex-data.js');
const Brain=require('../js/race-brain.js');
const source='https://www.winticket.jp/keirin/yokkaichi/racecard/2026110548/4/12';
const ref='WT-licensed-reuse-reference-2026';
const permit={approved:true,redistributionApproved:true,reference:ref};
const snapshot={
 schema:'tk-winticket-ex-raw-snapshot/v1',captured_at:'2026-11-08T01:00:00.000Z',
 source_url:source,race_id:'2026110548-4-12',
 riders:[{player_id:'14838',source_fields:{
    exSpurt:{percentage:80,succeeded:4,total:5},
    exThrust:{percentage:60,succeeded:3,total:5},
    exSplitLine:{percentage:50,succeeded:5,total:10},
    exLeftBehind:{percentage:10,succeeded:1,total:10},
    exSnatch:{percentage:0,succeeded:0,total:5},
    exCompete:{percentage:100,succeeded:2,total:2}
  }},{player_id:'12000',source_fields:{
    exSpurt:{percentage:0,succeeded:0,total:0},
    exLeftBehind:{percentage:25,succeeded:2,total:8}
  }}]
};
const feed={
 schema:'tk-winticket-ex-authorized-feed/v1',
 license:{source:'WINTICKET',reference:ref,bulk_collection_approved:true,
  public_redistribution_approved:true,model_use_approved:true,expires_at:'2099-01-01'},
 snapshots:[{venue:'四日市',date:'2026-11-08',race_no:12,
  race_start:'2026-11-08T12:00:00+09:00',snapshot}]
};
assert.throws(()=>ingest(feed,{},{}),/EX_RIGHTS_NOT_APPROVED/);
assert.throws(()=>ingest({...feed,license:{...feed.license,model_use_approved:false}}, {},permit),
 /EX_FEED_OR_RIGHTS_SCOPE_INVALID/);
assert.throws(()=>ingest({...feed,license:{...feed.license,expires_at:'2020-01-01'}},{},permit),/EX_RIGHTS_EXPIRED/);
const {latest,history}=ingest(feed,{},permit);
assert.equal(history.length,1);
assert.equal(latest.license_status,'approved-for-model-and-publication');
assert.equal(latest.summary.covered_venues,1);
assert.equal(latest.summary.covered_races,1);
assert.equal(latest.summary.valid_metrics,7);
assert.equal(latest.riders['14838'].metrics.kamashi.events,4);
assert.equal(latest.riders['14838'].metrics.tobitsuki.events,0);
assert.deepEqual(latest.riders['14838'].metrics.seri,{events:2,opportunities:2});
assert.equal(latest.riders['12000'].metrics.kamashi,undefined,'zero denominator must stay absent');
const rider={no:3,name:'古性優作',style:'両',score:117,meta:{rider_id:'14838'}};
const race={date:'2026-11-08',start:'12:00',lineup:[[3,1],[2,4],[5,6,7]],riders:[]};
const before='2026-11-08T02:00:00.000Z';
assert.equal(ExData.evidence({race,as_of:before,bAxisEx:latest},rider,'kamashi').events,4);
const pending={...latest,license_status:'pending'};
assert.equal(ExData.evidence({race,as_of:before,bAxisEx:pending},rider,'kamashi'),null);
assert.equal(Profile.record(latest,rider,race,Date.parse(before)).collected_at,snapshot.captured_at);
assert.equal(Profile.record(pending,rider,race,Date.parse(before)),null);
assert.equal(Profile.record(latest,rider,race,Date.parse('2026-11-08T00:00:00Z')),null);
assert.equal(Profile.record(latest,rider,{...race,date:'2026-11-07'},Date.now()),null);
const empty={front:.3,resist:.4,withdraw:.4,kamashi:.4,makuri:.5,track:.5,seat:.5,recover:.5,finish:.5,outer:.5,
 evidence:[],measurements:[],basis:'基礎'};
Profile.attach(empty,rider,race,latest,Date.parse(before));
assert.equal(empty.ex_used,6);
assert(empty.ex_kamashi_delta>0);
const races={...race,riders:[
 rider,...[1,2,4,5,6,7].map(no=>({no,name:'R'+no,score:100,style:'両',
 meta:{rider_id:String(10000+no)}}))
]};
const p0=Brain.profiles(races,{}).get(3);
const p1=Brain.profiles(races,{exPack:latest,exAsOf:Date.parse(before)}).get(3);
assert.equal(p0.ex_used,undefined);
assert.equal(p1.ex_used,6);
assert.equal(p1.ex_source_url,source);
assert(p1.ex_chigiri_delta>0);
assert(p1.ex_chigirarare_delta<0);
const p2=Brain.profiles(races,{exPack:pending,exAsOf:Date.parse(before)}).get(3);
assert.equal(p2.ex_used,undefined);
assert.equal(p2.kamashi,p0.kamashi,'baseline remains identical without rights');
assert.equal(pull.config({}),null);
assert.throws(()=>pull.config({EX_BULK_RIGHTS_APPROVED:'true',EX_PUBLICATION_RIGHTS_APPROVED:'true',
 EX_RIGHTS_REFERENCE:ref,EX_FEED_URL:source,EX_FEED_HOST:'www.winticket.jp'}),/UNAPPROVED_EX_SOURCE_HOST/);
console.log('EX_AUTHORIZED_PIPELINE_TESTS_OK '+JSON.stringify({
 count:latest.summary.valid_metrics,acceptedRiders:latest.summary.unique_riders,
 licenseGate:true,preRaceGuard:true,offlineImport:true,baselinePreserved:true}));
