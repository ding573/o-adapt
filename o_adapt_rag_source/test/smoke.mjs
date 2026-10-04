import assert from 'node:assert/strict';
import { loadData } from '../src/data.mjs';
import { retrieveDocuments } from '../src/rag.mjs';
import { createEngine, templateExplanation } from '../public/lib/course-engine.js';
import { explainCourse, selectCourse } from '../src/openrouter.mjs';
import { activityToGpx, distanceMetres, processLocationSample } from '../public/lib/activity-tracker.js';
const data = await loadData();
const request = { targetDistanceM:800, difficulty:'beginner', focus:'navigation', controlCount:3 };
for (const difficulty of ['beginner','intermediate','advanced']) {
  for (const focus of ['navigation','route-choice','physical']) {
    const ids = retrieveDocuments(data.knowledge, {difficulty,focus}).map(d=>d.id);
    for (const id of ['KB-02','KB-05','KB-06','KB-07','KB-08']) assert.ok(ids.includes(id));
    if (difficulty==='beginner') assert.ok(ids.includes('KB-03'));
    if (focus==='route-choice') assert.ok(ids.includes('KB-04'));
  }
}
const first = createEngine(data).generate(request);
const candidateSet = createEngine(data).generateCandidates(request, 12);
assert.equal(candidateSet.candidates.length, 12);
assert.ok(candidateSet.candidates.every(candidate => candidate.result.distance_within_tolerance && candidate.result.spacing_pass));
assert.equal(data.controls.length, 14);
assert.equal(first.result.status,'verified_course');
assert.equal(first.result.safe_for_real_use,true);
assert.equal(first.result.abstained,false);
assert.ok(templateExplanation(first.result).includes('within the project-verified path scope'));
const explored = createEngine(data).generate({ ...request, controlMode: 'explore' });
assert.equal(explored.result.control_mode, 'explore');
assert.equal(explored.result.generated_control_points.length, request.controlCount);
assert.equal(explored.result.safe_for_real_use, true);
assert.equal(explored.result.abstained, false);
assert.equal(explored.result.field_review_required, false);
assert.equal(explored.result.control_points_verified_pass, true);
assert.ok(explored.result.generated_control_order.slice(1, -1).every(id => id.startsWith('GP')));
assert.ok(explored.course.sequence.slice(1, -1).every(control => control.generated && control.status === 'eligible'));
assert.ok(templateExplanation(explored.result).includes('system-generated virtual GPS controls'));
assert.equal(createEngine(data).generate({ ...request, controlMode: 'explore' }).result.safe_for_real_use,true);
for (const field of ['path_walked_and_connected','control_features_confirmed','hazard_review_pass']) {
  const changed=structuredClone(data); changed.verification[field]=false;
  assert.equal(createEngine(changed).generate(request).result.safe_for_real_use,false);
}
const unverified=structuredClone(data); unverified.network.features.forEach(f=>f.properties.field_verified=false);
assert.throws(()=>createEngine(unverified).generate(request));
const blocked=structuredClone(data); blocked.controls.find(c=>c.id==='CP01').status='EXCLUDED';
assert.throws(()=>createEngine(blocked).generate(request));
assert.throws(()=>createEngine(data).generate({...request,controlCount:100}));
assert.throws(()=>createEngine(data).generate({...request,controlMode:'random'}));
assert.deepEqual(createEngine(data).generate(request).result, first.result);
const checkpoints=[{id:'CP01',latitude:1.34,longitude:103.72},{id:'CP02',latitude:1.3405,longitude:103.7205}];
const activity={positions:[],arrivals:[],next_control_index:0,confirmation:null,distance_m:0};
const sample=(latitude,longitude,accuracy_m,timestamp_ms)=>({latitude,longitude,accuracy_m,timestamp_ms,altitude_m:null});
assert.equal(processLocationSample(activity,checkpoints,sample(1.34,103.72,8,1000)).arrived,null);
assert.equal(processLocationSample(activity,checkpoints,sample(1.340001,103.720001,8,2000)).arrived.control_id,'CP01');
assert.equal(activity.next_control_index,1);
assert.equal(processLocationSample(activity,checkpoints,sample(1.3405,103.7205,40,12000)).reason,'insufficient_accuracy');
assert.ok(distanceMetres(checkpoints[0],checkpoints[1])>0);
const gpx=activityToGpx(activity); assert.ok(gpx.includes('<gpx')); assert.ok(gpx.includes('CP01'));
// Exercise the real adapter with a local transport stub; never consume API credit.
const savedFetch=globalThis.fetch;
try {
  let calls=0;
  globalThis.fetch=async(url,options)=>{
    calls++;
    const body=JSON.parse(options.body);
    assert.equal(body.messages.length,2);
    assert.ok(options.signal);
    const prompt=JSON.parse(body.messages[1].content);
    if (prompt.validated_route_candidates) {
      assert.equal(prompt.validated_route_candidates.length,2);
      return {ok:true,json:async()=>({model:'test-model',choices:[{message:{content:JSON.stringify({candidate_id:'C02',selection_reason:'Meets the distance requirement',used_rule_ids:['KB-06']})}}],usage:{total_tokens:8,cost:0}})};
    }
    assert.equal(prompt.deterministic_course_result.safe_for_real_use,true);
    return {ok:true,json:async()=>({model:'test-model',choices:[{message:{content:JSON.stringify({explanation:'Rule KB-06',risk_note:'Preview only'})}}],usage:{total_tokens:10,cost:0}})};
  };
  const selection=await selectCourse({apiKey:'test-only',model:'test-model',request,candidates:[{candidate_id:'C01'},{candidate_id:'C02'}],evidence:first.documents});
  assert.equal(selection.candidate_id,'C02');
  const result=await explainCourse({apiKey:'test-only',model:'test-model',request,course:first.result,evidence:first.documents});
  assert.equal(calls,2); assert.equal(result.usage.total_tokens,10); assert.ok(result.latency_ms>=0);
  globalThis.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:'{"wrong":true}'}}]})});
  await assert.rejects(()=>selectCourse({apiKey:'test-only',request,candidates:[{candidate_id:'C01'}],evidence:[]}));
  await assert.rejects(()=>explainCourse({apiKey:'test-only',request,course:first.result,evidence:[]}));
  await assert.rejects(()=>selectCourse({apiKey:'',request,candidates:[{candidate_id:'C01'}],evidence:[]}));
  await assert.rejects(()=>explainCourse({apiKey:'',request,course:first.result,evidence:[]}));
} finally { globalThis.fetch=savedFetch; }
console.log('Passed: retrieval combinations, verification gates, exclusion, determinism, invalid input, adapter success and failure. No live API calls.');
