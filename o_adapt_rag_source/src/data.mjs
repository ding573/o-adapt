// Node-side loader for the four checked-in runtime datasets used by tests and evaluators.
import fs from 'node:fs/promises';
export async function loadData() {
  const base = new URL('../public/data/', import.meta.url);
  const [controls, network, knowledge, verification] = await Promise.all(['controls.json', 'walkways.geojson', 'knowledge.json', 'field_verification_record.json'].map(name => fs.readFile(new URL(name, base), 'utf8').then(JSON.parse)));
  return { controls: controls.controls, network, knowledge: knowledge.documents, verification };
}
