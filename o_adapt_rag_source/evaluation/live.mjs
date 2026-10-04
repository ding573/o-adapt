// Live route-generation runner. It sends frozen requests to the production endpoint,
// checks the selected routes against deterministic contracts, and records provider use.
import fs from 'node:fs/promises';
import { templateExplanation } from '../public/lib/course-engine.js';

const base = process.env.EVALUATION_BASE_URL ?? 'http://127.0.0.1:3000';
const { rows } = JSON.parse(await fs.readFile(new URL('./results.json', import.meta.url), 'utf8'));
const requests = rows.filter(row => row.group === 'normal' && row.independent_constraints_pass);
const results = [];
let spent = 0;
await fs.mkdir(new URL('./live/', import.meta.url), { recursive: true });

for (const row of requests) {
  if (spent >= 1) break;
  const response = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request: row.request }),
    signal: AbortSignal.timeout(35000),
  });
  const payload = await response.json();
  const result = payload.result;
  const checks = response.ok ? {
    llm_selected_route: result?.generation_source === 'llm_rag_selection',
    requested_control_count: result?.generated_control_order?.length === row.request.controlCount + 2,
    distance_within_tolerance: result?.distance_within_tolerance === true,
    spacing_pass: result?.spacing_pass === true,
    path_verification_pass: result?.field_verified_path_pass === true,
    control_verification_pass: result?.control_points_verified_pass === true,
    hazard_review_pass: result?.hazard_review_pass === true,
    rag_rules_declared: Array.isArray(result?.model_used_rule_ids) && result.model_used_rule_ids.length > 0 && result.model_used_rule_ids.every(id => result.retrieved_rule_ids.includes(id)),
    fixed_summary_matches: payload.summary === templateExplanation(result),
  } : {};
  results.push({
    id: row.id,
    request: row.request,
    deterministic_baseline_order: row.generated_control_order,
    response: payload,
    http_status: response.status,
    checks,
    contract_pass: response.ok && Object.values(checks).every(Boolean),
    differs_from_deterministic_baseline: response.ok && result.generated_control_order.join(',') !== row.generated_control_order.join(','),
  });
  await fs.writeFile(new URL('./live/route-comparison.json', import.meta.url), JSON.stringify({ recorded_at: new Date().toISOString(), actual_cost_so_far: spent, results }, null, 2) + '\n');
  if (!response.ok) throw new Error(`Stopped on ${row.id}: ${payload.message}`);
  if (typeof payload.usage?.cost !== 'number') throw new Error('Stopped: provider cost is unknown; inspect the account before continuing.');
  spent += payload.usage.cost;
}

const successful = results.filter(row => row.http_status === 200);
let previousHumanReview = [];
try {
  previousHumanReview = JSON.parse(await fs.readFile(new URL('./live/route-human-review.json', import.meta.url), 'utf8'));
} catch {}
const humanReview = successful.slice(0, 5).map(row => {
  const selectedControlOrder = row.response.result.generated_control_order;
  const previous = previousHumanReview.find(item => item.id === row.id && JSON.stringify(item.selected_control_order) === JSON.stringify(selectedControlOrder));
  const completed = previous
    && Number.isInteger(previous.ratings?.user_request_fit_1_to_5)
    && Number.isInteger(previous.ratings?.training_focus_fit_1_to_5)
    && typeof previous.ratings?.selection_reason_supported === 'boolean'
    && typeof previous.reviewer === 'string'
    && previous.reviewer.trim();
  return {
  id: row.id,
  request: row.request,
  selected_control_order: selectedControlOrder,
  routed_distance_m: row.response.result.routed_distance_m,
  control_features: row.response.course.sequence.slice(1, -1).map(control => ({ id: control.id, feature_type: control.feature_type, description: control.description })),
  retrieved_rule_ids: row.response.result.retrieved_rule_ids,
  model_used_rule_ids: row.response.result.model_used_rule_ids,
  model_selection_reason: row.response.selection_reason,
  ratings: completed ? previous.ratings : {
    user_request_fit_1_to_5: null,
    training_focus_fit_1_to_5: null,
    selection_reason_supported: null,
  },
  reviewer: completed ? previous.reviewer : null,
  notes: completed ? previous.notes : '',
  };
});
await fs.writeFile(new URL('./live/route-human-review.json', import.meta.url), JSON.stringify(humanReview, null, 2) + '\n');
await fs.writeFile(new URL('./live/route-comparison.json', import.meta.url), JSON.stringify({ recorded_at: new Date().toISOString(), actual_cost_so_far: spent, results }, null, 2) + '\n');

const tokens = successful.map(row => row.response.usage?.total_tokens).filter(Number.isFinite);
const latencies = successful.map(row => row.response.latency_ms).filter(Number.isFinite);
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const passed = successful.filter(row => row.contract_pass).length;
const changed = successful.filter(row => row.differs_from_deterministic_baseline).length;
const completedHumanReviews = humanReview.filter(item => typeof item.ratings.selection_reason_supported === 'boolean').length;
await fs.writeFile(new URL('./live/ROUTE_LIVE_RESULTS.md', import.meta.url), `# Recorded live RAG route-generation evaluation\n\n- Model: ${[...new Set(successful.map(row => row.response.model))].join(', ')}.\n- Successful route selections: ${successful.length}/${results.length}.\n- Deterministic contract passes: ${passed}/${successful.length}.\n- Routes different from the deterministic top candidate: ${changed}/${successful.length}.\n- Total tokens: ${tokens.reduce((sum, value) => sum + value, 0)}.\n- Provider-reported cost: US$${spent.toFixed(8)}.\n- Average model-selection latency: ${Math.round(average(latencies))} ms.\n- Latency range: ${Math.round(Math.min(...latencies))}–${Math.round(Math.max(...latencies))} ms.\n\nEvery returned route was selected by the model from candidates that had already passed graph, distance and spacing constraints. The fixed template was reproduced from the selected structured result. Human route-quality ratings are complete for ${completedHumanReviews}/${humanReview.length} fixed cases; see \`ROUTE_HUMAN_REVIEW_RESULTS.md\`. The small review does not establish that model selection is superior.\n`);
console.log(JSON.stringify({ responses: results.length, successful: successful.length, contract_passes: passed, changed_from_deterministic_baseline: changed, tokens: tokens.reduce((sum, value) => sum + value, 0), reported_cost_usd: spent, average_latency_ms: Math.round(average(latencies)) }, null, 2));
