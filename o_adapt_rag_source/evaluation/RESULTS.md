# Recorded offline evaluation

Run: 2026-10-03T09:25:54.168Z

Fixture SHA-256: 596c846ea0eb11b223660ca3b169fc6c610e19186d1280a76690c97753502f59

- Contract checks: 30/30.
- Verified courses from the recorded dataset: 17/20.
- No-feasible-route abstentions: 3/20.
- Original target (16/20 verified complete passes): met.
- This offline run made 0 LLM calls. The final-architecture live run is recorded in `live/ROUTE_LIVE_RESULTS.md`; the separate five-case human review is recorded in `live/ROUTE_HUMAN_REVIEW_RESULTS.md`.

## Twenty-case binary acceptance checklist

Each value is 1 for pass and 0 for fail or unavailable. **Complete pass** requires a generated verified course plus every listed route check. **Contract pass** also counts a safe explicit abstention as correct system behaviour. Path, control and hazard values refer to my 23 September 2026 field record; they are not an independent current-condition audit.

| Case | Request: distance / difficulty / controls / focus | Route produced | Path verified / reachable | Controls verified | Spacing legal | Distance within +/-10% | Hazard review | Complete pass | Contract pass |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| N01 | 600 m / beginner / 3 / navigation | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| N02 | 800 m / intermediate / 4 / navigation | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| N03 | 1000 m / advanced / 5 / navigation | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| N04 | 1200 m / beginner / 3 / route-choice | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| N05 | 1400 m / intermediate / 4 / route-choice | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| N06 | 600 m / advanced / 5 / route-choice | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| N07 | 800 m / beginner / 3 / physical | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| N08 | 1000 m / intermediate / 4 / physical | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| N09 | 1200 m / advanced / 5 / physical | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| N10 | 1400 m / beginner / 3 / navigation | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| N11 | 600 m / intermediate / 4 / navigation | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| N12 | 800 m / advanced / 5 / navigation | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| N13 | 1000 m / beginner / 3 / route-choice | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| N14 | 1200 m / intermediate / 4 / route-choice | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| N15 | 1400 m / advanced / 5 / route-choice | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| N16 | 600 m / beginner / 3 / physical | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| N17 | 800 m / intermediate / 4 / physical | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| N18 | 1000 m / advanced / 5 / physical | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| N19 | 1200 m / beginner / 3 / navigation | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| N20 | 1400 m / intermediate / 4 / navigation | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |

Verified status applies only to the dataset I verified and does not establish current physical conditions.

## Limitations

- Predefined cases were fixed before the run; an externally collected holdout was not used.
- This offline suite establishes candidate feasibility, not LLM route-selection quality; see the separate live report.
- My field claims have not been independently audited.
- Constraint oracle checks eligibility, spacing and reported distance tolerance, not current physical conditions or an independent path-distance computation.
- Verified status applies only to the recorded dataset; temporary site changes still require a current-condition check.
