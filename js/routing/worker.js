/* Isolated searches keep race selection responsive on iPhone. */
'use strict';
const key=new URL(self.location.href).searchParams.get('v')||'routing-1';
const load=files=>importScripts(...files.map(p=>new URL('../'+p+'?v='+encodeURIComponent(key),self.location.href).href));
load(['ex-profile.js','tactical-transitions.js','race-brain.js']);self.CausalRaceBrain=self.RaceBrain;
load(['model-provenance.js','model-build.js','branch-weights.js','brain-memory.js','race-material.js','rider-context.js','decision-reasons.js','tactical-deliberation.js','cross-line-tactics.js','race-reality.js','line-reactions.js','finish-review.js','search-policy.js','story-brain.js']);self.StoryRaceBrain=self.RaceBrain;
load(['s-counts.js','recent-form.js','line/input.js','line/build.js','line/state.js','line/interactions.js','line/effort.js','line/physical.js','line/positioning.js','line/selection.js','line/conditions.js','line/tickets.js','line/sensitivity.js','line/engine.js','roi/hypotheses-build.js','roi/hypotheses.js','routing/policy.js','routing/build.js','routing/history.js','routing/router.js']);
self.onmessage=e=>{const {id,race,packs,options}=e.data;try{self.postMessage({id,out:RaceRouter.build(race,packs,options)});}catch(error){self.postMessage({id,error:error.message});}};
