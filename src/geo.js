const EARTH_RADIUS_M = 6371000;

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function matchGeofence(point, locations, { maxAccuracyMeters }) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  const accuracy = Number(point?.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, error: 'gps_invalid' };
  }
  if (!Number.isFinite(accuracy) || accuracy < 0) {
    return { ok: false, error: 'gps_invalid' };
  }
  if (accuracy > maxAccuracyMeters) {
    return { ok: false, error: 'gps_inaccurate', accuracy };
  }
  if (!locations?.length) return { ok: false, error: 'no_location' };

  let best = null;
  for (const location of locations) {
    const distanceMeters = haversineMeters(lat, lng, location.latitude, location.longitude);
    const inside = distanceMeters <= Number(location.radiusMeters) + 1e-6;
    if (!inside) continue;
    const closer = !best
      || distanceMeters < best.distanceMeters - 1e-6
      || (Math.abs(distanceMeters - best.distanceMeters) <= 1e-6 && location.id < best.location.id);
    if (closer) best = { location, distanceMeters };
  }
  if (!best) return { ok: false, error: 'outside_geofence' };
  return {
    ok: true,
    locationId: best.location.id,
    locationName: best.location.name,
    businessId: best.location.businessId,
    distanceMeters: Math.round(best.distanceMeters * 10) / 10,
    accuracy
  };
}
