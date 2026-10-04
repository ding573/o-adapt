# Different-model judge versus existing human review

The five earlier human-reviewed routes were presented to google/gemini-2.5-flash without the human scores. This is a post hoc calibration check on existing cases, not a new holdout or a replacement for human judgement.

| Case | Request fit: human / model | Focus fit: human / model | Reason supported: human / model |
|---|---:|---:|---:|
| N01 | 5 / 5 | 5 / 4 | 1 / 1 |
| N02 | 5 / 5 | 5 / 4 | 1 / 1 |
| N03 | 3 / 5 | 3 / 4 | 0 / 1 |
| N04 | 5 / 5 | 5 / 3 | 1 / 0 |
| N05 | 5 / 5 | 4 / 3 | 1 / 0 |

- Mean absolute difference: request fit 0.40 points; focus fit 1.20 points, on 1–5 scales.
- Reason-support agreement: 2/5.
- Provider-reported judge cost: US$0.00245790.

Five cases from one reviewer are too few to validate the judge. The model ratings are supporting evidence and cannot be treated as physical-safety labels or definitive route-quality scores.
