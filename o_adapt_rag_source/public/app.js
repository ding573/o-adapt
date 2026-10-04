// Browser presentation layer. Route selection happens on the server through the
// RAG-grounded model; this client renders the checked result and fixed summary.
import { templateExplanation } from './lib/course-engine.js';
import { activityToGpx, processLocationSample } from './lib/activity-tracker.js';
const SVG_NS = "http://www.w3.org/2000/svg";
const form = document.querySelector("#course-form");
const map = document.querySelector("#course-map");
const loading = document.querySelector("#map-loading");
const routeToggle = document.querySelector("#route-toggle");
const generateButton = form.querySelector("button[type='submit']");
const startActivityButton = document.querySelector('#start-activity');
const stopActivityButton = document.querySelector('#stop-activity');
const clearActivityButton = document.querySelector('#clear-activity');
const exportJsonButton = document.querySelector('#export-json');
const exportGpxButton = document.querySelector('#export-gpx');
const ACTIVITY_STORAGE_KEY = new URLSearchParams(location.search).get('v')?.includes('test')
  ? 'o-adapt-activity-test-v2'
  : 'o-adapt-activity-v2';

const state = {
  controls: [],
  network: null,
  knowledge: [],
  bounds: null,
  projection: null,
  activeReferenceLayer: null,
  lastResult: null,
  activeCourse: null,
  activity: null,
  locationWatchId: null,
  activityTimerId: null,
};

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
}

function routeSignature(course) {
  return course?.sequence?.map(control => control.id).join('>') ?? '';
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function saveActivity() {
  try {
    if (state.activity) localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(state.activity));
    else localStorage.removeItem(ACTIVITY_STORAGE_KEY);
  } catch {
    // The activity remains available in memory when private browsing blocks storage.
  }
}

function renderActivityTrack() {
  map.querySelector('#activity-track')?.remove();
  const activity = state.activity;
  if (!activity?.positions?.length || !state.projection || activity.route_signature !== routeSignature(state.activeCourse)) return;
  const layer = svgElement('g', { id: 'activity-track' });
  const points = activity.positions.map(point => {
    const projected = state.projection([point.longitude, point.latitude]);
    return `${projected.x.toFixed(2)},${projected.y.toFixed(2)}`;
  }).join(' ');
  layer.append(svgElement('polyline', {
    points,
    fill: 'none',
    stroke: '#f7c95c',
    'stroke-width': 5,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    opacity: .95,
  }));
  const latest = activity.positions.at(-1);
  const position = state.projection([latest.longitude, latest.latitude]);
  layer.append(svgElement('circle', { cx: position.x, cy: position.y, r: 7, fill: '#f7c95c', stroke: '#071516', 'stroke-width': 3 }));
  map.append(layer);
}

function renderTracking() {
  const activity = state.activity;
  const recording = activity?.status === 'recording';
  const verifiedCourseReady = Boolean(state.activeCourse && state.lastResult?.safe_for_real_use);
  const status = document.querySelector('#tracking-status');
  status.className = `status-badge ${activity?.status === 'completed' ? 'pass' : activity?.last_error ? 'fail' : 'pending'}`;
  if (activity?.last_error) status.textContent = activity.last_error;
  else if (activity?.status === 'completed') status.textContent = 'Course completed';
  else if (recording) status.textContent = 'Recording GPS';
  else if (activity) status.textContent = 'Activity stopped';
  else if (verifiedCourseReady) status.textContent = 'Ready to record';
  else if (state.activeCourse) status.textContent = 'A route within the verified path scope is required';
  else status.textContent = 'Generate a verified route first';

  startActivityButton.disabled = !verifiedCourseReady || Boolean(activity);
  stopActivityButton.disabled = !recording;
  clearActivityButton.disabled = !activity;
  exportJsonButton.disabled = !activity;
  exportGpxButton.disabled = !activity?.positions?.length;

  const elapsedEnd = recording ? Date.now() : activity?.ended_at_ms ?? activity?.started_at_ms ?? Date.now();
  document.querySelector('#activity-time').textContent = activity ? formatDuration(elapsedEnd - activity.started_at_ms) : '00:00';
  document.querySelector('#activity-distance').textContent = `${Math.round(activity?.distance_m ?? 0)} m`;
  document.querySelector('#activity-controls').textContent = `${activity?.arrivals?.length ?? 0}/${activity?.route_controls?.length ?? 0}`;
  document.querySelector('#activity-accuracy').textContent = Number.isFinite(activity?.last_accuracy_m) ? `±${Math.round(activity.last_accuracy_m)} m` : '—';

  const progress = document.querySelector('#checkpoint-progress');
  if (!activity) {
    progress.innerHTML = `<p>${verifiedCourseReady ? 'Start the activity when you are ready at the start control.' : 'Generate a verified route to enable activity tracking.'}</p>`;
  } else {
    progress.innerHTML = activity.route_controls.map((control, index) => {
      const reached = index < activity.next_control_index;
      const current = index === activity.next_control_index && activity.status !== 'completed';
      const arrival = activity.arrivals.find(item => item.sequence_index === index);
      const detail = arrival ? ` · ${new Date(arrival.timestamp_ms).toLocaleTimeString()}` : '';
      return `<span class="checkpoint-chip ${reached ? 'reached' : current ? 'current' : ''}">${reached ? '✓ ' : current ? '→ ' : ''}${control.id}${detail}</span>`;
    }).join('');
  }
  renderActivityTrack();
}

