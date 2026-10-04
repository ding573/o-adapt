// Shared domain engine used by browser tests and the server. It enumerates routes that
// satisfy hard graph, distance, spacing and verification constraints. The server can
// then let an LLM select the final route without allowing it to bypass those gates.
import { retrieveDocuments } from './retrieval.js';
const rad = value => value * Math.PI / 180;
const coordinateKey = ([longitude, latitude]) => `${Number(longitude).toFixed(7)},${Number(latitude).toFixed(7)}`;
const pointFromCoordinate = ([longitude, latitude]) => ({ latitude, longitude });

function geoDistance(a, b) {
  const latitude = rad((a.latitude + b.latitude) / 2);
  const dy = (a.latitude - b.latitude) * 111195;
  const dx = (a.longitude - b.longitude) * 111195 * Math.cos(latitude);
  return Math.hypot(dx, dy);
}


export function validateRequest(request) {
  if (!request || !Number.isInteger(request.targetDistanceM) || request.targetDistanceM < 600 || request.targetDistanceM > 1400) throw new Error('Target distance must be an integer from 600 to 1400 metres.');
  if (!['beginner', 'intermediate', 'advanced'].includes(request.difficulty)) throw new Error('Unsupported difficulty.');
  if (!['navigation', 'route-choice', 'physical'].includes(request.focus)) throw new Error('Unsupported training focus.');
  if (!Number.isInteger(request.controlCount) || request.controlCount < 3 || request.controlCount > 5) throw new Error('The number of controls must be from 3 to 5.');
  if (request.controlMode !== undefined && !['verified', 'explore'].includes(request.controlMode)) throw new Error('Unsupported control-generation mode.');
  return request;
}

