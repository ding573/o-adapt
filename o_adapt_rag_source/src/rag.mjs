// Server-side knowledge adapter: loads the curated corpus, reuses explicit retrieval,
// and compacts evidence before it is sent to the external explanation model.
import fs from "node:fs/promises";

const knowledgeUrl = new URL("../public/data/knowledge.json", import.meta.url);

export async function loadKnowledge() {
  return JSON.parse(await fs.readFile(knowledgeUrl, "utf8"));
}

export { retrieveDocuments } from '../public/lib/retrieval.js';

export function compactEvidence(documents) {
  return documents.map(document => ({
    id: document.id,
    title: document.title,
    source: document.source,
    text: document.text,
  }));
}