function computeProjection() {
  const coordinates = [];
  for (const feature of state.network.features) coordinates.push(...feature.geometry.coordinates);
  for (const control of state.controls) coordinates.push([control.longitude, control.latitude]);
  const longitudes = coordinates.map(item => Number(item[0]));
  const latitudes = coordinates.map(item => Number(item[1]));
  const bounds = {
    minLon: Math.min(...longitudes), maxLon: Math.max(...longitudes),
    minLat: Math.min(...latitudes), maxLat: Math.max(...latitudes),
  };
  const pad = 48;
  const width = 900 - pad * 2;
  const height = 620 - pad * 2;
  const lonSpan = bounds.maxLon - bounds.minLon;
  const latSpan = bounds.maxLat - bounds.minLat;
  const scale = Math.min(width / lonSpan, height / latSpan);
  const usedWidth = lonSpan * scale;
  const usedHeight = latSpan * scale;
  const offsetX = (900 - usedWidth) / 2;
  const offsetY = (620 - usedHeight) / 2;
  state.bounds = bounds;
  state.projection = ([longitude, latitude]) => ({
    x: offsetX + (longitude - bounds.minLon) * scale,
    y: 620 - offsetY - (latitude - bounds.minLat) * scale,
  });
}

function addMapBase() {
  map.replaceChildren();
  const background = svgElement("rect", { x: 0, y: 0, width: 900, height: 620, fill: "#172b2c" });
  map.append(background);

  const grid = svgElement("g", { opacity: .14 });
  for (let x = 90; x < 900; x += 120) grid.append(svgElement("line", { x1: x, y1: 0, x2: x, y2: 620, stroke: "#8ec6bd", "stroke-width": 1 }));
  for (let y = 70; y < 620; y += 100) grid.append(svgElement("line", { x1: 0, y1: y, x2: 900, y2: y, stroke: "#8ec6bd", "stroke-width": 1 }));
  map.append(grid);

  const excludedLayer = svgElement("g", { opacity: .62 });
  const pathLayer = svgElement("g");
  for (const feature of state.network.features) {
    const points = feature.geometry.coordinates.map(coordinate => {
      const p = state.projection(coordinate);
      return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    }).join(" ");
    const excluded = feature.properties?.status !== "MAP_CANDIDATE";
    const line = svgElement("polyline", {
      points,
      fill: "none",
      stroke: excluded ? "#8d5f5a" : "#79958f",
      "stroke-width": excluded ? 2.3 : 3.4,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "stroke-dasharray": excluded ? "7 7" : "none",
    });
    (excluded ? excludedLayer : pathLayer).append(line);
  }
  map.append(excludedLayer, pathLayer);

  const frame = svgElement("rect", { x: 18, y: 18, width: 864, height: 584, rx: 14, fill: "none", stroke: "#436060", "stroke-width": 1 });
  map.append(frame);
}

