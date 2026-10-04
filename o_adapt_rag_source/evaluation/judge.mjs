// Model-as-judge experiment: blindly scores A/B explanations against ground truth and
// evidence, records cost, and keeps the ratings separate from hand-label calibration.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function loadLocalEnv() {
  try {
    const text = await fs.readFile(path.join(root, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

await loadLocalEnv();
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.');
const model = process.env.OPENROUTER_JUDGE_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const review = JSON.parse(await fs.readFile(new URL('./live/human-review.json', import.meta.url), 'utf8'));
const knowledge = JSON.parse(await fs.readFile(new URL('../public/data/knowledge.json', import.meta.url), 'utf8')).documents;
const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
const results = [];
let spent = 0;

function validateRating(value, side) {
  const keys = Object.keys(value ?? {}).sort().join(',');
  if (keys !== 'clarity_1_to_5,evidence_supported,factual_correct,reason,verification_status_correct') throw new Error(`Invalid ${side} rating schema.`);
  for (const key of ['factual_correct', 'evidence_supported', 'verification_status_correct']) if (typeof value[key] !== 'boolean') throw new Error(`Invalid ${side}.${key}.`);
  if (!Number.isInteger(value.clarity_1_to_5) || value.clarity_1_to_5 < 1 || value.clarity_1_to_5 > 5) throw new Error(`Invalid ${side}.clarity_1_to_5.`);
  if (typeof value.reason !== 'string' || !value.reason.trim()) throw new Error(`Invalid ${side}.reason.`);
}

for (const item of review) {
  if (spent >= 1) break;
  const evidence = knowledge.filter(document => item.ground_truth.retrieved_rule_ids.includes(document.id)).map(({ id, text }) => ({ id, text }));
  const started = performance.now();
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'O-Adapt PE6201 Model Judge',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 650,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a strict blind evaluator. Judge outputs A and B independently from the supplied ground truth and evidence. Existing controls, paths and hazards in this dataset have recorded field confirmation and may be described as suitable for real use when temporary site changes are acknowledged. Do not infer multiple viable route choices unless the ground truth measures them. Return JSON only.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            rubric: {
              factual_correct: 'All stated route facts agree with ground truth and no unmeasured claim is added.',
              evidence_supported: 'Every substantive rule or safety claim is supported by supplied evidence or ground truth.',
              verification_status_correct: 'Field-confirmed existing controls may be described as usable, with temporary-condition caveat; unverified generated points may not.',
              clarity_1_to_5: '1 is confusing; 5 is concise, complete and non-repetitive.',
            },
            required_schema: {
              A: { factual_correct: 'boolean', evidence_supported: 'boolean', verification_status_correct: 'boolean', clarity_1_to_5: 'integer 1-5', reason: 'short Chinese string' },
              B: { factual_correct: 'boolean', evidence_supported: 'boolean', verification_status_correct: 'boolean', clarity_1_to_5: 'integer 1-5', reason: 'short Chinese string' },
            },
            case: { id: item.id, request: item.request, ground_truth: item.ground_truth, evidence, outputs: item.outputs },
          }),
        },
      ],
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Stopped on ${item.id}: ${payload?.error?.message ?? response.status}`);
  if (typeof payload.usage?.cost !== 'number') throw new Error(`Stopped on ${item.id}: provider cost is unknown.`);
  const parsed = JSON.parse((payload.choices?.[0]?.message?.content ?? '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
  if (Object.keys(parsed).sort().join(',') !== 'A,B') throw new Error(`Invalid rating envelope for ${item.id}.`);
  validateRating(parsed.A, 'A');
  validateRating(parsed.B, 'B');
  spent += payload.usage.cost;
  results.push({ id: item.id, ratings: parsed, model: payload.model ?? model, usage: payload.usage, latency_ms: performance.now() - started });
  await fs.writeFile(new URL('./live/model-judge.json', import.meta.url), JSON.stringify({ recorded_at: new Date().toISOString(), judge_model: model, reported_cost_usd: spent, results }, null, 2) + '\n');
}

const tokens = results.map(result => result.usage?.total_tokens).filter(Number.isFinite);
const latencies = results.map(result => result.latency_ms);
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const sourceScores = { model:{ count:0, factual:0, evidence:0, verification:0, clarity:0 }, template:{ count:0, factual:0, evidence:0, verification:0, clarity:0 } };
results.forEach((result, index) => {
  const modelSide = index % 2 === 0 ? 'B' : 'A';
  const templateSide = modelSide === 'A' ? 'B' : 'A';
  for (const [source, side] of [['model', modelSide], ['template', templateSide]]) {
    const rating = result.ratings[side];
    sourceScores[source].count += 1;
    sourceScores[source].factual += Number(rating.factual_correct);
    sourceScores[source].evidence += Number(rating.evidence_supported);
    sourceScores[source].verification += Number(rating.verification_status_correct);
    sourceScores[source].clarity += rating.clarity_1_to_5;
  }
});
await fs.writeFile(new URL('./live/MODEL_JUDGE_RESULTS.md', import.meta.url), `# Model-judge operational results\n\n- Judge model: ${model}.\n- Cases judged: ${results.length}/${review.length} (${results.length * 2} anonymous outputs).\n- Total tokens: ${tokens.reduce((sum, value)=>sum+value,0)}.\n- Provider-reported cost: US$${spent}.\n- Average latency per case: ${Math.round(mean(latencies))} ms.\n\n## Uncalibrated ratings\n\n| Output source | Factual pass | Evidence pass | Verification pass | Mean clarity |\n|---|---:|---:|---:|---:|\n| Model explanation | ${sourceScores.model.factual}/${sourceScores.model.count} | ${sourceScores.model.evidence}/${sourceScores.model.count} | ${sourceScores.model.verification}/${sourceScores.model.count} | ${(sourceScores.model.clarity/sourceScores.model.count).toFixed(2)}/5 |\n| Fixed template | ${sourceScores.template.factual}/${sourceScores.template.count} | ${sourceScores.template.evidence}/${sourceScores.template.count} | ${sourceScores.template.verification}/${sourceScores.template.count} | ${(sourceScores.template.clarity/sourceScores.template.count).toFixed(2)}/5 |\n\nThese scores are not ground truth and must not be reported as validated performance yet. Run \`npm run evaluate:judge:validate\` after a person labels the five fixed validation cases.\n`);
console.log(`Model judge recorded ${results.length} cases; reported cost ${spent}. Human calibration remains required.`);
