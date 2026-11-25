const OPTIONS = { inputSize: 224, scoreThreshold: 0.5 };
const DETECT_WIDTH = 240;
const MIN_SCORE = 0.55;
const MIN_BOX = 0.18;
const MIN_STREAK = 2;
let scriptPromise;
let modelPromise;

function loadScript() {
  if (window.faceapi) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/face-api.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Pemeriksa wajah gagal dimuat.'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function ensureModels(onStatus) {
  if (window.faceapi?.nets?.tinyFaceDetector?.isLoaded) return Promise.resolve();
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    onStatus?.('Memuat pemeriksa wajah. Pertama kali bisa agak lama.');
    await loadScript();
    const faceapi = window.faceapi;
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('/models')
    ]);
    const hangat = document.createElement('canvas');
    hangat.width = 160;
    hangat.height = 160;
    try {
      await faceapi.detectSingleFace(hangat, new faceapi.TinyFaceDetectorOptions(OPTIONS));
    } catch { /* pemanasan; gagal tidak boleh menutup kamera */ }
  })();
  return modelPromise;
}

function isFrontLabel(label) {
  return /front|user|depan|facetime|selfie|inner/i.test(label || '');
}

function isBackLabel(label) {
  return /back|rear|environment|belakang|outer/i.test(label || '');
}

async function attachStream(video, stream) {
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  if (!video.videoWidth) {
    await new Promise((resolve) => {
      video.onloadedmetadata = () => resolve();
    });
  }
  return stream;
}

export async function openCamera(video) {
  const attempts = [
    { video: { facingMode: { exact: 'user' }, width: { ideal: 720 }, height: { ideal: 960 } }, audio: false },
    { video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } }, audio: false }
  ];
  let lastError;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const facing = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
      if (facing === 'environment') {
        stopStream(stream);
        continue;
      }
      return attachStream(video, stream);
    } catch (error) {
      lastError = error;
    }
  }

  try {
    const seed = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    stopStream(seed);
  } catch (error) {
    lastError = error;
  }
  const cameras = (await navigator.mediaDevices.enumerateDevices().catch(() => []))
    .filter((device) => device.kind === 'videoinput');
  const front = cameras.find((device) => isFrontLabel(device.label))
    || cameras.find((device) => device.label && !isBackLabel(device.label));
  if (front?.deviceId) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: front.deviceId }, width: { ideal: 720 }, height: { ideal: 960 } },
        audio: false
      });
      const facing = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
      if (facing === 'environment') {
        stopStream(stream);
      } else {
        return attachStream(video, stream);
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Kamera depan tidak bisa dibuka. Izinkan kamera depan di ponsel.');
}

export function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function visibleFaceCrop(videoWidth, videoHeight, viewWidth, viewHeight) {
  const vw = Number(videoWidth);
  const vh = Number(videoHeight);
  if (!(vw > 0) || !(vh > 0)) return null;
  const ew = Number(viewWidth);
  const eh = Number(viewHeight);
  let x;
  let y;
  let width;
  let height;
  if (ew >= 2 && eh >= 2) {
    const scale = Math.max(ew / vw, eh / vh);
    width = ew / scale;
    height = eh / scale;
    x = (vw - width) / 2;
    y = (vh - height) / 2;
  } else {
    const side = Math.min(vw, vh);
    x = (vw - side) / 2;
    y = (vh - side) / 2;
    width = side;
    height = side;
  }
  x = Math.max(0, x);
  y = Math.max(0, y);
  width = Math.min(width, vw - x);
  height = Math.min(height, vh - y);
  if (width < 1 || height < 1) return null;
  return { x, y, width, height };
}

function jpegSize(width, height) {
  const scale = 640 / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

export function snapshot(video) {
  if (!video.videoWidth || !video.videoHeight) return Promise.resolve(null);
  const box = video.getBoundingClientRect?.() || { width: 0, height: 0 };
  const crop = visibleFaceCrop(video.videoWidth, video.videoHeight, box.width, box.height);
  if (!crop) return Promise.resolve(null);
  const size = jpegSize(crop.width, crop.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  // Pratinjau di-mirror lewat CSS. JPEG memakai piksel mentah supaya foto tersimpan tidak terbalik dua kali.
  ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.72));
}

function detectorOptions() {
  return new window.faceapi.TinyFaceDetectorOptions(OPTIONS);
}

export function watchFace(video, { signal, onBox, onStatus } = {}) {
  const mulai = performance.now();
  return new Promise((resolve, reject) => {
    let stopped = false;
    let stop = () => {};
    const gagal = (error) => {
      if (stopped) return;
      stopped = true;
      stop();
      reject(error);
    };
    const selesai = async (box) => {
      if (stopped) return;
      stopped = true;
      stop();
      const terlihat = performance.now();
      onStatus?.('Wajah terlihat', 'scanning');
      const blob = await snapshot(video);
      if (!blob) {
        stopped = false;
        mulaiLoop();
        return;
      }
      resolve({
        frames: [{ blob }],
        elapsedMs: Math.round(performance.now() - terlihat),
        sejakMulaiMs: Math.round(performance.now() - mulai)
      });
    };
    const mulaiLoop = () => {
      stop = watchDetection(video, {
        signal,
        onFrame(face) {
          if (stopped) return;
          if (!face) {
            onBox?.(null);
            onStatus?.('Ready', 'ready');
            return;
          }
          onBox?.(face.box);
          if (face.stable) selesai(face.box);
          else onStatus?.('Wajah terlihat', 'scanning');
        }
      });
    };
    if (signal?.aborted) {
      gagal(Object.assign(new Error('Dibatalkan'), { name: 'AbortError' }));
      return;
    }
    signal?.addEventListener('abort', () => {
      gagal(Object.assign(new Error('Dibatalkan'), { name: 'AbortError' }));
    }, { once: true });
    mulaiLoop();
  });
}

function watchDetection(video, { signal, onFrame } = {}) {
  const options = detectorOptions();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  let busy = false;
  let streak = 0;
  const stop = () => { stopped = true; };
  const loop = async () => {
    if (stopped) return;
    if (!busy && video.readyState >= 2 && video.videoWidth && window.faceapi) {
      busy = true;
      try {
        const height = Math.max(1, Math.round(video.videoHeight * (DETECT_WIDTH / video.videoWidth)));
        if (canvas.width !== DETECT_WIDTH || canvas.height !== height) {
          canvas.width = DETECT_WIDTH;
          canvas.height = height;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const detection = await window.faceapi.detectSingleFace(canvas, options);
        if (stopped) return;
        const box = detection?.box;
        const besar = box && box.width / canvas.width >= MIN_BOX;
        if (!detection || detection.score < MIN_SCORE || !besar) {
          streak = 0;
          onFrame?.(null);
        } else {
          streak += 1;
          const scale = video.videoWidth / canvas.width;
          onFrame?.({
            score: detection.score,
            stable: streak >= MIN_STREAK,
            box: {
              x: box.x * scale,
              y: box.y * scale,
              width: box.width * scale,
              height: box.height * scale
            }
          });
        }
      } catch {
        streak = 0;
        if (!stopped) onFrame?.(null);
      } finally {
        busy = false;
      }
    }
    if (!stopped) requestAnimationFrame(loop);
  };
  const onAbort = () => stop();
  signal?.addEventListener('abort', onAbort);
  loop();
  return () => {
    stop();
    signal?.removeEventListener('abort', onAbort);
  };
}
