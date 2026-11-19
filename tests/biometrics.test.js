import assert from 'node:assert/strict';
import test from 'node:test';
import { assessEnrollment, bestFaceDistance, euclidean, identifyFace } from '../src/biometrics.js';

function descriptor(shift = 0) {
  const values = Array.from({ length: 128 }, (_, index) => ((index % 5) - 2) / 20);
  values[0] += shift;
  return values;
}

function frame(ear, yaw, shift = 0, pitch = 0) {
  return { ear, yaw, pitch, score: 0.9, descriptor: descriptor(shift) };
}

test('pendaftaran wajah menerima foto depan dan menolak wajah menoleh', () => {
  const satu = assessEnrollment([frame(0.3, 0)]);
  assert.equal(satu.ok, true);
  assert.equal(satu.descriptor.length, 128);
  const tiga = assessEnrollment([frame(0.3, 0.05), frame(0.3, -0.04, 0, 0.02), frame(0.3, 0.02)]);
  assert.equal(tiga.ok, true);
  assert.ok(euclidean(tiga.descriptor, descriptor()) < 1e-9);
  assert.equal(assessEnrollment([]).error, 'need_face');
  assert.equal(assessEnrollment([frame(0.3, 0.5)]).error, 'not_frontal');
  assert.equal(assessEnrollment([frame(0.3, 0, 0), frame(0.3, 0, 2)]).error, 'different_person');
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
