export function normalizePhone(input) {
  let phone = String(input || '').trim().replace(/[\s.-]/g, '');
  if (phone.startsWith('+62')) phone = `0${phone.slice(3)}`;
  else if (phone.startsWith('62') && phone.length >= 11) phone = `0${phone.slice(2)}`;
  return phone;
}

export function isValidPhone(phone) {
  return /^08\d{8,12}$/.test(phone);
}

export function isValidPin(pin) {
  return /^\d{4,6}$/.test(String(pin || ''));
}
