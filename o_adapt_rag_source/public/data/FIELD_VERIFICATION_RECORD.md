# Jurong Central Park field-verification record

Verification ID: `FV-2026-09-23-JCP`  
Inspection date: 23 September 2026  
Record source: my field-verification report  
Verifier: I conducted the field check; the public dataset does not include my personal identity.

## Scope

The reported inspection covered publicly accessible areas inside the fixed Jurong Central Park MVP boundary:

- 238 path segments marked as eligible for routing;
- 14 existing eligible controls, including start `CP01` and finish `CP16`;
- connection from each existing control to the verified path network;
- visible hazards and access restrictions affecting those paths and controls.

The 50 excluded path segments were not added to the verified routing set. Runtime-generated `GPxx` points are virtual GPS controls placed exactly on nodes of the walked and verified path network; they do not require a physical flag or a separate identifiable feature.

## Checks recorded

I completed an on-foot visual comparison of the mapped records with the site. The check covered:

1. whether each eligible mapped path was present, connected and publicly accessible;
2. whether each existing control coordinate corresponded to an identifiable physical feature;
3. whether each existing control could be approached from the verified path network;
4. whether visible construction, closures, deep water or uncrossable obstacles blocked an eligible path or existing control.

The structured result records `path_walked_and_connected`, `control_features_confirmed` and `hazard_review_pass` as true for the existing-control dataset.

## Evidence and validity boundary

This is my verification record rather than an independent audit. The repository includes 14 photographs, one for each eligible existing control, with observations and SHA-256 checksums in `field_evidence/photo_manifest.csv`. CP11 and CP12 use privacy-edited PNG copies with visible people and vehicle or plate details pixelated. The supplied copies have no EXIF timestamp or GPS metadata, so the 23 September 2026 date comes from my field record. The photographs support the presence of identifiable control features and visible approaches. They supplement my record that all 238 eligible path segments were walked and checked; photographing every segment was not the verification method. No GPS track or third-party confirmation is included. Temporary site changes still require a current-condition check.

The machine-readable source is `field_verification_record.json`. Individual path eligibility remains encoded in `walkways.geojson`; existing control eligibility remains encoded in `controls.json`.
