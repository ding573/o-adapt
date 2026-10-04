// Compares a different-model route judge with the five existing human ratings.
// Human scores are never sent to the judge and the original review is read-only.
import fs from 'node:fs/promises';
import { createEngine } from '../../public/lib/course-engine.js';
import { loadData } from '../../src/data.mjs';

const root = new URL('../../', import.meta.url);
const envText = await fs.readFile(new URL('.env', root), 'utf8');
const configuredKey = envText.split(/\r?\n/).find(line => line.startsWith('OPENROUTER_API_KEY='))?.slice('OPENROUTER_API_KEY='.length).trim();
const apiKey = process.env.OPENROUTER_API_KEY || configuredKey;
if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.');
const model = process.env.OPENROUTER_HOLDOUT_MODEL || 'google/gemini-2.5-flash';
if (model === (process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini')) throw new Error('Calibration judge must differ from the production model.');

const reviews = JSON.parse(await fs.readFile(new URL('../live/route-human-review.json', import.meta.url), 'utf8'));
if (reviews.length !== 5) throw new Error('Expected five completed human reviews.');
const engine = createEngine(await loadData());
let rows = [];
try {
  rows = JSON.parse(await fs.readFile(new URL('./calibration.json', import.meta.url), 'utf8')).rows;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (!Array.isArray(rows)) throw new Error('Invalid saved calibration rows.');

for (const review of reviews) {
  if (rows.some(row => row.id === review.id)) continue;
  if (rows.reduce((sum, row) => sum + (row.usage?.cost || 0), 0) >= 0.10) throw new Error('Calibration cost ceiling reached.');
  const evidence = engine.generateCandidates(review.request, 12).documents.map(({ id, text }) => ({ id, text }));
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'O-Adapt judge calibration' },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 900,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Assess one orienteering training route based only on the request, recorded route features and retrieved rules. Do not assume unmeasured terrain, current safety or actual route alternatives. Score request fit and training-focus fit independently on integers 1–5. Judge whether the stated route-selection reason is supported by the supplied evidence. Return JSON only. You do not have access to human ratings.' },
        { role: 'user', content: JSON.stringify({
          request: review.request,
          route: { control_order: review.selected_control_order, routed_distance_m: review.routed_distance_m, intermediate_controls: review.control_features },
          selection_reason: review.model_selection_reason,
          retrieved_evidence: evidence,
          output_schema: { request_fit: 'integer 1-5', training_focus_fit: 'integer 1-5', reason_supported: 'boolean', explanation: 'short English explanation' },
        }) },
      ],
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Calibration judge request failed: ${payload?.error?.message || response.status}`);
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Calibration judge returned no text.');
  const rating = JSON.parse(content.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
  for (const key of ['request_fit', 'training_focus_fit']) if (!Number.isInteger(rating[key]) || rating[key] < 1 || rating[key] > 5) throw new Error(`Invalid calibration score: ${key}`);
  if (typeof rating.reason_supported !== 'boolean' || typeof rating.explanation !== 'string') throw new Error('Invalid calibration reason judgement.');
  if (typeof payload.usage?.cost !== 'number') throw new Error('Calibration cost is unknown; stopped.');
  rows.push({ id: review.id, human: review.ratings, judge: rating, judge_model: payload.model || model, usage: payload.usage });
  await fs.writeFile(new URL('./calibration.json', import.meta.url), JSON.stringify({ rows }, null, 2) + '\n');
  console.log(`${review.id}: human ${review.ratings.user_request_fit_1_to_5}/${review.ratings.training_focus_fit_1_to_5}, judge ${rating.request_fit}/${rating.training_focus_fit}`);
}

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const requestErrors = rows.map(row => Math.abs(row.human.user_request_fit_1_to_5 - row.judge.request_fit));
const focusErrors = rows.map(row => Math.abs(row.human.training_focus_fit_1_to_5 - row.judge.training_focus_fit));
const reasonAgreement = rows.filter(row => row.human.selection_reason_supported === row.judge.reason_supported).length;
const totalCost = rows.reduce((sum, row) => sum + row.usage.cost, 0);
const table = rows.map(row => `| ${row.id} | ${row.human.user_request_fit_1_to_5} / ${row.judge.request_fit} | ${row.human.training_focus_fit_1_to_5} / ${row.judge.training_focus_fit} | ${Number(row.human.selection_reason_supported)} / ${Number(row.judge.reason_supported)} |`).join('\n');
await fs.writeFile(new URL('./CALIBRATION.md', import.meta.url), `# Different-model judge versus existing human review\n\nThe five earlier human-reviewed routes were presented to ${model} without the human scores. This is a post hoc calibration check on existing cases, not a new holdout or a replacement for human judgement.\n\n| Case | Request fit: human / model | Focus fit: human / model | Reason supported: human / model |\n|---|---:|---:|---:|\n${table}\n\n- Mean absolute difference: request fit ${mean(requestErrors).toFixed(2)} points; focus fit ${mean(focusErrors).toFixed(2)} points, on 1–5 scales.\n- Reason-support agreement: ${reasonAgreement}/5.\n- Provider-reported judge cost: US$${totalCost.toFixed(8)}.\n\nFive cases from one reviewer are too few to validate the judge. The model ratings are supporting evidence and cannot be treated as physical-safety labels or definitive route-quality scores.\n`);
console.log(JSON.stringify({ cases: rows.length, mean_absolute_request_difference: mean(requestErrors), mean_absolute_focus_difference: mean(focusErrors), reason_agreement: reasonAgreement, provider_reported_cost_usd: totalCost }, null, 2));
