import http from 'node:http';

export function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

export function request(server, { method = 'GET', path, json, form, cookie }) {
  const body = form?.body || (json ? Buffer.from(JSON.stringify(json)) : null);
  const headers = { 'X-Hadir': '1' };
  if (cookie) headers.Cookie = cookie;
  if (json) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = body.length;
  }
  if (form) {
    headers['Content-Type'] = form.contentType;
    headers['Content-Length'] = form.body.length;
  }
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      method,
      path,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const type = String(res.headers['content-type'] || '');
        let data = null;
        if (type.includes('json')) data = JSON.parse(buf.toString('utf8'));
        const setCookie = res.headers['set-cookie'] || [];
        resolve({ status: res.statusCode, data, buf, type, setCookie });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

export function cookiePair(setCookie, name) {
  const raw = setCookie.find((item) => item.startsWith(`${name}=`));
  if (!raw) return '';
  return raw.split(';')[0];
}

export function multipart(fields, files) {
  const boundary = '----hadirboundary';
  const chunks = [];
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  for (const file of files) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: image/jpeg\r\n\r\n`
    ));
    chunks.push(file.buffer);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}
