const WEAK_PASSWORDS = new Set([
  'admin',
  'password',
  'changeme',
  'secret',
  'demo',
  'demo-admin-123',
  '123456',
  '12345678',
  'hadir',
  'dblessmyra'
]);

export function assertBootConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const demoRequested = env.DEMO === '1';
  const password = String(env.ADMIN_PASSWORD || '');
  if (nodeEnv === 'production') {
    if (demoRequested) {
      throw new Error('DEMO=1 tidak boleh dipakai di production.');
    }
    if (password.length < 8 || WEAK_PASSWORDS.has(password)) {
      throw new Error('ADMIN_PASSWORD wajib di production, minimal 8 karakter, dan bukan sandi bawaan.');
    }
  }
  return {
    nodeEnv,
    demo: demoRequested && nodeEnv !== 'production',
    adminUser: String(env.ADMIN_USER || 'admin').trim() || 'admin',
    adminPassword: password,
    demoPin: String(env.DEMO_PIN || '')
  };
}

export function isWeakPassword(password) {
  return WEAK_PASSWORDS.has(String(password || ''));
}
