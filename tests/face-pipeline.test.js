import assert from 'node:assert/strict';
import test from 'node:test';
import { faceRuntime, loadFaceModels } from '../src/face.js';
import { makeJpeg } from './jpeg.js';

test('server menolak gambar tanpa wajah', { timeout: 60000 }, async () => {
  await loadFaceModels();
  const result = await faceRuntime.detect(makeJpeg(40));
  assert.equal(result.error, 'no_face');
});
