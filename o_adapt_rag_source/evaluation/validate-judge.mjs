// Calibration step for the model judge. It compares five fixed hand-labelled cases
// with judge decisions and reports accuracy, precision, recall and clarity agreement.
import fs from 'node:fs/promises';

const human = JSON.parse(await fs.readFile(new URL('./live/judge-human-validation.json', import.meta.url), 'utf8'));
const judged = JSON.parse(await fs.readFile(new URL('./live/model-judge.json', import.meta.url), 'utf8'));
const blindReview = JSON.parse(await fs.readFile(new URL('./live/human-review.json', import.meta.url), 'utf8'));
const judgeById = new Map(judged.results.map(result => [result.id, result.ratings]));
const blindIndexById = new Map(blindReview.map((item,index) => [item.id,index]));
const booleanMetrics = ['factual_correct', 'evidence_supported', 'verification_status_correct'];

for (const item of human) {
  if (!item.reviewer) throw new Error(`${item.id}: reviewer is blank.`);
  for (const side of ['A', 'B']) {
    for (const metric of booleanMetrics) if (typeof item.ratings[side][metric] !== 'boolean') throw new Error(`${item.id}.${side}.${metric} must be true or false.`);
    const clarity = item.ratings[side].clarity_1_to_5;
    if (!Number.isInteger(clarity) || clarity < 1 || clarity > 5) throw new Error(`${item.id}.${side}.clarity_1_to_5 must be an integer from 1 to 5.`);
  }
}

const metrics = {};
for (const metric of booleanMetrics) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const item of human) for (const side of ['A', 'B']) {
    const expected = item.ratings[side][metric];
    const actual = judgeById.get(item.id)?.[side]?.[metric];
    if (typeof actual !== 'boolean') throw new Error(`Missing model-judge rating for ${item.id}.${side}.${metric}.`);
    if (actual && expected) tp += 1;
    else if (actual && !expected) fp += 1;
    else if (!actual && expected) fn += 1;
    else tn += 1;
  }
  metrics[metric] = {
    accuracy: (tp + tn) / (tp + fp + fn + tn),
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
    specificity: tn + fp ? tn / (tn + fp) : null,
    positive_label_rate: (tp + fn) / (tp + fp + fn + tn),
    tp, fp, fn, tn,
  };
}

const clarityErrors = [];
for (const item of human) for (const side of ['A', 'B']) clarityErrors.push(Math.abs(item.ratings[side].clarity_1_to_5 - judgeById.get(item.id)[side].clarity_1_to_5));
const sourceClarity = { model:[], template:[] };
for (const item of human) {
  const index = blindIndexById.get(item.id);
  if (!Number.isInteger(index)) throw new Error(`Missing blind-review order for ${item.id}.`);
  const modelSide = index % 2 === 0 ? 'B' : 'A';
  const templateSide = modelSide === 'A' ? 'B' : 'A';
  sourceClarity.model.push(item.ratings[modelSide].clarity_1_to_5);
  sourceClarity.template.push(item.ratings[templateSide].clarity_1_to_5);
}
const summary = {
  recorded_at: new Date().toISOString(),
  validation_cases: human.length,
  labelled_outputs: human.length * 2,
  judge_model: judged.judge_model,
  boolean_metrics: metrics,
  clarity_mean_absolute_error: clarityErrors.reduce((sum, value) => sum + value, 0) / clarityErrors.length,
  clarity_exact_agreement: clarityErrors.filter(value => value === 0).length / clarityErrors.length,
  human_mean_clarity: {
    model: sourceClarity.model.reduce((sum,value)=>sum+value,0)/sourceClarity.model.length,
    template: sourceClarity.template.reduce((sum,value)=>sum+value,0)/sourceClarity.template.length,
  },
  negative_boolean_labels: Object.values(metrics).reduce((sum,value)=>sum+value.tn+value.fp,0),
  reviewers: [...new Set(human.map(item => item.reviewer))],
};
await fs.writeFile(new URL('./live/judge-validation-results.json', import.meta.url), JSON.stringify(summary, null, 2) + '\n');
await fs.writeFile(new URL('./live/JUDGE_VALIDATION_RESULTS.md', import.meta.url), `# Model-judge validation against hand labels\n\n- Validation cases: ${summary.validation_cases} (${summary.labelled_outputs} A/B outputs).\n- Judge model: ${summary.judge_model}.\n${Object.entries(metrics).map(([name,value]) => `- ${name}: accuracy ${value.accuracy.toFixed(3)}, precision ${value.precision?.toFixed(3) ?? 'n/a'}, recall ${value.recall?.toFixed(3) ?? 'n/a'}, specificity ${value.specificity?.toFixed(3) ?? 'n/a'} (TP ${value.tp}, FP ${value.fp}, FN ${value.fn}, TN ${value.tn}; positive-label rate ${value.positive_label_rate.toFixed(3)}).`).join('\n')}\n- Clarity mean absolute error: ${summary.clarity_mean_absolute_error.toFixed(3)}.\n- Clarity exact agreement: ${summary.clarity_exact_agreement.toFixed(3)}.\n- Human mean clarity: model ${summary.human_mean_clarity.model.toFixed(2)}/5; template ${summary.human_mean_clarity.template.toFixed(2)}/5.\n\nAll Boolean hand labels were positive, so 100% accuracy/precision/recall only establishes agreement on passing outputs; specificity is unavailable and the sample does not test whether the judge rejects bad explanations. The clarity labels favour the fixed template by ${(summary.human_mean_clarity.template-summary.human_mean_clarity.model).toFixed(1)} point. This validation measures agreement with the supplied hand labels and does not make the judge a source of truth beyond this sample.\n`);
console.log(JSON.stringify(summary, null, 2));
