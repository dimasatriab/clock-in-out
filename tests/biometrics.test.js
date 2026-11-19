import assert from 'node:assert/strict';
import test from 'node:test';
import { assessEnrollment, assessLiveness, bestFaceDistance, euclidean, identifyFace } from '../src/biometrics.js';

function descriptor(shift = 0) {
  const values = Array.from({ length: 128 }, (_, index) => ((index % 5) - 2) / 20);
  values[0] += shift;
  return values;
}

function frame(ear, yaw, shift = 0, pitch = 0, pose = '') {
  return { ear, yaw, pitch, pose, score: 0.9, descriptor: descriptor(shift) };
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

test('pendaftaran wajah butuh lima sudut dari orang yang sama', () => {
  const ok = assessEnrollment([
    frame(0.3, 0, 0, 0, 'lurus'),
    frame(0.3, -0.2, 0, 0, 'kiri'),
    frame(0.3, 0.2, 0, 0, 'kanan'),
    frame(0.3, 0, 0, -0.12, 'atas'),
    frame(0.3, 0, 0, 0.12, 'bawah')
  ]);
  assert.equal(ok.ok, true);
  assert.equal(assessEnrollment([frame(0.3, 0, 0, 0, 'lurus')]).error, 'need_pose_set');
  assert.equal(assessEnrollment([
    frame(0.3, 0.4, 0, 0, 'lurus'),
    frame(0.3, -0.2, 0, 0, 'kiri'),
    frame(0.3, 0.2, 0, 0, 'kanan'),
    frame(0.3, 0, 0, -0.12, 'atas'),
    frame(0.3, 0, 0, 0.12, 'bawah')
  ]).error, 'pose_mismatch');
  assert.equal(assessEnrollment([
    frame(0.3, 0, 3, 0, 'lurus'),
    frame(0.3, -0.2, 0, 0, 'kiri'),
    frame(0.3, 0.2, 0, 0, 'kanan'),
    frame(0.3, 0, 0, -0.12, 'atas'),
    frame(0.3, 0, 0, 0.12, 'bawah')
  ]).error, 'different_person');
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
