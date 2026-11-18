import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidPhone, isValidPin, normalizePhone } from '../src/phone.js';
import { csvCell, toCsv } from '../src/csv.js';

test('nomor HP Indonesia dinormalisasi', () => {
  assert.equal(normalizePhone('+62 812-1000-0001'), '081210000001');
  assert.equal(normalizePhone('6281210000001'), '081210000001');
  assert.equal(isValidPhone('081210000001'), true);
  assert.equal(isValidPhone('021555123'), false);
  assert.equal(isValidPin('1234'), true);
  assert.equal(isValidPin('12'), false);
  assert.equal(isValidPin('12345a'), false);
});

test('CSV aman untuk Excel berbahasa Indonesia', () => {
  assert.equal(csvCell('=cmd'), "'=cmd");
  assert.equal(csvCell('Toko; Pusat'), '"Toko; Pusat"');
  const csv = toCsv(['Nama', 'Catatan'], [['Nisa', 'masuk']]);
  assert.ok(csv.charCodeAt(0) === 0xfeff);
  assert.ok(csv.includes('Nama;Catatan'));
});
