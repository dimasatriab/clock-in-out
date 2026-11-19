import { isValidPhone, isValidPin, normalizePhone } from './phone.js';

export function assertBootConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const demoRequested = env.DEMO === '1';
  const adminPhone = normalizePhone(env.ADMIN_PHONE || '');
  const adminPin = String(env.ADMIN_PIN || '').trim();
  if (nodeEnv === 'production') {
    if (demoRequested) {
      throw new Error('DEMO=1 tidak boleh dipakai di production.');
    }
    if (!isValidPhone(adminPhone) || !isValidPin(adminPin)) {
      throw new Error('ADMIN_PHONE dan ADMIN_PIN wajib di production. PIN admin 4 sampai 6 angka.');
    }
  }
  return {
    nodeEnv,
    demo: demoRequested && nodeEnv !== 'production',
    adminPhone: isValidPhone(adminPhone) ? adminPhone : '',
    adminPin: isValidPin(adminPin) ? adminPin : '',
    demoPin: String(env.DEMO_PIN || '')
  };
}
