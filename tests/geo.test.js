import assert from 'node:assert/strict';
import test from 'node:test';
import { haversineMeters, matchGeofence } from '../src/geo.js';

const maxAccuracyMeters = 100;

test('jarak haversine satu derajat lintang', () => {
  const distance = haversineMeters(0, 0, 1, 0);
  assert.ok(Math.abs(distance - 111194.926) < 1);
  assert.equal(haversineMeters(-6.2, 106.8, -6.2, 106.8), 0);
});

test('titik di dalam, di luar, dan di batas radius', () => {
  const location = { id: 1, latitude: 0, longitude: 0, radiusMeters: 112, name: 'Pusat' };
  const inside = matchGeofence({ lat: 0, lng: 0.001, accuracy: 10 }, [location], { maxAccuracyMeters });
  assert.equal(inside.ok, true);
  assert.ok(inside.distanceMeters > 110 && inside.distanceMeters < 112);

  const edge = matchGeofence({ lat: 0, lng: 0, accuracy: 100 }, [{ ...location, radiusMeters: 0 }], { maxAccuracyMeters });
  assert.equal(edge.ok, true);

  const outside = matchGeofence({ lat: 0, lng: 0.001, accuracy: 10 }, [{ ...location, radiusMeters: 100 }], { maxAccuracyMeters });
  assert.equal(outside.error, 'outside_geofence');
});

test('akurasi GPS yang lemah ditolak, batas atas masih diterima', () => {
  const location = { id: 1, latitude: -6.2, longitude: 106.8, radiusMeters: 50, name: 'Toko' };
  const point = { lat: -6.2, lng: 106.8 };
  assert.equal(matchGeofence({ ...point, accuracy: 100 }, [location], { maxAccuracyMeters }).ok, true);
  const weak = matchGeofence({ ...point, accuracy: 100.01 }, [location], { maxAccuracyMeters });
  assert.equal(weak.error, 'gps_inaccurate');
  assert.equal(matchGeofence({ ...point, accuracy: -1 }, [location], { maxAccuracyMeters }).error, 'gps_invalid');
  assert.equal(matchGeofence({ lat: 91, lng: 0, accuracy: 5 }, [location], { maxAccuracyMeters }).error, 'gps_invalid');
  assert.equal(matchGeofence({ ...point }, [location], { maxAccuracyMeters }).error, 'gps_invalid');
});

test('memilih lokasi terdekat bila dua pagar mencakup titik yang sama', () => {
  const locations = [
    { id: 2, latitude: 0, longitude: 0, radiusMeters: 500, name: 'Jauh' },
    { id: 1, latitude: 0, longitude: 0.002, radiusMeters: 500, name: 'Dekat' }
  ];
  const match = matchGeofence({ lat: 0, lng: 0.0015, accuracy: 8 }, locations, { maxAccuracyMeters });
  assert.equal(match.ok, true);
  assert.equal(match.locationId, 1);
  assert.equal(match.locationName, 'Dekat');
});

test('karyawan tanpa lokasi tidak bisa absen', () => {
  const match = matchGeofence({ lat: -6.2, lng: 106.8, accuracy: 5 }, [], { maxAccuracyMeters });
  assert.equal(match.error, 'no_location');
});

test('Everywhere melewati pagar tetapi menolak GPS yang tidak layak', () => {
  const open = matchGeofence(
    { lat: -6.9, lng: 107.6, accuracy: 12 },
    [],
    { maxAccuracyMeters, everywhere: { id: 9, businessId: 'toko' } }
  );
  assert.equal(open.ok, true);
  assert.equal(open.everywhere, true);
  assert.equal(open.locationName, 'Everywhere');
  assert.equal(open.locationId, 9);
  const weakOpen = matchGeofence(
    { lat: -6.9, lng: 107.6, accuracy: 180 },
    [],
    { maxAccuracyMeters, everywhere: { id: 9, businessId: 'toko' } }
  );
  assert.equal(weakOpen.error, 'gps_inaccurate');
});
