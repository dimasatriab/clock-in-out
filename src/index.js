import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { getConfig } from './config.js';
import { loadEnv } from './env.js';
import { faceRuntime, loadFaceModels } from './face.js';
import { sweepAutoClockOut } from './repo.js';
import { prepareAssets } from '../scripts/prepare-assets.js';

loadEnv(path.resolve('.env'));

let app;
try {
  app = await createApp();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const config = getConfig();

try {
  await prepareAssets();
  await loadFaceModels();
  console.log('Model wajah siap.');
} catch (error) {
  console.error(`Model wajah belum siap: ${error.message}`);
}

const server = app.listen(config.port, config.host, () => {
  console.log(`Hadir berjalan di http://${config.host}:${config.port}`);
  console.log('Zona waktu pencatatan: Asia/Jakarta (WIB)');
  console.log(`Pemeriksa wajah: ${faceRuntime.ready ? 'siap' : 'belum siap'}`);
});

const sweepTimer = setInterval(() => {
  try {
    const closed = sweepAutoClockOut(app.locals.db, config);
    if (closed) console.log(`Pulang otomatis: ${closed} sesi.`);
  } catch (error) {
    console.error(error);
  }
}, 60 * 1000);
sweepTimer.unref();

function shutdown() {
  clearInterval(sweepTimer);
  server.close(() => {
    try { app.locals.db.close(); } catch { /* sudah tertutup */ }
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  // berkas ini adalah titik masuk
}
