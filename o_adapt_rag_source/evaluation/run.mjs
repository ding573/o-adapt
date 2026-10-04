// Reproducible existing-control evaluation: applies fixed mutations, checks an
// independent spacing oracle, and writes machine-readable and Markdown results.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createEngine, templateExplanation } from '../public/lib/course-engine.js';
import { loadData } from '../src/data.mjs';
const fixturesText = await fs.readFile(new URL('./cases.json', import.meta.url), 'utf8');
const fixtures = JSON.parse(fixturesText);
const original = await loadData();

// Independent all-pairs straight-line check (haversine), not the production approximation.
function metres(a, b) {
  const r = Math.PI / 180;
  const x = Math.sin((b.latitude-a.latitude)*r/2)**2 + Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin((b.longitude-a.longitude)*r/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
export function mutate(data, item) {
  const request = { ...item.request };
  switch (item.mutation) {
    case 'unverified_paths': data.network.features.forEach(f => f.properties.field_verified = false); break;
    case 'excluded_paths': data.network.features.forEach(f => f.properties.status = 'EXCLUDED'); break;
    case 'blocked_controls': data.controls.forEach(c => c.blocking_issues = ['blocked']); break;
    case 'missing_start': data.controls = data.controls.filter(c => c.id !== 'CP01'); break;
    case 'missing_policy': data.knowledge = data.knowledge.filter(d => d.id !== 'KB-07'); break;
    case 'missing_verification': data.verification = null; break;
    case 'hazard_failed': data.verification.hazard_review_pass = false; break;
    case 'invalid_distance': request.targetDistanceM = 599; break;
    case 'invalid_count': request.controlCount = 20; break;
    case 'invalid_difficulty': request.difficulty = 'unknown'; break;
  }
  return request;
}
const rows = [];
for (const item of fixtures.cases) {
  const data = structuredClone(original);
  const request = mutate(data, item);
  const started = performance.now();
  let result, explanation = null;
  try {
    const output = createEngine(data).generate(request);
    result = output.result;
    explanation = templateExplanation(result);
    const points = result.generated_control_order.map(id => data.controls.find(c => c.id === id));
    const threshold = { beginner:35, intermediate:45, advanced:55 }[request.difficulty];
    const min = Math.min(...points.flatMap((a,i)=>points.slice(i+1).map(b=>metres(a,b))));
    result.independent_constraints_pass = points.every(c => c.status === 'eligible' && !c.blocking_issues?.length && !c.provisional_demo) && min >= threshold - 0.02 && Math.abs(result.routed_distance_m-request.targetDistanceM) <= request.targetDistanceM*0.1 && new Set(result.generated_control_order).size === request.controlCount+2;
  } catch (error) {
    result = { status:'abstained', abstained:true, safe_for_real_use:false, reason:error.message };
  }
  const contractPass = item.expected === 'verified_or_explicit_abstention'
    ? (result.status === 'abstained'
      ? result.safe_for_real_use === false
      : result.status === 'verified_course' && result.safe_for_real_use === true && result.independent_constraints_pass === true)
    : result.safe_for_real_use === item.expected_safe_for_real_use && result.status === item.expected;
  rows.push({ id:item.id, group:item.group, request, expected:item.expected, contract_pass:contractPass, latency_ms:performance.now()-started, ...result, baseline_explanation:explanation, model_evaluation:'not_run', tokens:null, cost_usd:null });
}
const normal = rows.filter(r=>r.group==='normal');
const summary = { recorded_at:new Date().toISOString(), fixture_sha256:createHash('sha256').update(fixturesText).digest('hex'), cases:rows.length, contract_passes:rows.filter(r=>r.contract_pass).length, normal_cases:normal.length, verified_courses:normal.filter(r=>r.status==='verified_course').length, generation_abstentions:normal.filter(r=>r.status==='abstained').length, original_16_of_20_verified_target_met:normal.filter(r=>r.safe_for_real_use).length>=16, paid_model_calls:0, limitations:['Predefined cases were fixed before the run; an externally collected holdout was not used.', 'This offline suite establishes candidate feasibility, not LLM route-selection quality; see the separate live report.', 'My field claims have not been independently audited.', 'Constraint oracle checks eligibility, spacing and reported distance tolerance, not current physical conditions or an independent path-distance computation.', 'Verified status applies only to the recorded dataset; temporary site changes still require a current-condition check.'] };
const binary = value => value === true ? '1' : '0';
const checklistRows = normal.map(row => {
  const request = `${row.request.targetDistanceM} m / ${row.request.difficulty} / ${row.request.controlCount} / ${row.request.focus}`;
  const completePass = row.status === 'verified_course'
    && row.field_verified_path_pass === true
    && row.control_points_verified_pass === true
    && row.spacing_pass === true
    && row.distance_within_tolerance === true
    && row.hazard_review_pass === true;
  return `| ${row.id} | ${request} | ${binary(row.status === 'verified_course')} | ${binary(row.field_verified_path_pass)} | ${binary(row.control_points_verified_pass)} | ${binary(row.spacing_pass)} | ${binary(row.distance_within_tolerance)} | ${binary(row.hazard_review_pass)} | ${binary(completePass)} | ${binary(row.contract_pass)} |`;
});
await fs.writeFile(new URL('./results.json', import.meta.url), JSON.stringify({ summary, rows },null,2)+'\n');
await fs.writeFile(new URL('./RESULTS.md', import.meta.url), `# Recorded offline evaluation\n\nRun: ${summary.recorded_at}\n\nFixture SHA-256: ${summary.fixture_sha256}\n\n- Contract checks: ${summary.contract_passes}/${summary.cases}.\n- Verified courses from the recorded dataset: ${summary.verified_courses}/${summary.normal_cases}.\n- No-feasible-route abstentions: ${summary.generation_abstentions}/${summary.normal_cases}.\n- Original target (16/20 verified complete passes): ${summary.original_16_of_20_verified_target_met ? 'met' : 'NOT met'}.\n- This offline run made 0 LLM calls. The final-architecture live run is recorded in \`live/ROUTE_LIVE_RESULTS.md\`; the separate five-case human review is recorded in \`live/ROUTE_HUMAN_REVIEW_RESULTS.md\`.\n\n## Twenty-case binary acceptance checklist\n\nEach value is 1 for pass and 0 for fail or unavailable. **Complete pass** requires a generated verified course plus every listed route check. **Contract pass** also counts a safe explicit abstention as correct system behaviour. Path, control and hazard values refer to my 23 September 2026 field record; they are not an independent current-condition audit.\n\n| Case | Request: distance / difficulty / controls / focus | Route produced | Path verified / reachable | Controls verified | Spacing legal | Distance within +/-10% | Hazard review | Complete pass | Contract pass |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|\n${checklistRows.join('\n')}\n\nVerified status applies only to the dataset I verified and does not establish current physical conditions.\n\n## Limitations\n\n${summary.limitations.map(x=>'- '+x).join('\n')}\n`);
console.log(JSON.stringify(summary,null,2));
if (rows.some(r=>!r.contract_pass)) process.exitCode=1;