function drawCourse(course) {
  addMapBase();
  const courseLayer = svgElement("g", { id: "course-layer" });
  const coursePoints = course.sequence.map(control => {
    const p = state.projection([control.longitude, control.latitude]);
    return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  }).join(" ");
  courseLayer.append(svgElement("polyline", {
    points: coursePoints,
    fill: "none",
    stroke: "#ff4fa3",
    "stroke-width": 5,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    opacity: .88,
  }));

  course.sequence.forEach((control, index) => {
    const p = state.projection([control.longitude, control.latitude]);
    const isStart = index === 0;
    const isFinish = index === course.sequence.length - 1;
    const group = svgElement("g", { transform: `translate(${p.x} ${p.y})` });
    if (isStart) {
      group.append(svgElement("polygon", { points: "0,-18 16,12 -16,12", fill: "#172b2c", stroke: "#ff4fa3", "stroke-width": 5 }));
    } else if (isFinish) {
      group.append(svgElement("circle", { r: 17, fill: "#172b2c", stroke: "#ff4fa3", "stroke-width": 4 }));
      group.append(svgElement("circle", { r: 11, fill: "none", stroke: "#ff4fa3", "stroke-width": 3 }));
    } else {
      group.append(svgElement("circle", { r: 17, fill: "#172b2c", stroke: "#ff4fa3", "stroke-width": 5 }));
      const number = svgElement("text", { x: 0, y: 5, "text-anchor": "middle", fill: "#ffffff", "font-size": 14, "font-weight": 900 });
      number.textContent = String(index);
      group.append(number);
    }
    const label = svgElement("text", { x: 22, y: -18, fill: "#ffffff", "font-size": 12, "font-weight": 800, stroke: "#071516", "stroke-width": 3, "paint-order": "stroke" });
    label.textContent = control.id;
    group.append(label);
    courseLayer.append(group);
  });
  map.append(courseLayer);

  const referenceLayer = svgElement("g", { id: "reference-route", style: "display:none" });
  for (const path of course.referencePath) {
    const points = path.map(point => {
      const p = state.projection([point.longitude, point.latitude]);
      return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    }).join(" ");
    referenceLayer.append(svgElement("polyline", {
      points,
      fill: "none",
      stroke: "#68e0d1",
      "stroke-width": 6,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "stroke-dasharray": "10 8",
      opacity: .95,
    }));
  }
  map.insertBefore(referenceLayer, courseLayer);
  state.activeReferenceLayer = referenceLayer;
  routeToggle.disabled = false;
  routeToggle.dataset.visible = "false";
  routeToggle.textContent = "View reference route after completion";
}

function renderKnowledge(documents) {
  document.querySelector("#retrieval-count").textContent = `${documents.length} rules retrieved`;
  document.querySelector("#knowledge-list").innerHTML = documents.map((document, index) => `
    <article class="knowledge-card">
      <span class="rank">RETRIEVED ${String(index + 1).padStart(2, "0")}</span>
      <h3>${document.title}</h3>
      <p>${document.text}</p>
      ${document.url === "#" ? `<a>Project rule · ${document.source}</a>` : `<a href="${document.url}" target="_blank" rel="noreferrer">Source: ${document.source} ↗</a>`}
    </article>
  `).join("");
}

function renderModelExplanation(stateName, statusText, explanationText) {
  const card = document.querySelector('#model-explanation-card');
  card.classList.remove('idle', 'loading', 'success', 'fallback');
  card.classList.add(stateName);
  document.querySelector('#model-status').textContent = statusText;
  document.querySelector('#model-explanation').textContent = explanationText;
}

