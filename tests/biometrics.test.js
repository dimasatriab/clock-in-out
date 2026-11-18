import assert from 'node:assert/strict';
import test from 'node:test';
import { assessEnrollment, assessLiveness, bestFaceDistance, euclidean, identifyFace } from '../src/biometrics.js';

function descriptor(shift = 0) {
  const values = Array.from({ length: 128 }, (_, index) => ((index % 5) - 2) / 20);
  values[0] += shift;
  return values;
}

function frame(ear, yaw, shift = 0) {
  return { ear, yaw, descriptor: descriptor(shift) };
}

test('kedipan dan gelengan diterima, foto diam ditolak', () => {
  const blink = assessLiveness([frame(0.33, 0), frame(0.14, 0.01), frame(0.32, 0)]);
  assert.equal(blink.ok, true);
  assert.equal(blink.method, 'kedip');

  const turn = assessLiveness([frame(0.3, -0.2), frame(0.3, 0), frame(0.29, 0.12)]);
  assert.equal(turn.ok, true);
  assert.equal(turn.method, 'geleng');

  assert.equal(assessLiveness([frame(0.3, 0), frame(0.3, 0.01), frame(0.3, 0)]).ok, false);
  assert.equal(assessLiveness([frame(0.33, 0), frame(0.14, 0), frame(0.32, 0, 2)]).ok, false);
  assert.equal(assessLiveness([frame(0.33, 0), frame(0.14, 0)]).ok, false);
});

test('pendaftaran wajah butuh tiga sudut dari orang yang sama', () => {
  const ok = assessEnrollment([frame(0.3, -0.2), frame(0.31, 0), frame(0.29, 0.16)]);
  assert.equal(ok.ok, true);
  assert.equal(assessEnrollment([frame(0.3, 0), frame(0.3, 0.02), frame(0.3, 0.04)]).error, 'need_pose_variety');
  assert.equal(assessEnrollment([frame(0.3, -0.2), frame(0.3, 0, 3), frame(0.3, 0.2)]).error, 'different_person');
  assert.equal(assessEnrollment([frame(0.3, 0)]).error, 'need_three_faces');
  assert.ok(bestFaceDistance(descriptor(), [descriptor(0.02), descriptor(1)]) < 0.05);
  assert.equal(euclidean([1, 0], [0, 0]), 1);
});

test('pengenalan wajah memilih karyawan terdekat', () => {
  const people = [
    { id: 1, descriptors: [descriptor(0)] },
    { id: 2, descriptors: [descriptor(1.2)] }
  ];
  const match = identifyFace(descriptor(0.02), people, 0.5);
  assert.equal(match.ok, true);
  assert.equal(match.id, 1);
  assert.equal(identifyFace(descriptor(2), people, 0.5).error, 'face_unknown');
  const twins = [
    { id: 3, descriptors: [descriptor(0)] },
    { id: 4, descriptors: [descriptor(0.03)] }
  ];
  assert.equal(identifyFace(descriptor(0.01), twins, 0.5).error, 'ambiguous_face');
});
