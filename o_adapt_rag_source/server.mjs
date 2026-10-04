// Local HTTP boundary: serves the product, constructs constraint-valid candidates,
// asks the RAG-grounded model to select the final route, and records an audit trail.
import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compactEvidence, loadKnowledge, retrieveDocuments } from "./src/rag.mjs";
import { createEngine, templateExplanation, validateRequest } from "./public/lib/course-engine.js";
import { explainCourse, selectCourse } from "./src/openrouter.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");

async function loadLocalEnv() {
  try {
    const text = await fs.readFile(path.join(root, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

await loadLocalEnv();
const knowledge = await loadKnowledge();
const [controlData, network, verification] = await Promise.all(['controls.json', 'walkways.geojson', 'field_verification_record.json'].map(name => fs.readFile(path.join(publicDir, 'data', name), 'utf8').then(JSON.parse)));
const engine = createEngine({ controls: controlData.controls, network, verification, knowledge: knowledge.documents });
const port = Number(process.env.PORT || 3000);
const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readRequestBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 100_000) throw new Error("Request body is too large.");
  }
  return JSON.parse(body || "{}");
}

async function handleExplain(request, response) {
  try {
    const input = await readRequestBody(request);
    validateRequest(input.request);
    const generated = engine.generate(input.request);
    const documents = retrieveDocuments(knowledge.documents, input.request);
    const result = await explainCourse({
      apiKey: process.env.OPENROUTER_API_KEY,
      model,
      request: input.request,
      course: generated.result,
      evidence: compactEvidence(documents),
    });
    const audit = { recorded_at: new Date().toISOString(), request: input.request, course: generated.result, ...result };
    await fs.mkdir(path.join(root, 'evaluation', 'live'), { recursive: true });
    await fs.appendFile(path.join(root, 'evaluation', 'live', 'calls.jsonl'), JSON.stringify(audit) + '\n');
    json(response, 200, { status: "ok", retrieved_rule_ids: documents.map(document => document.id), ...result });
  } catch (error) {
    const configurationError = error.message.includes("OPENROUTER_API_KEY");
    json(response, configurationError ? 503 : 400, { status: "error", message: error.message });
  }
}

async function handleGenerate(request, response) {
  try {
    const input = await readRequestBody(request);
    validateRequest(input.request);
    const generated = engine.generateCandidates(input.request, 12);
    const modelCandidates = generated.candidates.map(candidate => ({
      candidate_id: candidate.id,
      control_order: candidate.result.generated_control_order,
      routed_distance_m: Math.round(candidate.result.routed_distance_m * 10) / 10,
      minimum_spacing_m: Math.round(candidate.result.minimum_spacing_m * 10) / 10,
      controls: candidate.course.sequence.slice(1, -1).map(control => ({
        id: control.id,
        feature_type: control.feature_type,
        description: control.description,
        verification_status: control.generated ? 'virtual_control_on_verified_path' : 'owner_verified',
      })),
    }));
    const selection = await selectCourse({
      apiKey: process.env.OPENROUTER_API_KEY,
      model,
      request: input.request,
      candidates: modelCandidates,
      evidence: compactEvidence(generated.documents),
    });
    const selected = generated.candidates.find(candidate => candidate.id === selection.candidate_id);
    if (!selected) throw new Error('Model selected an unknown route candidate.');
    const result = {
      ...selected.result,
      generation_source: 'llm_rag_selection',
      selected_candidate_id: selected.id,
      model_used_rule_ids: selection.used_rule_ids,
    };
    const summary = templateExplanation(result);
    const audit = {
      recorded_at: new Date().toISOString(),
      request: input.request,
      candidate_count: generated.candidates.length,
      selected_candidate_id: selected.id,
      selected_control_order: result.generated_control_order,
      result,
      summary,
      model_selection: selection,
    };
    await fs.mkdir(path.join(root, 'evaluation', 'live'), { recursive: true });
    await fs.appendFile(path.join(root, 'evaluation', 'live', 'route-calls.jsonl'), JSON.stringify(audit) + '\n');
    json(response, 200, {
      status: 'ok',
      course: selected.course,
      result,
      documents: generated.documents,
      summary,
      selection_reason: selection.selection_reason,
      candidate_count: generated.candidates.length,
      model: selection.model,
      usage: selection.usage,
      latency_ms: selection.latency_ms,
    });
  } catch (error) {
    const configurationError = error.message.includes('OPENROUTER_API_KEY');
    const modelError = /Model |OpenRouter|fetch|timeout/i.test(error.message);
    json(response, configurationError ? 503 : modelError ? 502 : 400, { status: 'error', message: error.message });
  }
}

async function serveStatic(request, response) {
  const parsed = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const requestedPath = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) return json(response, 403, { status: "error", message: "Forbidden" });
  try {
    const data = await fs.readFile(filePath);
    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(data);
  } catch (error) {
    if (error.code === "ENOENT") return json(response, 404, { status: "error", message: "Not found" });
    throw error;
  }
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/generate") return await handleGenerate(request, response);
    if (request.method === "POST" && request.url === "/api/explain") return await handleExplain(request, response);
    if (request.method === "GET") return await serveStatic(request, response);
    json(response, 405, { status: "error", message: "Method not allowed" });
  } catch (error) {
    json(response, 500, { status: "error", message: "Internal server error" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`O-Adapt is running at http://localhost:${port}`);
  console.log(process.env.OPENROUTER_API_KEY ? `RAG route-selection model: ${model}` : "RAG route generation disabled: add OPENROUTER_API_KEY to .env");
});