function renderResult({ course, documents, result, selection_reason, model, usage, latency_ms, candidate_count }) {
  state.activeCourse = course;
  drawCourse(course);
  renderKnowledge(documents);
  state.lastResult = result;
  document.querySelector('#result-strip').hidden = false;
  document.querySelector('#result-distance').textContent = `${Math.round(course.routedM)} m`;
  document.querySelector('#result-controls').textContent = `${course.sequence.length - 2}`;
  document.querySelector('#result-spacing').textContent = `${Math.round(course.minSpacingM)} m`;
  document.querySelector('#result-rules').textContent = `${documents.length}`;
  const checks = [['Distance within target ±10%', result.distance_within_tolerance], ['Minimum spacing between all controls', result.spacing_pass], ['Path-network verification', result.field_verified_path_pass], [result.control_mode === 'explore' ? 'Virtual controls on verified path nodes' : 'Control field verification', result.control_points_verified_pass], ['Hazard review', result.hazard_review_pass]];
  document.querySelector('#check-list').innerHTML = checks.map(([label, pass]) => `<div class="check ${pass ? 'pass' : 'fail'}"><span>${label}</span><b>${pass ? '✓ Passed' : '× Pending'}</b></div>`).join('');
  const badge = document.querySelector('#publish-state');
  badge.className = `status-badge ${result.safe_for_real_use ? 'pass' : 'fail'}`;
  badge.textContent = result.safe_for_real_use ? 'Project verification passed' : 'Verification information incomplete';
  document.querySelector('#route-summary').textContent = templateExplanation(result);
  state.lastResult.model_call = { status: 'success', model, usage, latency_ms };
  renderModelExplanation(
    'success',
    `Model route selection succeeded · ${model} · selected ${result.selected_candidate_id} from ${candidate_count} valid candidates · ${Math.round(latency_ms)} ms · tokens: ${usage?.total_tokens ?? 'unknown'} · cost USD: ${usage?.cost ?? 'unknown'}`,
    `${selection_reason} (rules used: ${result.model_used_rule_ids.join(', ')})`,
  );
  const generatedList = document.querySelector('#generated-control-list');
  generatedList.hidden = result.generated_control_points.length === 0;
  generatedList.innerHTML = result.generated_control_points.length ? `
    <h3>System-generated virtual GPS controls</h3>
    <ul>${result.generated_control_points.map(point => `<li><strong>${point.id}</strong> · ${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)} · located on a path-network node I verified</li>`).join('')}</ul>
  ` : '';
  renderTracking();
}

function readRequest() {
  return {
    targetDistanceM: Number(document.querySelector("#distance").value),
    difficulty: document.querySelector("#difficulty").value,
    controlCount: Number(document.querySelector("#control-count").value),
    focus: document.querySelector("#focus").value,
    controlMode: document.querySelector("#control-mode").value,
  };
}

function updateModeNote(controlMode) {
  document.querySelector('#mode-note').textContent = controlMode === 'explore'
    ? 'Generate virtual GPS controls on verified path-network nodes. No physical flags or distinctive features are required.'
    : 'Generate a route using paths and controls I verified.';
}

function stopActivity(status = 'stopped') {
  if (state.locationWatchId !== null) navigator.geolocation?.clearWatch(state.locationWatchId);
  state.locationWatchId = null;
  if (state.activity?.status === 'recording') {
    state.activity.status = status;
    state.activity.ended_at_ms = Date.now();
  }
  if (state.activityTimerId !== null) clearInterval(state.activityTimerId);
  state.activityTimerId = null;
  saveActivity();
  renderTracking();
}

function handleLocation(position) {
  if (state.activity?.status !== 'recording') return;
  const reading = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy_m: position.coords.accuracy,
    altitude_m: position.coords.altitude,
    timestamp_ms: position.timestamp,
  };
  state.activity.last_accuracy_m = reading.accuracy_m;
  state.activity.last_error = null;
  const outcome = processLocationSample(state.activity, state.activity.route_controls, reading);
  if (outcome.arrived && state.activity.next_control_index === state.activity.route_controls.length) {
    state.activity.status = 'completed';
    state.activity.ended_at_ms = reading.timestamp_ms;
    if (state.locationWatchId !== null) navigator.geolocation.clearWatch(state.locationWatchId);
    state.locationWatchId = null;
    if (state.activityTimerId !== null) clearInterval(state.activityTimerId);
    state.activityTimerId = null;
  }
  saveActivity();
  renderTracking();
}

