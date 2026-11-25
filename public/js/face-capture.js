const OPTIONS = { inputSize: 320, scoreThreshold: 0.3 };
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

export function snapshot(video) {
  if (!video.videoWidth) return Promise.resolve(null);
  const canvas = document.createElement('canvas');
  const side = Math.min(video.videoWidth, video.videoHeight);
  canvas.width = 640;
  canvas.height = 640;
  canvas.getContext('2d').drawImage(
    video,
    (video.videoWidth - side) / 2,
    (video.videoHeight - side) / 2,
    side,
    side,
    0,
    0,
    480,
    480
  );
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
          selesai(face.box);
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
  let stopped = false;
  let busy = false;
  const stop = () => { stopped = true; };
  const loop = async () => {
    if (stopped) return;
    if (!busy && video.readyState >= 2 && window.faceapi) {
      busy = true;
      try {
        const detection = await window.faceapi.detectSingleFace(video, options);
        if (stopped) return;
        if (!detection) onFrame?.(null);
        else {
          const box = detection.box;
          onFrame?.({
            score: detection.score,
            box: { x: box.x, y: box.y, width: box.width, height: box.height }
          });
        }
      } catch {
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
