// Validates the fixed five-case human route review and writes reproducible summary metrics.
import fs from 'node:fs/promises';

const review = JSON.parse(await fs.readFile(new URL('./live/route-human-review.json', import.meta.url), 'utf8'));
if (!Array.isArray(review) || review.length !== 5) throw new Error('Expected exactly five route-review cases.');

const userFit = [];
const trainingFit = [];
let supported = 0;
const reviewers = new Set();
for (const item of review) {
  const ratings = item.ratings ?? {};
  for (const [name, value] of [['user_request_fit_1_to_5', ratings.user_request_fit_1_to_5], ['training_focus_fit_1_to_5', ratings.training_focus_fit_1_to_5]]) {
    if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error(`${item.id}: ${name} must be an integer from 1 to 5.`);
  }
  if (typeof ratings.selection_reason_supported !== 'boolean') throw new Error(`${item.id}: selection_reason_supported must be Boolean.`);
  if (typeof item.reviewer !== 'string' || !item.reviewer.trim()) throw new Error(`${item.id}: reviewer is required.`);
  userFit.push(ratings.user_request_fit_1_to_5);
  trainingFit.push(ratings.training_focus_fit_1_to_5);
  if (ratings.selection_reason_supported) supported += 1;
  reviewers.add(item.reviewer.trim());
}

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const atLeastFour = values => values.filter(value => value >= 4).length;
const summary = {
  recorded_at: new Date().toISOString(),
  cases: review.length,
  reviewers: [...reviewers],
  mean_user_request_fit: mean(userFit),
  mean_training_focus_fit: mean(trainingFit),
  user_request_fit_at_least_4: atLeastFour(userFit),
  training_focus_fit_at_least_4: atLeastFour(trainingFit),
  selection_reason_supported: supported,
  notable_failure_cases: review.filter(item => item.ratings.user_request_fit_1_to_5 < 4 || item.ratings.training_focus_fit_1_to_5 < 4 || !item.ratings.selection_reason_supported).map(item => item.id),
};

await fs.writeFile(new URL('./live/route-human-review-results.json', import.meta.url), JSON.stringify(summary, null, 2) + '\n');
await fs.writeFile(new URL('./live/ROUTE_HUMAN_REVIEW_RESULTS.md', import.meta.url), `# Human route-quality review results\n\n- Cases reviewed: ${summary.cases}.\n- Reviewer code: ${summary.reviewers.join(', ')}.\n- Mean user-request fit: ${summary.mean_user_request_fit.toFixed(2)}/5.\n- Mean training-focus fit: ${summary.mean_training_focus_fit.toFixed(2)}/5.\n- User-request fit at least 4/5: ${summary.user_request_fit_at_least_4}/${summary.cases}.\n- Training-focus fit at least 4/5: ${summary.training_focus_fit_at_least_4}/${summary.cases}.\n- Selection reason supported by the supplied route features and retrieved rules: ${summary.selection_reason_supported}/${summary.cases}.\n- Cases requiring critique: ${summary.notable_failure_cases.join(', ') || 'none'}.\n\nN03 was rated 3/5 for both request fit and training-focus fit, and its selection reason was not supported. The reviewer considered it closer to an intermediate technical route or advanced physical route than an advanced navigation route. N05 received 4/5 for training-focus fit, with a note that its 1,400 m distance may be physically demanding.\n\nThis five-case review supplies human evidence that the selected routes were generally suitable, while exposing a difficulty-classification weakness. It uses one reviewer and does not provide a blinded paired comparison against the deterministic top candidate, so it does not prove that model selection is superior.\n`);
console.log(JSON.stringify(summary, null, 2));
