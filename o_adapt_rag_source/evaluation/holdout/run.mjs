// Runs the frozen Gemini-generated requests through the existing route engine,
// production route-selection model and a blinded, different-model route judge.
// The holdout fixture is read-only; original evaluation and human ratings stay intact.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createEngine } from '../../public/lib/course-engine.js';
import { loadData } from '../../src/data.mjs';
import { compactEvidence } from '../../src/rag.mjs';
import { selectCourse } from '../../src/openrouter.mjs';

const root = new URL('../../', import.meta.url);
const fixtureText = await fs.readFile(new URL('./cases.json', import.meta.url), 'utf8');
const fixture = JSON.parse(fixtureText);
const metadata = JSON.parse(await fs.readFile(new URL('./generation-metadata.json', import.meta.url), 'utf8'));
const fixtureHash = createHash('sha256').update(fixtureText).digest('hex');
if (fixtureHash !== metadata.fixture_sha256) throw new Error('Frozen holdout hash does not match generation metadata.');
if (!Array.isArray(fixture.cases) || fixture.cases.length !== 20) throw new Error('Expected 20 frozen holdout cases.');

const envText = await fs.readFile(new URL('.env', root), 'utf8');
const configuredKey = envText.split(/\r?\n/).find(line => line.startsWith('OPENROUTER_API_KEY='))?.slice('OPENROUTER_API_KEY='.length).trim();
const apiKey = process.env.OPENROUTER_API_KEY || configuredKey;
if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.');
const productionModel = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const judgeModel = process.env.OPENROUTER_HOLDOUT_MODEL || metadata.requested_generator_model;
if (productionModel === judgeModel) throw new Error('Judge model must differ from the production model.');

