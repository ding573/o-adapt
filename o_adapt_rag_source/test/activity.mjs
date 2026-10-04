import assert from 'node:assert/strict';
import { activityToGpx, processLocationSample } from '../public/lib/activity-tracker.js';

const controls = [
  { id: 'CP01', latitude: 1.3400, longitude: 103.7200 },
  { id: 'CP05', latitude: 1.3405, longitude: 103.7202 },
  { id: 'CP16', latitude: 1.3410, longitude: 103.7204 },
];
const activity = { positions: [], arrivals: [], next_control_index: 0, confirmation: null, distance_m: 0 };
const reading = (control, timestamp_ms, accuracy_m = 8, offset = 0) => ({
  latitude: control.latitude + offset,
  longitude: control.longitude + offset,
  accuracy_m,
  altitude_m: 12,
  timestamp_ms,
});

// A later control cannot be recorded before the start control.
assert.equal(processLocationSample(activity, controls, reading(controls[1], 1000)).arrived, null);
assert.equal(activity.next_control_index, 0);

// Every control requires two consecutive qualifying readings.
assert.equal(processLocationSample(activity, controls, reading(controls[0], 21000)).arrived, null);
assert.equal(processLocationSample(activity, controls, reading(controls[0], 22000, 8, 0.000001)).arrived.control_id, 'CP01');

// A nearby reading with poor accuracy contributes no check-in confirmation.
assert.equal(processLocationSample(activity, controls, reading(controls[1], 32000, 30)).reason, 'insufficient_accuracy');
assert.equal(processLocationSample(activity, controls, reading(controls[1], 33000)).arrived, null);
assert.equal(processLocationSample(activity, controls, reading(controls[1], 34000, 8, 0.000001)).arrived.control_id, 'CP05');

assert.equal(processLocationSample(activity, controls, reading(controls[2], 44000)).arrived, null);
assert.equal(processLocationSample(activity, controls, reading(controls[2], 45000, 8, 0.000001)).arrived.control_id, 'CP16');
assert.deepEqual(activity.arrivals.map(item => item.control_id), ['CP01', 'CP05', 'CP16']);
assert.equal(activity.next_control_index, controls.length);
assert.ok(activity.distance_m > 0);

// Implausible one-second jumps are rejected rather than added to the trace.
const jumpActivity = { positions: [], arrivals: [], next_control_index: 0, confirmation: null, distance_m: 0 };
processLocationSample(jumpActivity, controls, reading(controls[0], 1000));
const jump = processLocationSample(jumpActivity, controls, { latitude: 1.36, longitude: 103.74, accuracy_m: 5, altitude_m: null, timestamp_ms: 2000 });
assert.equal(jump.reason, 'implausible_step');
assert.equal(jumpActivity.positions.length, 1);

const restored = JSON.parse(JSON.stringify(activity));
assert.equal(restored.arrivals.length, 3);
const gpx = activityToGpx(activity);
assert.ok(gpx.startsWith('<?xml'));
assert.equal((gpx.match(/<wpt /g) ?? []).length, 3);
assert.equal((gpx.match(/<trkpt /g) ?? []).length, activity.positions.length);
for (const control of controls) assert.ok(gpx.includes(`<name>${control.id}</name>`));

console.log('Passed: ordered GPS check-ins, accuracy gate, jump rejection, local JSON persistence and GPX export.');
