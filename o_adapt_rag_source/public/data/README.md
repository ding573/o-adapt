# Data explainer

This directory is the complete runtime dataset for the fixed Jurong Central Park MVP. No participant personal data is used.

| File | Contents | Runtime role |
|---|---|---|
| `walkways.geojson` | 288 OSM-derived path segments: 238 candidate/field-marked and 50 excluded | Builds the routable graph; only `MAP_CANDIDATE` edges with `field_verified=true` are used |
| `controls.json` | 14 eligible control records with coordinates, descriptions and feature types | Supplies the existing-control pool, start CP01 and finish CP16 |
| `field_verification_record.json` | Structured field report I supplied for the 23 September 2026 park inspection | Controls verified-course status for existing controls |
| `FIELD_VERIFICATION_RECORD.md` | Human-readable scope, method and evidence boundary | Explains what the verification claim does and does not establish |
| `knowledge.json` | Eight curated rule records with IDs, text, source links, tags and parameters | Supplies retrieval evidence and deterministic policy values |

## Provenance

Path geometry is derived from OpenStreetMap and retains OSM attribution. The repository does not contain the original extraction query. Control coordinates were converted from field-recorded whole-second DMS. I walked and checked all 238 eligible path segments on 23 September 2026. Fourteen photographs I supplied document the eligible control features and visible approaches and supplement that path record; no GPS track is included. Knowledge entries include both external summaries and clearly labelled project-authored rules.

## Important fields

- Path edges must have `status="MAP_CANDIDATE"` and `field_verified=true` to enter the graph.
- Existing controls must have `status="eligible"`, `provisional_demo=false` and no `blocking_issues`.
- Generated `GPxx` points do not modify `controls.json`; they are virtual GPS controls created at runtime on graph nodes I verified.
- Knowledge parameters define the ±10% distance tolerance, 20 m maximum snap and difficulty-specific spacing thresholds.

## Portability and licence

The four files are checked into the repository so offline routing and evaluation run without an external database. Preserve OpenStreetMap attribution and the applicable ODbL notice when redistributing the path database. Source details and risks are expanded in `../../docs/DATA_AND_RISKS.md`.