const data = await loadData();
const engine = createEngine(data);
const byControlId = new Map(data.controls.map(control => [control.id, control]));
let rows = [];
try {
  const previous = JSON.parse(await fs.readFile(new URL('./results.json', import.meta.url), 'utf8'));
  if ((previous.fixture_sha256 || previous.summary?.fixture_sha256) !== fixtureHash) throw new Error('Saved results belong to a different holdout fixture.');
  rows = previous.rows;
  if (!Array.isArray(rows)) throw new Error('Saved holdout rows are invalid.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
let selectionCost = rows.reduce((sum, row) => sum + (row.selected?.usage?.cost || 0), 0);
let judgeCost = rows.reduce((sum, row) => sum + (row.judge?.usage?.cost || 0), 0);
const COST_CEILING_USD = 0.50;

function haversine(a, b) {
  const radians = Math.PI / 180;
  const deltaLat = (b.latitude - a.latitude) * radians;
  const deltaLon = (b.longitude - a.longitude) * radians;
  const t = Math.sin(deltaLat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(deltaLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(t), Math.sqrt(1 - t));
}

function contract(candidate, request) {
  const result = candidate.result;
  const points = result.generated_control_order.map(id => byControlId.get(id));
  const minimum = Math.min(...points.flatMap((a, index) => points.slice(index + 1).map(b => haversine(a, b))));
  const threshold = { beginner: 35, intermediate: 45, advanced: 55 }[request.difficulty];
  return {
    unique_eligible_controls: points.length === request.controlCount + 2 && points.every(point => point?.status === 'eligible' && !point.blocking_issues?.length && !point.provisional_demo) && new Set(result.generated_control_order).size === points.length,
    recorded_path_and_hazard_pass: result.field_verified_path_pass === true && result.control_points_verified_pass === true && result.hazard_review_pass === true,
    independent_spacing_pass: minimum >= threshold - 0.02,
    distance_within_tolerance: Math.abs(result.routed_distance_m - request.targetDistanceM) <= request.targetDistanceM * 0.1,
  };
}

function blindRoute(candidate) {
  return {
    control_order: candidate.result.generated_control_order,
    routed_distance_m: Math.round(candidate.result.routed_distance_m),
    minimum_spacing_m: Math.round(candidate.result.minimum_spacing_m),
    intermediate_controls: candidate.course.sequence.slice(1, -1).map(({ feature_type, description }) => ({ feature_type, description })),
  };
}

async function judgePair({ request, a, b, evidence }) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(60000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'O-Adapt external route judge',
    },
    body: JSON.stringify({
      model: judgeModel,
      temperature: 0,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an independent, blind route-quality judge. The two routes already pass the recorded graph, distance, spacing and hazard checks. Score training suitability only from the supplied request, route features and rules. Do not infer unmeasured terrain complexity, route alternatives or current outdoor safety. Judge A and B independently. Return JSON only.' },
        { role: 'user', content: JSON.stringify({
          request,
          evidence,
          rubric: {
            request_fit: 'Integer 1–5: requested distance, difficulty and control count match.',
            training_focus_fit: 'Integer 1–5: documented route features support the requested navigation, route-choice or physical focus. Do not infer unmeasured properties.',
            preference: 'A, B or tie; prefer only when evidence supports a meaningful difference.',
          },
          output_schema: { A: { request_fit: 'integer 1-5', training_focus_fit: 'integer 1-5' }, B: { request_fit: 'integer 1-5', training_focus_fit: 'integer 1-5' }, preference: 'A|B|tie', reason: 'short English explanation' },
          routes: { A: a, B: b },
        }) },
      ],
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Judge request failed: ${payload?.error?.message || response.status}`);
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Judge returned no text.');
  const rating = JSON.parse(content.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
  for (const side of ['A', 'B']) for (const key of ['request_fit', 'training_focus_fit']) {
    if (!Number.isInteger(rating?.[side]?.[key]) || rating[side][key] < 1 || rating[side][key] > 5) throw new Error(`Invalid judge rating ${side}.${key}.`);
  }
  if (!['A', 'B', 'tie'].includes(rating.preference) || typeof rating.reason !== 'string' || !rating.reason.trim()) throw new Error('Invalid judge preference or reason.');
  if (typeof payload.usage?.cost !== 'number') throw new Error('Judge cost is unknown; stopped before further paid calls.');
  judgeCost += payload.usage.cost;
  return { rating, model: payload.model || judgeModel, usage: payload.usage };
}

for (const [index, item] of fixture.cases.entries()) {
  if (selectionCost + judgeCost >= COST_CEILING_USD) throw new Error('Evaluation cost ceiling reached; partial results preserved.');
  let row = rows.find(previous => previous.id === item.id);
  if (row?.status === 'abstained' || row?.judge) continue;
  if (!row) {
    row = { id: item.id, request: item.request, status: null };
    rows.push(row);
  }
  let generated;
  try {
    generated = engine.generateCandidates(item.request, 12);
  } catch (error) {
    row.status = 'abstained';
    row.abstention_reason = error.message;
    await fs.writeFile(new URL('./results.json', import.meta.url), JSON.stringify({ fixture_sha256: fixtureHash, rows }, null, 2) + '\n');
    continue;
  }
  const baseline = generated.candidates[0];
  const candidates = generated.candidates.map(candidate => ({
    candidate_id: candidate.id,
    control_order: candidate.result.generated_control_order,
    routed_distance_m: Math.round(candidate.result.routed_distance_m * 10) / 10,
    minimum_spacing_m: Math.round(candidate.result.minimum_spacing_m * 10) / 10,
    controls: candidate.course.sequence.slice(1, -1).map(({ id, feature_type, description }) => ({ id, feature_type, description, verification_status: 'owner_verified' })),
  }));
  let selection = null;
  if (!row.selected) {
    selection = await selectCourse({ apiKey, model: productionModel, request: item.request, candidates, evidence: compactEvidence(generated.documents) });
    if (typeof selection.usage?.cost !== 'number') throw new Error('Production model cost is unknown; stopped before further paid calls.');
    selectionCost += selection.usage.cost;
  }
  const selected = generated.candidates.find(candidate => candidate.id === (row.selected?.candidate_id || selection.candidate_id));
  if (!selected) throw new Error('Production model selected an unknown candidate.');
  const baselineChecks = contract(baseline, item.request);
  const selectedChecks = contract(selected, item.request);
  const sameRoute = JSON.stringify(baseline.result.generated_control_order) === JSON.stringify(selected.result.generated_control_order);
  Object.assign(row, {
    status: 'route_generated',
    candidate_count: generated.candidates.length,
    baseline: { control_order: baseline.result.generated_control_order, routed_distance_m: baseline.result.routed_distance_m, checks: baselineChecks },
    selected: { candidate_id: selected.id, control_order: selected.result.generated_control_order, routed_distance_m: selected.result.routed_distance_m, checks: selectedChecks, model: selection?.model || row.selected?.model, selection_reason: selection?.selection_reason || row.selected?.selection_reason, used_rule_ids: selection?.used_rule_ids || row.selected?.used_rule_ids, usage: selection?.usage || row.selected?.usage },
    differs_from_baseline: !sameRoute,
  });
  await fs.writeFile(new URL('./results.json', import.meta.url), JSON.stringify({ fixture_sha256: fixtureHash, rows }, null, 2) + '\n');
  if (!sameRoute) {
    if (selectionCost + judgeCost >= COST_CEILING_USD) throw new Error('Evaluation cost ceiling reached before judge call; partial results preserved.');
    const modelOnA = index % 2 === 0;
    const { rating, model, usage } = await judgePair({
      request: item.request,
      a: blindRoute(modelOnA ? selected : baseline),
      b: blindRoute(modelOnA ? baseline : selected),
      evidence: generated.documents.map(({ id, text }) => ({ id, text })),
    });
    const selectedSide = modelOnA ? 'A' : 'B';
    const baselineSide = modelOnA ? 'B' : 'A';
    row.judge = { model, usage, blind_ratings: rating, selected_side: selectedSide, baseline_side: baselineSide, preference_for_selected: rating.preference === 'tie' ? 'tie' : rating.preference === selectedSide ? 'selected' : 'baseline' };
  } else {
    row.judge = { preference_for_selected: 'same_route', note: 'Identical route; no pairwise judge call.' };
  }
  await fs.writeFile(new URL('./results.json', import.meta.url), JSON.stringify({ fixture_sha256: fixtureHash, rows }, null, 2) + '\n');
  console.log(`${item.id}: ${row.status}, ${sameRoute ? 'same route' : row.judge.preference_for_selected}`);
}

rows = fixture.cases.map(item => rows.find(row => row.id === item.id));
const generatedRows = rows.filter(row => row.status === 'route_generated');
const judgedRows = generatedRows.filter(row => row.judge?.blind_ratings);
const allChecks = generatedRows.filter(row => Object.values(row.selected.checks).every(Boolean)).length;
const counts = Object.fromEntries(['selected', 'baseline', 'tie', 'same_route'].map(value => [value, generatedRows.filter(row => row.judge?.preference_for_selected === value).length]));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const selectedFocus = judgedRows.map(row => row.judge.blind_ratings[row.judge.selected_side].training_focus_fit);
const baselineFocus = judgedRows.map(row => row.judge.blind_ratings[row.judge.baseline_side].training_focus_fit);
const summary = {
  recorded_at: new Date().toISOString(),
  fixture_sha256: fixtureHash,
  generator_model: metadata.returned_generator_model || metadata.requested_generator_model,
  production_model: productionModel,
  judge_model: judgeModel,
  requests: rows.length,
  routes_generated: generatedRows.length,
  abstentions: rows.length - generatedRows.length,
  selected_contract_passes: allChecks,
  selected_different_from_baseline: generatedRows.filter(row => row.differs_from_baseline).length,
  blind_pairwise_judgements: judgedRows.length,
  preference_counts: counts,
  judged_mean_training_focus_fit_selected: mean(selectedFocus),
  judged_mean_training_focus_fit_baseline: mean(baselineFocus),
  generator_reported_cost_usd: metadata.provider_usage?.cost ?? null,
  production_reported_cost_usd: selectionCost,
  judge_reported_cost_usd: judgeCost,
  limitations: [
    'Requests were generated by a different model without seeing existing fixtures or route outcomes, but no external human supplied ground-truth feasibility labels.',
    'Objective checks use the recorded park data and an independent spacing calculation; they do not re-audit current physical access or independently recompute graph distance.',
    'The Gemini route-quality scores are model opinions, not human ground truth. Different choices or scores do not prove that one route is better.',
    'H16 and H17 judge explanations infer physical training value from feature names without measured terrain or pace data; treat their preferences cautiously.',
  ],
};
await fs.writeFile(new URL('./results.json', import.meta.url), JSON.stringify({ summary, rows }, null, 2) + '\n');
const table = rows.map(row => row.status === 'abstained'
  ? `| ${row.id} | ${row.request.targetDistanceM} / ${row.request.difficulty} / ${row.request.controlCount} / ${row.request.focus} | 0 | — | — | — | — | — |`
  : `| ${row.id} | ${row.request.targetDistanceM} / ${row.request.difficulty} / ${row.request.controlCount} / ${row.request.focus} | 1 | ${Number(Object.values(row.selected.checks).every(Boolean))} | ${Number(row.differs_from_baseline)} | ${row.judge.preference_for_selected} | ${row.judge.blind_ratings ? `${row.judge.blind_ratings[row.judge.selected_side].training_focus_fit} / ${row.judge.blind_ratings[row.judge.baseline_side].training_focus_fit}` : '—'} | ${Math.round(row.selected.routed_distance_m)} |`).join('\n');
await fs.writeFile(new URL('./RESULTS.md', import.meta.url), `# External-model holdout and blind route judgement\n\nThe ${fixture.cases.length} requests were generated by ${summary.generator_model} without access to the existing fixtures or route outputs, then frozen at SHA-256 \`${fixtureHash}\` before evaluation. O-Adapt used ${productionModel} for route selection; ${judgeModel} compared different model-selected and deterministic-baseline routes with A/B order hidden. Original evaluation and five human ratings were not changed.\n\n- Routes generated: ${summary.routes_generated}/${summary.requests}; abstentions: ${summary.abstentions}/${summary.requests}.\n- Selected routes passing all recorded objective checks: ${summary.selected_contract_passes}/${summary.routes_generated}.\n- Selected routes differing from the deterministic baseline: ${summary.selected_different_from_baseline}/${summary.routes_generated}.\n- Blind pairwise model judgements: ${summary.blind_pairwise_judgements}; selected preferred ${counts.selected}, baseline preferred ${counts.baseline}, tied ${counts.tie}; ${counts.same_route} pairs were identical and not judged.\n- Mean model-judged training-focus fit on differing pairs: selected ${summary.judged_mean_training_focus_fit_selected?.toFixed(2) ?? 'n/a'}/5; baseline ${summary.judged_mean_training_focus_fit_baseline?.toFixed(2) ?? 'n/a'}/5.\n- Provider-reported costs: generator US$${summary.generator_reported_cost_usd ?? 'unknown'}, production selector US$${selectionCost.toFixed(8)}, judge US$${judgeCost.toFixed(8)}.\n\n| Case | Request: metres / difficulty / controls / focus | Route | Checks pass | Different | Blind judge preference | Focus fit selected / baseline | Routed metres |\n|---|---|---:|---:|---:|---|---:|---:|\n${table}\n\n## Limits\n\n${summary.limitations.map(line => `- ${line}`).join('\n')}\n`);
console.log(JSON.stringify(summary, null, 2));
