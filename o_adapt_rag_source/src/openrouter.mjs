// Bounded OpenRouter adapters. The production path asks the model to select one
// prevalidated route using the user request and retrieved evidence; legacy explanation
// evaluation remains available for the recorded A/B experiment.
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

function parseModelJson(content) {
  if (typeof content !== "string") throw new Error("Model returned no text content.");
  const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).sort().join(",") !== "explanation,risk_note") throw new Error("Model output does not match the required schema.");
  if (typeof parsed.explanation !== "string" || typeof parsed.risk_note !== "string") {
    throw new Error("Model output does not match the required schema.");
  }
  return parsed;
}

function parseRouteSelection(content, allowedCandidateIds, allowedRuleIds) {
  if (typeof content !== "string") throw new Error("Model returned no text content.");
  const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).sort().join(",") !== "candidate_id,selection_reason,used_rule_ids") {
    throw new Error("Model route output does not match the required schema.");
  }
  if (typeof parsed.candidate_id !== "string" || typeof parsed.selection_reason !== "string" || !parsed.selection_reason.trim() || !Array.isArray(parsed.used_rule_ids) || !parsed.used_rule_ids.length || !parsed.used_rule_ids.every(id => typeof id === 'string' && allowedRuleIds.has(id))) {
    throw new Error("Model route output does not match the required schema.");
  }
  if (!allowedCandidateIds.has(parsed.candidate_id)) throw new Error("Model selected an unknown route candidate.");
  return parsed;
}

export async function selectCourse({ apiKey, model, request, candidates, evidence }) {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");
  if (!Array.isArray(candidates) || !candidates.length) throw new Error("No validated route candidates were supplied.");
  const allowedCandidateIds = new Set(candidates.map(candidate => candidate.candidate_id));
  const allowedRuleIds = new Set(evidence.map(document => document.id));
  const started = performance.now();
  const response = await fetch(ENDPOINT, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "O-Adapt PE6201 Project",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 220,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You select the final route for an orienteering training request. Every supplied candidate has already passed hard distance, graph and spacing checks. Use the user request and only the retrieved evidence to choose exactly one candidate. Prefer route features that fit the difficulty and training focus. Never invent a candidate, control or rule ID. Return JSON with exactly three fields: candidate_id (string), selection_reason (concise English string), and used_rule_ids (a non-empty array of retrieved rule ID strings).",
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Select the single best route candidate for this user request.",
            request,
            retrieved_evidence: evidence,
            validated_route_candidates: candidates,
          }),
        },
      ],
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message ?? `OpenRouter request failed with ${response.status}.`);
  const output = parseRouteSelection(payload?.choices?.[0]?.message?.content, allowedCandidateIds, allowedRuleIds);
  return {
    ...output,
    latency_ms: performance.now() - started,
    model: payload.model ?? model,
    usage: payload.usage ?? null,
  };
}

export async function explainCourse({ apiKey, model, request, course, evidence }) {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");
  const started = performance.now();
  const response = await fetch(ENDPOINT, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "O-Adapt PE6201 Project",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 320,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are the explanation layer in a safety-sensitive orienteering course generator. Use only the retrieved evidence. Never alter control IDs, route distance, spacing, or validation results. Explain the result in concise English. Return JSON with exactly two string fields: explanation and risk_note.",
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Explain the route constraints and verification scope. When safe_for_real_use is false, state which field verification is pending. Even when it is true, remind the user that temporary site conditions may change. Cite retrieved rule IDs in the explanation.",
            request,
            deterministic_course_result: course,
            retrieved_evidence: evidence,
          }),
        },
      ],
    }),
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message ?? `OpenRouter request failed with ${response.status}.`);
  const output = parseModelJson(payload?.choices?.[0]?.message?.content);
  return {
    ...output,
    latency_ms: performance.now() - started,
    model: payload.model ?? model,
    usage: payload.usage ?? null,
  };
}
