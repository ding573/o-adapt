# Data provenance and operational risks

## Inventory

| File | Inventory | Provenance and limitation |
|---|---|---|
| walkways.geojson | 288 segments; 238 candidate and field-marked, 50 excluded | OSM way IDs retained; original extraction query/script is not supplied. Field flags come from supplied project data, not this software review. |
| controls.json | 14 eligible records | DMS conversion precision and individual descriptions retained. |
| knowledge.json | 8 records | Curated summaries with links; some sources point to a broader resource rather than an exact page. Project-authored policies are not official competition rules. |
| field_verification_record.json, FIELD_VERIFICATION_RECORD.md and field_evidence/ | 1 dated field report I supplied and 14 control photographs | I walked and confirmed all 238 eligible segments and 14 eligible controls on 23 September 2026, including visible-hazard review. The photographs document all 14 control features and visible approaches and supplement the walking record; their copies have no EXIF timestamp or GPS. No independent audit is included. |

OSM-derived data is attributed to © OpenStreetMap contributors with the ODbL reference: https://www.openstreetmap.org/copyright . For redistribution, preserve source attribution and applicable database licence notices. No assertion of permission to relicense external source documents is made. Knowledge entries are local summaries, not bundled copies of those documents.

## Risk and mitigation pairs

| Risk / silent failure | Implemented mitigation | Remaining limitation |
|---|---|---|
| Candidate map edge treated as verified | Require both candidate status and field_verified=true | A stale or incorrect flag still needs real-world checking |
| Excluded or uncertain control selected | Filter status, blocking issues and provisional flags | Eligible records still rely on the accuracy of my field record |
| Route passes distance but violates spacing | Enforce hard distance bounds and all-pairs spacing during search | Thresholds are project policy, not validated participant suitability |
| Browser submits invented validation | Server regenerates the route from local data | Data files themselves are trusted configuration |
| Model unavailable but UI appears AI-powered | Explicit failure status and timeout; no silent deterministic substitution | No route is returned as model-selected without an actual response |
| LLM selects a weak or irrelevant training route | Model can choose only prevalidated candidates; show engine-controlled checks and report the five-case human review | N03 showed that hard constraints do not prove pedagogical quality |
| Prior successful result shown after failure | Clear result and reference-layer state; show abstention | Browser testing covers representative interactions, not every device |
| Path-to-control straight connector crosses obstacle | 20 m nearest-node limit and eligible controls I confirmed | Snap radius is not proof of traversability or current conditions |
| Junction bias mistaken for route-choice quality | Explicitly document heuristic scope | Multiple viable alternative paths are not measured |
| Virtual control is affected by GPS drift or a temporary obstruction | Generate `GPxx` points only on path nodes I verified, show exact coordinates, require two accurate nearby readings for arrival and remind users to check current conditions | Consumer GPS and the dated field record cannot guarantee present-day precision or access |
| GPS drift records a false control arrival | Require two consecutive readings within 20 m and reported accuracy of 25 m or better; enforce course order | Consumer GPS remains weaker than competition-grade punching and may fail under obstruction |
| Location history exposes personal movement | Keep the trace in browser storage only; provide delete and JSON/GPX export controls; make permission user initiated | Exported files become the user's responsibility and may reveal sensitive movement data |

Route generation needs no personal participant information. Optional activity tracking processes user-authorised location and timestamps locally in the browser and does not upload them to the server or model. A future shared or server-side activity service would require an appropriate privacy notice, consent, retention policy and access controls; none is claimed here.
