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

function descriptorOf(frame) {
  const descriptor = frame?.descriptor;
  if (!Array.isArray(descriptor) || descriptor.length !== DESCRIPTOR_LENGTH) return null;
  if (!descriptor.every((value) => Number.isFinite(value))) return null;
  return descriptor;
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

export function assessEnrollment(frames) {
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > 3) return { ok: false, error: 'need_face' };
  const descriptors = frames.map(descriptorOf);
  if (descriptors.some((descriptor) => !descriptor)) return { ok: false, error: 'need_face' };
  return { ok: true, descriptor: averageDescriptors(descriptors) };
}