function handleLocationError(error) {
  if (!state.activity) return;
  const messages = {
    1: 'Location permission was denied',
    2: 'Location is currently unavailable',
    3: 'Location request timed out',
  };
  state.activity.last_error = messages[error.code] ?? 'Location tracking failed';
  stopActivity('stopped');
}

function startActivity() {
  if (!state.activeCourse || !state.lastResult?.safe_for_real_use || state.activity) return;
  if (!navigator.geolocation) {
    document.querySelector('#tracking-status').textContent = 'Geolocation is not supported by this browser';
    document.querySelector('#tracking-status').className = 'status-badge fail';
    return;
  }
  state.activity = {
    schema_version: 1,
    activity_id: `ACT-${new Date().toISOString().replaceAll(/[-:.TZ]/g, '').slice(0, 14)}`,
    route_signature: routeSignature(state.activeCourse),
    route_controls: state.activeCourse.sequence.map(control => ({
      id: control.id,
      latitude: control.latitude,
      longitude: control.longitude,
    })),
    status: 'recording',
    started_at_ms: Date.now(),
    ended_at_ms: null,
    positions: [],
    arrivals: [],
    next_control_index: 0,
    confirmation: null,
    distance_m: 0,
    last_accuracy_m: null,
    last_error: null,
    storage_scope: 'browser_local_only',
  };
  saveActivity();
  state.locationWatchId = navigator.geolocation.watchPosition(handleLocation, handleLocationError, {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 15000,
  });
  state.activityTimerId = setInterval(renderTracking, 1000);
  renderTracking();
}

function clearActivity() {
  if (state.activity?.status === 'recording') stopActivity('stopped');
  state.activity = null;
  saveActivity();
  renderTracking();
}

function downloadActivity(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportActivityJson() {
  if (!state.activity) return;
  downloadActivity(`${state.activity.activity_id}.json`, `${JSON.stringify(state.activity, null, 2)}\n`, 'application/json');
}

function exportActivityGpx() {
  if (!state.activity?.positions?.length) return;
  downloadActivity(`${state.activity.activity_id}.gpx`, activityToGpx(state.activity), 'application/gpx+xml');
}

async function runGeneration() {
  if (state.activity?.status === 'recording') stopActivity('stopped');
  const request = readRequest();
  state.lastResult = null;
  state.activeCourse = null;
  state.activeReferenceLayer = null;
  routeToggle.disabled = true;
  document.querySelector("#result-strip").hidden = true;
  document.querySelector('#generated-control-list').hidden = true;
  generateButton.disabled = true;
  generateButton.querySelector("span:first-child").textContent = "Retrieving evidence and selecting a route…";
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 40)));
  try {
    renderModelExplanation('loading', 'Requesting model route selection…', 'The model will choose the final option using the request, RAG rules and candidates that passed hard checks.');
    const response = await fetch('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request }), signal: AbortSignal.timeout(35000),
    });
    const payload = await response.json();
    if (!response.ok || payload.status !== 'ok') throw new Error(payload.message || 'Model route generation failed');
    renderResult(payload);
    return state.lastResult;
  } catch (error) {
    addMapBase();
    const message = svgElement("text", { x: 450, y: 310, "text-anchor": "middle", fill: "#ffaaa2", "font-size": 17, "font-weight": 800 });
    message.textContent = error.message;
    map.append(message);
    state.lastResult = { status: 'abstained', abstained: true, safe_for_real_use: false, reason: error.message };
    state.activeCourse = null;
    document.querySelector('#check-list').replaceChildren();
    document.querySelector('#knowledge-list').replaceChildren();
    document.querySelector('#retrieval-count').textContent = 'No route generated';
    document.querySelector('#publish-state').textContent = 'Generation declined';
    document.querySelector('#publish-state').className = 'status-badge fail';
    document.querySelector('#route-summary').textContent = error.message;
    renderModelExplanation('fallback', 'No route generated.', `Model selection or deterministic validation failed: ${error.message}`);
    renderTracking();
    return state.lastResult;
  } finally {
    generateButton.disabled = false;
    generateButton.querySelector("span:first-child").textContent = "Generate a new route";
  }
}

