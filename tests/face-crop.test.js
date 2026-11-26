import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleFaceCrop } from '../public/js/face-capture.js';

test('crop wajah mengikuti bingkai yang terlihat, tanpa mirror', () => {
  const square = visibleFaceCrop(1280, 720, 260, 260);
  assert.ok(Math.abs(square.width - 720) < 0.5);
  assert.ok(Math.abs(square.height - 720) < 0.5);
  assert.ok(Math.abs(square.x - 280) < 0.5);
  assert.equal(square.y, 0);

  const phone = visibleFaceCrop(720, 960, 390, 844);
  assert.equal(phone.y, 0);
  assert.ok(Math.abs(phone.height - 960) < 0.5);
  assert.ok(phone.width < 720);
  assert.ok(phone.x > 0);
  assert.ok(phone.x + phone.width <= 720);

  const fallback = visibleFaceCrop(720, 960, 0, 0);
  assert.equal(fallback.x, 0);
  assert.equal(fallback.width, 720);
  assert.equal(fallback.height, 720);
  assert.equal(visibleFaceCrop(0, 960, 390, 844), null);
});
