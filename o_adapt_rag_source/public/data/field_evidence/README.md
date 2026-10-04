# Field photo evidence

This directory contains 14 photographs I supplied associated with the 23 September 2026 Jurong Central Park inspection, one for each eligible existing control: `CP01`-`CP06`, `CP08`-`CP12` and `CP14`-`CP16`. There are 12 JPEG files and two privacy-edited PNG files. The supplied copies contain no EXIF timestamp or GPS metadata, so the inspection date is reported by me. The photographs support identifiable control features and visible approaches and supplement my record that all 238 eligible path segments were walked and checked. They do not prove that conditions remain unchanged or constitute an independent safety audit.

The inventory, observations and SHA-256 checksums are recorded in `photo_manifest.csv`. In the public copies `CP11.png` and `CP12.png`, visible people and vehicle or plate details have been pixelated while the control surroundings remain visible.

## Adding photographs

1. Copy selected original photographs into this directory as JPEG or PNG files. Do not add screenshots presented as field photographs.
2. Use descriptive names such as `2026-09-23_CP01_start.jpg`, `2026-09-23_CP05_feature.jpg` or `2026-09-23_path_N12-N13.jpg`.
3. Add one row per photograph to `photo_manifest.csv`. Record only information supported by the original photograph or your contemporaneous notes. Do not invent GPS coordinates, capture times, path IDs or control IDs.
4. In `supports`, use one or more of: `path_presence`, `path_connectivity`, `control_feature`, `control_approach`, `hazard_review`.
5. Keep a private backup of the original files. Before committing public copies, remove photographs that reveal faces, vehicle plates or other unnecessary personal information. If you remove EXIF metadata for privacy, record that in `notes`.
6. After adding or replacing files, update their SHA-256 checksums and observations in the manifest, then update `photo_evidence_status` and `evidence_boundary` in `../field_verification_record.json`.

The photographs should cover representative paths, control features and approaches. Do not claim that a small set of photographs visually documents all 238 eligible path segments unless it actually does.