function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const allowedDifficulties = ["beginner", "intermediate", "advanced"];
  const allowedFocus = ["navigation", "route-choice", "physical"];
  const allowedControlModes = ["verified", "explore"];
  Promise.resolve(context.registerTool({
    name: "generate_orienteering_course",
    title: "Generate an orienteering course",
    description: "Set the Jurong Central Park training request, retrieve rules, let the configured model select a prevalidated route, and render its fixed-template summary.",
    inputSchema: {
      type: "object",
      properties: {
        targetDistanceM: { type: "integer", minimum: 600, maximum: 1400 },
        difficulty: { type: "string", enum: allowedDifficulties },
        controlCount: { type: "integer", minimum: 3, maximum: 5 },
        focus: { type: "string", enum: allowedFocus },
        controlMode: { type: "string", enum: allowedControlModes },
      },
      required: ["targetDistanceM", "difficulty", "controlCount", "focus"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input) {
      if (!Number.isInteger(input?.targetDistanceM) || input.targetDistanceM < 600 || input.targetDistanceM > 1400) throw new Error("targetDistanceM must be an integer from 600 to 1400.");
      if (!allowedDifficulties.includes(input.difficulty)) throw new Error("Unsupported difficulty.");
      if (!Number.isInteger(input.controlCount) || input.controlCount < 3 || input.controlCount > 5) throw new Error("controlCount must be 3, 4, or 5.");
      if (!allowedFocus.includes(input.focus)) throw new Error("Unsupported focus.");
      const controlMode = input.controlMode ?? 'verified';
      if (!allowedControlModes.includes(controlMode)) throw new Error("Unsupported control mode.");
      document.querySelector("#distance").value = String(input.targetDistanceM);
      document.querySelector("#difficulty").value = input.difficulty;
      document.querySelector("#control-count").value = String(input.controlCount);
      document.querySelector("#focus").value = input.focus;
      document.querySelector("#control-mode").value = controlMode;
      updateModeNote(controlMode);
      return await runGeneration();
    },
  })).catch(() => {});
}

routeToggle.addEventListener("click", () => {
  if (!state.activeReferenceLayer) return;
  const visible = routeToggle.dataset.visible === "true";
  state.activeReferenceLayer.style.display = visible ? "none" : "block";
  routeToggle.dataset.visible = visible ? "false" : "true";
  routeToggle.textContent = visible ? "View reference route after completion" : "Hide reference route";
});

form.addEventListener("submit", event => {
  event.preventDefault();
  runGeneration();
});

document.querySelector('#control-mode').addEventListener('change', event => {
  updateModeNote(event.target.value);
});

startActivityButton.addEventListener('click', startActivity);
stopActivityButton.addEventListener('click', () => stopActivity('stopped'));
clearActivityButton.addEventListener('click', clearActivity);
exportJsonButton.addEventListener('click', exportActivityJson);
exportGpxButton.addEventListener('click', exportActivityGpx);
window.addEventListener('beforeunload', () => {
  if (state.locationWatchId !== null) navigator.geolocation?.clearWatch(state.locationWatchId);
});

async function init() {
  try {
    const [controlData, network] = await Promise.all([
      fetch("./data/controls.json").then(response => response.json()),
      fetch("./data/walkways.geojson").then(response => response.json()),
    ]);
    state.controls = controlData.controls;
    state.network = network;
    computeProjection();
    addMapBase();
    loading.remove();
    try {
      const saved = JSON.parse(localStorage.getItem(ACTIVITY_STORAGE_KEY));
      if (saved?.schema_version === 1 && Array.isArray(saved.positions) && Array.isArray(saved.route_controls)) {
        state.activity = saved;
        if (state.activity.status === 'recording') {
          state.activity.status = 'stopped';
          state.activity.ended_at_ms = Date.now();
          state.activity.last_error = 'Tracking stopped when the page was closed';
          saveActivity();
        }
      }
    } catch {
      localStorage.removeItem(ACTIVITY_STORAGE_KEY);
    }
    renderTracking();
    registerWebMcp();
  } catch (error) {
    loading.textContent = `Data loading failed: ${error.message}`;
  }
}

init();
