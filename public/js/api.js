export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = { 'X-Hadir': '1' };
  const options = { method, headers, credentials: 'same-origin' };
  if (form) options.body = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.pesan || 'Permintaan gagal.');
    error.code = data.error;
    error.status = response.status;
    throw error;
  }
  return data;
}
