export const DESCRIPTOR_LENGTH = 128;

export function euclidean(left, right) {
  if (!left || !right || left.length !== right.length || left.length === 0) return Infinity;
  let sum = 0;
  for (let i = 0; i < left.length; i += 1) {
    const delta = left[i] - right[i];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

export function bestFaceDistance(probe, samples) {
  let best = Infinity;
  for (const sample of samples) best = Math.min(best, euclidean(probe, sample));
  return best;
}

export function identifyFace(probe, people, maxDistance) {
  const ranked = (people || [])
    .map((person) => ({
      id: person.id,
      distance: bestFaceDistance(probe, person.descriptors || [])
    }))
    .filter((person) => Number.isFinite(person.distance))
    .sort((a, b) => a.distance - b.distance || a.id - b.id);
  if (!ranked.length || ranked[0].distance > maxDistance) return { ok: false, error: 'face_unknown' };
  const second = ranked[1];
  if (second && second.distance <= maxDistance && second.distance - ranked[0].distance < 0.08) {
    return { ok: false, error: 'ambiguous_face' };
  }
  return { ok: true, id: ranked[0].id, distance: ranked[0].distance };
}

function validFrame(frame) {
  if (!frame) return false;
  if (!Number.isFinite(frame.ear) || frame.ear < 0.02 || frame.ear > 0.7) return false;
  if (!Number.isFinite(frame.yaw) || frame.yaw < -2 || frame.yaw > 2) return false;
  if (!Array.isArray(frame.descriptor) || frame.descriptor.length !== DESCRIPTOR_LENGTH) return false;
  return frame.descriptor.every((value) => Number.isFinite(value));
}

function samePerson(frames, maxDistance) {
  for (let i = 0; i < frames.length; i += 1) {
    for (let j = i + 1; j < frames.length; j += 1) {
      if (euclidean(frames[i].descriptor, frames[j].descriptor) > maxDistance) return false;
    }
  }
  return true;
}

export function averageDescriptors(descriptors) {
  if (!descriptors?.length) return null;
  const length = descriptors[0].length;
  const sum = Array.from({ length }, () => 0);
  for (const descriptor of descriptors) {
    if (!descriptor || descriptor.length !== length) return null;
    for (let i = 0; i < length; i += 1) sum[i] += descriptor[i];
  }
  return sum.map((value) => value / descriptors.length);
}

function frontal(frame) {
  const yaw = Number(frame?.yaw);
  const pitch = Number(frame?.pitch);
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return false;
  return Math.abs(yaw) <= 0.28 && Math.abs(pitch) <= 0.28;
}

export function assessEnrollment(frames) {
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > 3 || frames.some((frame) => !validFrame(frame))) {
    return { ok: false, error: 'need_face' };
  }
  if (frames.some((frame) => Number.isFinite(frame.score) && frame.score < 0.45)) {
    return { ok: false, error: 'face_quality' };
  }
  if (frames.some((frame) => !frontal(frame))) return { ok: false, error: 'not_frontal' };
  if (!samePerson(frames, 0.6)) return { ok: false, error: 'different_person' };
  return { ok: true, descriptor: averageDescriptors(frames.map((frame) => frame.descriptor)) };
}
