import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { getConfig } from './config.js';
import { loadEnv } from './env.js';
import { faceRuntime, loadFaceModels } from './face.js';
import { prepareAssets } from '../scripts/prepare-assets.js';

loadEnv(path.resolve('.env'));

const app = await createApp();
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

function shutdown() {
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
