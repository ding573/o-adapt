// Client-side GPS activity logic. It records only sufficiently accurate samples,
// confirms controls in course order, and exports portable evidence without a server.
export const ACTIVITY_LIMITS = Object.freeze({
  checkInRadiusM: 20,
  maxCheckInAccuracyM: 25,
  maxTrackAccuracyM: 50,
  confirmationReadings: 2,
});

const radians = value => value * Math.PI / 180;

export function distanceMetres(a, b) {
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function validReading(reading) {
  return Number.isFinite(reading?.latitude)
    && Number.isFinite(reading?.longitude)
    && Number.isFinite(reading?.accuracy_m)
    && Number.isFinite(reading?.timestamp_ms);
}

function plausibleStep(previous, current) {
  if (!previous) return true;
  const elapsedSeconds = Math.max(0, (current.timestamp_ms - previous.timestamp_ms) / 1000);
  const maximumStepM = Math.max(100, elapsedSeconds * 8 + 30);
  return distanceMetres(previous, current) <= maximumStepM;
}

export function processLocationSample(activity, checkpoints, reading, limits = ACTIVITY_LIMITS) {
  if (!validReading(reading)) return { accepted: false, arrived: null, reason: 'invalid_reading' };
  const sample = {
    latitude: Number(reading.latitude),
    longitude: Number(reading.longitude),
    accuracy_m: Number(reading.accuracy_m),
    altitude_m: Number.isFinite(reading.altitude_m) ? Number(reading.altitude_m) : null,
    timestamp_ms: Number(reading.timestamp_ms),
  };

  let accepted = false;
  if (sample.accuracy_m <= limits.maxTrackAccuracyM && plausibleStep(activity.positions.at(-1), sample)) {
    const previous = activity.positions.at(-1);
    if (previous) activity.distance_m += distanceMetres(previous, sample);
    activity.positions.push(sample);
    accepted = true;
  }

  if (!accepted && activity.positions.length) {
    return { accepted: false, arrived: null, reason: sample.accuracy_m > limits.maxTrackAccuracyM ? 'insufficient_accuracy' : 'implausible_step' };
  }

  const target = checkpoints[activity.next_control_index];
  if (!target || sample.accuracy_m > limits.maxCheckInAccuracyM) {
    return { accepted, arrived: null, reason: target ? 'insufficient_accuracy' : 'course_complete' };
  }

  const distanceToTargetM = distanceMetres(sample, target);
  if (distanceToTargetM > limits.checkInRadiusM) {
    activity.confirmation = { control_id: target.id, readings: 0 };
    return { accepted, arrived: null, distance_to_target_m: distanceToTargetM };
  }

  const readings = activity.confirmation?.control_id === target.id ? activity.confirmation.readings + 1 : 1;
  activity.confirmation = { control_id: target.id, readings };
  if (readings < limits.confirmationReadings) {
    return { accepted, arrived: null, distance_to_target_m: distanceToTargetM };
  }

  const arrived = {
    control_id: target.id,
    sequence_index: activity.next_control_index,
    timestamp_ms: sample.timestamp_ms,
    distance_to_control_m: distanceToTargetM,
    accuracy_m: sample.accuracy_m,
  };
  activity.arrivals.push(arrived);
  activity.next_control_index += 1;
  activity.confirmation = null;
  return { accepted, arrived, distance_to_target_m: distanceToTargetM };
}

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export function activityToGpx(activity) {
  const waypoints = activity.arrivals.map(item => {
    const sample = activity.positions.find(point => point.timestamp_ms === item.timestamp_ms) ?? activity.positions.at(-1);
    if (!sample) return '';
    return `  <wpt lat="${sample.latitude}" lon="${sample.longitude}"><time>${new Date(item.timestamp_ms).toISOString()}</time><name>${escapeXml(item.control_id)}</name></wpt>`;
  }).filter(Boolean).join('\n');
  const trackPoints = activity.positions.map(point => `      <trkpt lat="${point.latitude}" lon="${point.longitude}">${point.altitude_m === null ? '' : `<ele>${point.altitude_m}</ele>`}<time>${new Date(point.timestamp_ms).toISOString()}</time></trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="O-Adapt" xmlns="http://www.topografix.com/GPX/1/1">\n${waypoints}\n  <trk><name>O-Adapt activity</name><trkseg>\n${trackPoints}\n    </trkseg></trk>\n</gpx>\n`;
}
