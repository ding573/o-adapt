// Separate exploration evaluator: verifies generated GPxx points, graph membership,
// virtual-control status, deterministic output and explicit abstention.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createEngine } from '../public/lib/course-engine.js';
import { loadData } from '../src/data.mjs';

const fixturesText = await fs.readFile(new URL('./explore-cases.json', import.meta.url), 'utf8');
const fixtures = JSON.parse(fixturesText);
const original = await loadData();
const coordinateKey = ({ longitude, latitude }) => `${Number(longitude).toFixed(7)},${Number(latitude).toFixed(7)}`;

function metres(a, b) {
  const r = Math.PI / 180;
  const x = Math.sin((b.latitude-a.latitude)*r/2)**2 + Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin((b.longitude-a.longitude)*r/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

function mutate(data, item) {
  const request = { ...item.request };
  switch (item.mutation) {
    case 'unverified_paths': data.network.features.forEach(feature => { feature.properties.field_verified = false; }); break;
    case 'excluded_paths': data.network.features.forEach(feature => { feature.properties.status = 'EXCLUDED'; }); break;
    case 'missing_start': data.controls = data.controls.filter(control => control.id !== 'CP01'); break;
    case 'invalid_count': request.controlCount = 20; break;
  }
  return request;
}

const verifiedNodes = new Set(original.network.features
  .filter(feature => feature.properties?.status === 'MAP_CANDIDATE' && feature.properties?.field_verified === true)
  .flatMap(feature => feature.geometry.coordinates.map(([longitude, latitude]) => coordinateKey({ longitude, latitude }))));
const originalControlIds = new Set(original.controls.map(control => control.id));
const rows = [];

for (const item of fixtures.cases) {
  const data = structuredClone(original);
  const request = mutate(data, item);
  const started = performance.now();
  try {
    const first = createEngine(data).generate(request);
    const second = createEngine(structuredClone(data)).generate(request);
    const { result, course } = first;
    const generated = result.generated_control_points;
    const sequence = course.sequence;
    const threshold = { beginner:35, intermediate:45, advanced:55 }[request.difficulty];
    const independentlyMeasuredSpacing = Math.min(...sequence.flatMap((a,index) => sequence.slice(index+1).map(b => metres(a,b))));
    const checks = {
      explore_mode: result.control_mode === 'explore',
      generated_count: generated.length === request.controlCount,
      generated_ids: generated.every(point => /^GP\d{2}$/.test(point.id) && !originalControlIds.has(point.id)),
      generated_unique: new Set(generated.map(point => point.id)).size === generated.length && new Set(generated.map(coordinateKey)).size === generated.length,
      generated_on_verified_nodes: generated.every(point => verifiedNodes.has(coordinateKey(point))),
      generated_virtual_controls: generated.every(point => point.verification_status === 'virtual_control_on_verified_path'),
      sequence_shape: result.generated_control_order[0] === 'CP01' && result.generated_control_order.at(-1) === 'CP16' && result.generated_control_order.slice(1,-1).every(id => /^GP\d{2}$/.test(id)),
      distance_within_tolerance: result.distance_within_tolerance === true && Math.abs(result.routed_distance_m-request.targetDistanceM) <= request.targetDistanceM*0.1,
      independent_spacing: result.spacing_pass === true && independentlyMeasuredSpacing >= threshold - 0.02,
      verified_path_only: result.field_verified_path_pass === true,
      verified_virtual_route: result.status === 'verified_course' && result.safe_for_real_use === true && result.abstained === false && result.field_review_required === false && result.control_points_verified_pass === true && result.hazard_review_pass === true,
      deterministic: JSON.stringify(result.generated_control_order) === JSON.stringify(second.result.generated_control_order),
    };
    const contractPass = item.expected === 'generated_virtual_route' && Object.values(checks).every(Boolean);
    rows.push({ id:item.id, group:item.group, request, expected:item.expected, contract_pass:contractPass, latency_ms:performance.now()-started, checks, generated_control_order:result.generated_control_order, generated_control_points:generated, routed_distance_m:result.routed_distance_m, independently_measured_spacing_m:independentlyMeasuredSpacing, status:result.status, safe_for_real_use:result.safe_for_real_use, field_review_required:result.field_review_required });
  } catch (error) {
    const contractPass = item.expected === 'abstained';
    rows.push({ id:item.id, group:item.group, request, expected:item.expected, contract_pass:contractPass, latency_ms:performance.now()-started, status:'abstained', safe_for_real_use:false, reason:error.message });
  }
}

const normal = rows.filter(row => row.group === 'explore_normal');
const edge = rows.filter(row => row.group === 'explore_edge');
const summary = {
  recorded_at:new Date().toISOString(),
  fixture_sha256:createHash('sha256').update(fixturesText).digest('hex'),
  cases:rows.length,
  contract_passes:rows.filter(row => row.contract_pass).length,
  normal_cases:normal.length,
  generated_virtual_routes:normal.filter(row => row.contract_pass && row.status === 'verified_course').length,
  edge_cases:edge.length,
  edge_abstentions:edge.filter(row => row.status === 'abstained').length,
  verified_virtual_routes:rows.filter(row => row.group === 'explore_normal' && row.safe_for_real_use === true).length,
  paid_model_calls:0,
  limitations:['Predefined cases were fixed before the run; an externally collected holdout was not used.', 'GPxx points are virtual GPS controls rather than physical control features.', 'GPS accuracy and temporary path conditions can affect use.'],
};
await fs.writeFile(new URL('./explore-results.json', import.meta.url), JSON.stringify({summary,rows},null,2)+'\n');
await fs.writeFile(new URL('./EXPLORE_RESULTS.md', import.meta.url), `# Exploration-mode evaluation\n\nRun: ${summary.recorded_at}\n\nFixture SHA-256: ${summary.fixture_sha256}\n\n- Contract checks: ${summary.contract_passes}/${summary.cases}.\n- Normal virtual-control routes generated on verified path nodes: ${summary.generated_virtual_routes}/${summary.normal_cases}.\n- Edge-case abstentions: ${summary.edge_abstentions}/${summary.edge_cases}.\n- Paid model calls: 0.\n\nA successful exploration result uses virtual GPxx GPS controls located exactly on path-network nodes I verified. Physical flags and distinctive control features are not required.\n\n${summary.limitations.map(item=>'- '+item).join('\n')}\n`);
console.log(JSON.stringify(summary,null,2));
if (rows.some(row => !row.contract_pass)) process.exitCode = 1;
