export const BUSINESSES = [
  { id: 'toko', name: 'Toko DBLESS MYRA' },
  { id: 'hostbydims', name: 'Unit hostbydims' },
  { id: 'rumah', name: 'Rumah' }
];

export const DEMO_LOCATIONS = [
  {
    name: 'Toko DBLESS MYRA (contoh)',
    businessId: 'toko',
    latitude: -6.175392,
    longitude: 106.827153,
    radiusMeters: 150
  },
  {
    name: 'Unit hostbydims (contoh)',
    businessId: 'hostbydims',
    latitude: -6.229728,
    longitude: 106.825264,
    radiusMeters: 120
  },
  {
    name: 'Rumah (contoh)',
    businessId: 'rumah',
    latitude: -6.125,
    longitude: 106.85,
    radiusMeters: 80
  }
];

export const DEMO_EMPLOYEES = [
  {
    name: 'Nisa Putri',
    phone: '081210000001',
    businessId: 'toko',
    shiftStart: '09:00',
    graceMinutes: 10,
    locationName: DEMO_LOCATIONS[0].name
  },
  {
    name: 'Andi Wijaya',
    phone: '081210000002',
    businessId: 'hostbydims',
    shiftStart: '08:00',
    graceMinutes: 15,
    locationName: DEMO_LOCATIONS[1].name
  },
  {
    name: 'Sri Rahayu',
    phone: '081210000003',
    businessId: 'rumah',
    shiftStart: '07:00',
    graceMinutes: 10,
    locationName: DEMO_LOCATIONS[2].name
  }
];
