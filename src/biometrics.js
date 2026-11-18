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

export function assessLiveness(frames) {
  if (!Array.isArray(frames) || frames.length !== 3 || frames.some((frame) => !validFrame(frame))) {
    return { ok: false, error: 'liveness_failed' };
  }
  if (!samePerson(frames, 0.55)) return { ok: false, error: 'liveness_failed' };

  const ears = frames.map((frame) => frame.ear);
  const yaws = frames.map((frame) => frame.yaw);
  const minEar = Math.min(...ears);
  const minIndex = ears.indexOf(minEar);
  const blink = minIndex === 1
    && ears[0] >= 0.24
    && ears[2] >= 0.24
    && ears[0] - minEar >= 0.05
    && ears[2] - minEar >= 0.05
    && minEar <= 0.23;
  const yawRange = Math.max(...yaws) - Math.min(...yaws);
  const turn = yawRange >= 0.18;
  if (!blink && !turn) return { ok: false, error: 'liveness_failed' };
  return { ok: true, method: blink ? 'kedip' : 'geleng' };
}

export function evidenceFrameIndex(frames, method) {
  if (method === 'kedip') {
    let index = 0;
    frames.forEach((frame, i) => {
      if (frame.ear > frames[index].ear) index = i;
    });
    return index;
  }
  let index = 0;
  frames.forEach((frame, i) => {
    if (Math.abs(frame.yaw) < Math.abs(frames[index].yaw)) index = i;
  });
  return index;
}

export function assessEnrollment(frames) {
  if (!Array.isArray(frames) || frames.length !== 3 || frames.some((frame) => !validFrame(frame))) {
    return { ok: false, error: 'need_three_faces' };
  }
  if (!samePerson(frames, 0.6)) return { ok: false, error: 'different_person' };
  const yaws = frames.map((frame) => frame.yaw);
  if (Math.max(...yaws) - Math.min(...yaws) < 0.1) return { ok: false, error: 'need_pose_variety' };
  return { ok: true };
}