export function createEngine({ controls, network, knowledge, verification }) {
const state = { controls, network, graph: new Map(), nodeCoordinates: new Map(), shortestCache: new Map(), snapped: new Map() };
function buildGraph() {
  state.graph.clear();
  state.nodeCoordinates.clear();
  state.shortestCache.clear();
  for (const feature of state.network.features) {
    if (feature.properties?.status !== "MAP_CANDIDATE" || feature.properties.field_verified !== true) continue;
    const [a, b] = feature.geometry.coordinates;
    const aKey = coordinateKey(a);
    const bKey = coordinateKey(b);
    if (!state.graph.has(aKey)) state.graph.set(aKey, []);
    if (!state.graph.has(bKey)) state.graph.set(bKey, []);
    state.nodeCoordinates.set(aKey, pointFromCoordinate(a));
    state.nodeCoordinates.set(bKey, pointFromCoordinate(b));
    const metres = Number(feature.properties.length_m);
    state.graph.get(aKey).push({ to: bKey, metres });
    state.graph.get(bKey).push({ to: aKey, metres });
  }
}

function nearestNode(control) {
  let best = null;
  for (const [nodeKey, coordinate] of state.nodeCoordinates) {
    const metres = geoDistance(control, coordinate);
    if (!best || metres < best.snapM) best = { nodeKey, coordinate, snapM: metres };
  }
  return best;
}

function shortestFrom(startKey) {
  if (state.shortestCache.has(startKey)) return state.shortestCache.get(startKey);
  const costs = new Map([[startKey, 0]]);
  const previous = new Map();
  const queue = new Set([startKey]);
  while (queue.size) {
    let current = null;
    for (const node of queue) if (current === null || costs.get(node) < costs.get(current)) current = node;
    queue.delete(current);
    for (const edge of state.graph.get(current) ?? []) {
      const candidate = costs.get(current) + edge.metres;
      if (candidate < (costs.get(edge.to) ?? Infinity)) {
        costs.set(edge.to, candidate);
        previous.set(edge.to, current);
        queue.add(edge.to);
      }
    }
  }
  const result = { costs, previous };
  state.shortestCache.set(startKey, result);
  return result;
}

function shortestBetween(fromId, toId, withPath = false) {
  const from = state.snapped.get(fromId);
  const to = state.snapped.get(toId);
  if (!from || !to) return null;
  const result = shortestFrom(from.nodeKey);
  const graphM = result.costs.get(to.nodeKey);
  if (!Number.isFinite(graphM)) return null;
  const output = { metres: graphM + from.snapM + to.snapM, graphM };
  if (withPath) {
    const keys = [to.nodeKey];
    let cursor = to.nodeKey;
    while (cursor !== from.nodeKey && result.previous.has(cursor)) {
      cursor = result.previous.get(cursor);
      keys.push(cursor);
    }
    keys.reverse();
    output.path = keys.map(key => state.nodeCoordinates.get(key));
  }
  return output;
}

function buildPolicy(request, documents) {
  const spacingDocument = documents.find(document => document.parameters?.minimum_spacing_m);
  const distanceDocument = documents.find(document => document.parameters?.distance_tolerance);
  const safetyDocument = documents.find(document => document.parameters?.maximum_snap_m);
  const preferenceDocument = documents.find(document => document.parameters?.feature_preference);
  return {
    minimumSpacingM: spacingDocument?.parameters.minimum_spacing_m[request.difficulty] ?? 35,
    tolerance: distanceDocument?.parameters.distance_tolerance ?? .10,
    maximumSnapM: safetyDocument?.parameters.maximum_snap_m ?? 20,
    preferredFeatures: new Set(preferenceDocument?.parameters.feature_preference ?? []),
  };
}

function featurePenalty(control, request, policy) {
  if (control.feature_type === "Playground") return 240;
  if (request.difficulty === "beginner" && policy.preferredFeatures.size && !policy.preferredFeatures.has(control.feature_type)) return 22;
  if (request.focus === "route-choice" && control.feature_type === "Junction") return -12;
  if (request.focus === "navigation" && ["Entrance", "Clock tower", "Path bend"].includes(control.feature_type)) return -7;
  return 0;
}

function generatedControlPool(start, finish, limit = 14) {
  const startSnap = nearestNode(start);
  const finishSnap = nearestNode(finish);
  if (!startSnap || !finishSnap) return [];
  const reachable = shortestFrom(startSnap.nodeKey).costs;
  const candidates = [...state.nodeCoordinates.entries()]
    .filter(([nodeKey]) => nodeKey !== startSnap.nodeKey && nodeKey !== finishSnap.nodeKey && Number.isFinite(reachable.get(nodeKey)))
    .map(([nodeKey, coordinate]) => ({ nodeKey, coordinate, degree: state.graph.get(nodeKey)?.length ?? 0 }));

  const selected = [];
  const anchors = [start, finish];
  while (selected.length < limit && candidates.length) {
    candidates.sort((a, b) => {
      const aDistance = Math.min(...anchors.map(anchor => geoDistance(anchor, a.coordinate)));
      const bDistance = Math.min(...anchors.map(anchor => geoDistance(anchor, b.coordinate)));
      return bDistance - aDistance || b.degree - a.degree || a.nodeKey.localeCompare(b.nodeKey);
    });
    const next = candidates.shift();
    selected.push(next);
    anchors.push(next.coordinate);
  }

  return selected.map(({ nodeKey, coordinate }, index) => ({
    id: `GP${String(index + 1).padStart(2, '0')}`,
    description: 'System-generated virtual GPS control on a path-network node I verified',
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    feature_type: 'Virtual GPS control',
    status: 'eligible',
    provisional_demo: false,
    generated: true,
    blocking_issues: [],
    nodeKey,
  }));
}

function generateCourses(request, policy, limit = 12) {
  state.snapped.clear();
  const mode = request.controlMode ?? 'verified';
  const start = state.controls.find(control => control.id === "CP01");
  const finish = state.controls.find(control => control.id === "CP16");
  if (!start || !finish || start.status !== 'eligible' || finish.status !== 'eligible') {
    throw new Error('The start or finish is unavailable; generation stopped.');
  }

  const generated = mode === 'explore' ? generatedControlPool(start, finish) : [];
  const activeControls = mode === 'explore' ? [start, ...generated, finish] : state.controls;
  for (const control of activeControls) {
    if (!control.generated && (control.status !== "eligible" || control.blocking_issues?.length || control.provisional_demo)) continue;
    if (control.generated) {
      state.snapped.set(control.id, { nodeKey: control.nodeKey, coordinate: control, snapM: 0, control });
      continue;
    }
    const snap = nearestNode(control);
    if (snap && snap.snapM <= policy.maximumSnapM) state.snapped.set(control.id, { ...snap, control });
  }

  const pool = activeControls.filter(control => control.id !== start?.id && control.id !== finish?.id && state.snapped.has(control.id));
  if (!start || !finish || !state.snapped.has(start.id) || !state.snapped.has(finish.id) || pool.length < request.controlCount) {
    throw new Error("There are not enough connected candidate controls to satisfy this request.");
  }

  const feasible = [];
  const chosen = [];
  const used = new Set();

  function visit(previous, routedM, minSpacingM, penalty) {
    if (chosen.length === request.controlCount) {
      const spacingToFinish = Math.min(...[start, ...chosen].map(control => geoDistance(control, finish)));
      if (spacingToFinish < policy.minimumSpacingM) return;
      const lastLeg = shortestBetween(previous.id, finish.id);
      if (!lastLeg) return;
      const totalM = routedM + lastLeg.metres;
      if (Math.abs(totalM - request.targetDistanceM) > request.targetDistanceM * policy.tolerance) return;
      const score = Math.abs(totalM - request.targetDistanceM) + penalty;
      feasible.push({ sequence: [start, ...chosen, finish], routedM: totalM, minSpacingM: Math.min(minSpacingM, spacingToFinish), score });
      return;
    }

    for (const candidate of pool) {
      if (used.has(candidate.id)) continue;
      const spacing = Math.min(...[start, ...chosen].map(control => geoDistance(control, candidate)));
      if (spacing < policy.minimumSpacingM) continue;
      const leg = shortestBetween(previous.id, candidate.id);
      if (!leg) continue;
      const nextRouted = routedM + leg.metres;
      if (nextRouted > request.targetDistanceM * 1.65) continue;
      used.add(candidate.id);
      chosen.push(candidate);
      visit(candidate, nextRouted, Math.min(minSpacingM, spacing), penalty + featurePenalty(candidate, request, policy));
      chosen.pop();
      used.delete(candidate.id);
    }
  }

  visit(start, 0, Infinity, 0);
  if (!feasible.length) throw new Error("No route satisfies the distance, connectivity and all-pairs minimum-spacing rules.");
  feasible.sort((a, b) => a.score - b.score || a.sequence.map(control => control.id).join(',').localeCompare(b.sequence.map(control => control.id).join(',')));
  return feasible.slice(0, limit).map(candidate => {
    const course = { ...candidate, legs: [], referencePath: [] };
    for (let index = 0; index < course.sequence.length - 1; index += 1) {
      const from = course.sequence[index];
      const to = course.sequence[index + 1];
      const leg = shortestBetween(from.id, to.id, true);
      course.legs.push({ from: from.id, to: to.id, metres: leg.metres });
      course.referencePath.push(leg.path);
    }
    return course;
  });
}

function resultForCourse(course, request, documents, policy) {
  const mode = request.controlMode ?? 'verified';
  const pathPass = verification?.path_walked_and_connected === true;
  const controlPass = mode === 'explore' ? pathPass : verification?.control_features_confirmed === true;
  const hazardPass = verification?.hazard_review_pass === true;
  const verified = pathPass && controlPass && hazardPass;
  return {
    status: verified ? 'verified_course' : 'review_required',
    safe_for_real_use: verified,
    abstained: false,
    field_review_required: !verified,
    control_mode: mode,
    generated_control_points: course.sequence.filter(c => c.generated).map(c => ({
      id: c.id,
      latitude: c.latitude,
      longitude: c.longitude,
      description: c.description,
      verification_status: 'virtual_control_on_verified_path',
    })),
    generated_control_order: course.sequence.map(c => c.id),
    routed_distance_m: course.routedM,
    minimum_spacing_m: course.minSpacingM,
    distance_within_tolerance: Math.abs(course.routedM - request.targetDistanceM) <= request.targetDistanceM * policy.tolerance,
    spacing_pass: course.minSpacingM >= policy.minimumSpacingM,
    field_verified_path_pass: verification?.path_walked_and_connected === true,
    control_points_verified_pass: controlPass,
    hazard_review_pass: hazardPass,
    retrieved_rule_ids: documents.map(d => d.id),
  };
}

buildGraph();
return {
  generate(request) {
    validateRequest(request);
    const documents = retrieveDocuments(knowledge, request);
    const policy = buildPolicy(request, documents);
    const [course] = generateCourses(request, policy, 1);
    return { course, policy, documents, result: resultForCourse(course, request, documents, policy) };
  },
  generateCandidates(request, limit = 12) {
    validateRequest(request);
    if (!Number.isInteger(limit) || limit < 1 || limit > 24) throw new Error('The number of route candidates must be from 1 to 24.');
    const documents = retrieveDocuments(knowledge, request);
    const policy = buildPolicy(request, documents);
    const courses = generateCourses(request, policy, limit);
    const candidates = courses.map((course, index) => ({
      id: `C${String(index + 1).padStart(2, '0')}`,
      course,
      result: resultForCourse(course, request, documents, policy),
    }));
    return { candidates, policy, documents };
  },
};
}

export function templateExplanation(result) {
  const generatedNote = result.control_mode === 'explore'
    ? `This route contains ${result.generated_control_points.length} system-generated virtual GPS controls on verified path-network nodes. No physical flags or distinctive control features are required. `
    : '';
  return `Route: ${result.generated_control_order.join(' → ')}. Routed distance: ${Math.round(result.routed_distance_m)} m. Minimum spacing between all controls: ${Math.round(result.minimum_spacing_m)} m. Distance and spacing checks passed. ${generatedNote}${result.safe_for_real_use ? 'The route is within the project-verified path scope. Check GPS accuracy, temporary construction, weather and other current site conditions before training.' : 'The verification information is incomplete, so this route cannot be released.'}`;
}
