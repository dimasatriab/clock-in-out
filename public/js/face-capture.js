const OPTIONS = { inputSize: 320, scoreThreshold: 0.45 };
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

function eyeAspect(eye) {
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return (distance(eye[1], eye[5]) + distance(eye[2], eye[4])) / (2 * Math.max(distance(eye[0], eye[3]), 1e-6));
}

function metrics(landmarks) {
  const left = landmarks.getLeftEye();
  const right = landmarks.getRightEye();
  const ear = (eyeAspect(left) + eyeAspect(right)) / 2;
  const center = (points) => ({
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  });
  const leftCenter = center(left);
  const rightCenter = center(right);
  const nose = landmarks.getNose();
  const tip = nose[6] || nose[nose.length - 1];
  const eyeDistance = Math.max(Math.hypot(rightCenter.x - leftCenter.x, rightCenter.y - leftCenter.y), 1e-6);
  const yaw = (tip.x - (leftCenter.x + rightCenter.x) / 2) / eyeDistance;
  const pitch = ((tip.y - (leftCenter.y + rightCenter.y) / 2) / eyeDistance) - 0.55;
  return { ear, yaw, pitch };
}

export function snapshot(video) {
  if (!video.videoWidth) return Promise.resolve(null);
  const canvas = document.createElement('canvas');
  const side = Math.min(video.videoWidth, video.videoHeight);
  canvas.width = 480;
  canvas.height = 480;
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
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82));
}

function pickLiveness(samples) {
  if (samples.length < 5) return null;
  if (samples.at(-1).t - samples[0].t < 700) return null;
  for (let i = 1; i < samples.length - 1; i += 1) {
    const mid = samples[i];
    if (mid.ear > 0.2) continue;
    let before = null;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (samples[j].ear >= 0.27) { before = samples[j]; break; }
    }
    let after = null;
    for (let j = i + 1; j < samples.length; j += 1) {
      if (samples[j].ear >= 0.27) { after = samples[j]; break; }
    }
    if (before && after && after.t - before.t >= 200 && after.t - before.t <= 2500 && before.ear - mid.ear >= 0.07 && after.ear - mid.ear >= 0.07) {
      return { method: 'kedip', frames: [before, mid, after] };
    }
  }
  let min = samples[0];
  let max = samples[0];
  for (const sample of samples) {
    if (sample.yaw < min.yaw) min = sample;
    if (sample.yaw > max.yaw) max = sample;
  }
  if (max.yaw - min.yaw >= 0.22 && max.t !== min.t) {
    const mid = samples[Math.floor(samples.length / 2)];
    const frames = [min, mid, max].sort((a, b) => a.t - b.t);
    if (new Set(frames.map((frame) => frame.t)).size === 3) return { method: 'geleng', frames };
  }
  return null;
}

export function watchLiveness(video, { onStatus, onBox, signal, frameSkip = 1 }) {
  const faceapi = window.faceapi;
  const options = new faceapi.TinyFaceDetectorOptions(OPTIONS);
    const samples = [];
    let stopped = false;
    let busy = false;
    let ticks = 0;
    const skip = Math.max(1, Number(frameSkip) || 1);
  return new Promise((resolve, reject) => {
    const batalkan = () => {
      if (stopped) return;
      stopped = true;
      const error = new Error('Dibatalkan');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal?.aborted) {
      batalkan();
      return;
    }
    signal?.addEventListener('abort', batalkan);
    const loop = async () => {
      if (stopped) return;
      ticks += 1;
      if (ticks % skip !== 0) {
        requestAnimationFrame(loop);
        return;
      }
      if (!busy) {
        busy = true;
        try {
          const detection = await faceapi.detectSingleFace(video, options).withFaceLandmarks();
          if (stopped) return;
          if (!detection) {
            onBox?.(null);
            onStatus?.('Ready', 'ready');
          } else {
            const box = detection.detection.box;
            onBox?.({ x: box.x, y: box.y, width: box.width, height: box.height });
            onStatus?.('Wajah terlihat. Kedipkan mata sekali, atau gelengkan kepala pelan.', 'scanning');
            const reading = metrics(detection.landmarks);
            const blob = await snapshot(video);
            if (blob) {
              samples.push({ t: performance.now(), ...reading, blob });
              const start = samples.at(-1).t - 4500;
              while (samples.length && samples[0].t < start) samples.shift();
              const found = pickLiveness(samples);
              if (found) {
                stopped = true;
                resolve(found);
                return;
              }
            }
          }
        } catch (error) {
          stopped = true;
          reject(error);
          return;
        } finally {
          busy = false;
        }
      }
      if (!stopped) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

export function waitUntilNoFace(video, { signal, holdMs = 800 } = {}) {
  const faceapi = window.faceapi;
  if (!faceapi?.nets?.tinyFaceDetector?.isLoaded) return Promise.resolve();
  const options = new faceapi.TinyFaceDetectorOptions(OPTIONS);
  let stopped = false;
  let busy = false;
  let clearSince = 0;
  return new Promise((resolve, reject) => {
    const selesai = () => {
      if (stopped) return;
      stopped = true;
      signal?.removeEventListener('abort', batalkan);
      resolve();
    };
    const batalkan = () => {
      if (stopped) return;
      stopped = true;
      signal?.removeEventListener('abort', batalkan);
      const error = new Error('Dibatalkan');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal?.aborted) {
      batalkan();
      return;
    }
    signal?.addEventListener('abort', batalkan);
    const loop = async () => {
      if (stopped) return;
      if (!busy) {
        busy = true;
        try {
          const detection = await faceapi.detectSingleFace(video, options);
          if (stopped) return;
          if (detection) clearSince = 0;
          else {
            const now = performance.now();
            if (!clearSince) clearSince = now;
            if (now - clearSince >= holdMs) {
              selesai();
              return;
            }
          }
        } catch (error) {
          if (stopped) return;
          stopped = true;
          signal?.removeEventListener('abort', batalkan);
          reject(error);
          return;
        } finally {
          busy = false;
        }
      }
      if (!stopped) setTimeout(loop, 140);
    };
    loop();
  });
}

export function imageSharpness(source) {
  const width = 240;
  const height = Math.max(1, Math.round((source.videoHeight || source.height) * width / Math.max(source.videoWidth || source.width, 1)));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  const gray = (x, y) => {
    const index = (y * width + x) * 4;
    return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
  };
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const center = gray(x, y);
      const lap = gray(x, y - 1) + gray(x, y + 1) + gray(x - 1, y) + gray(x + 1, y) - 4 * center;
      sum += lap;
      sumSq += lap * lap;
      count += 1;
    }
  }
  if (count < 8) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

export function watchPose(video, { signal, onFrame } = {}) {
  const faceapi = window.faceapi;
  const options = new faceapi.TinyFaceDetectorOptions(OPTIONS);
  let stopped = false;
  let busy = false;
  const stop = () => { stopped = true; };
  const loop = async () => {
    if (stopped) return;
    if (!busy && video.readyState >= 2) {
      busy = true;
      try {
        const detection = await faceapi.detectSingleFace(video, options).withFaceLandmarks();
        if (stopped) return;
        if (!detection) {
          onFrame?.(null);
        } else {
          const box = detection.detection.box;
          onFrame?.({
            score: detection.detection.score,
            sharpness: imageSharpness(video),
            box: { width: box.width, height: box.height },
            ...metrics(detection.landmarks)
          });
        }
      } catch {
        if (!stopped) onFrame?.(null);
      } finally {
        busy = false;
      }
    }
    if (!stopped) setTimeout(loop, 140);
  };
  const onAbort = () => stop();
  signal?.addEventListener('abort', onAbort);
  loop();
  return () => {
    stop();
    signal?.removeEventListener('abort', onAbort);
  };
}

export async function capturePose(video) {
  const faceapi = window.faceapi;
  const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions(OPTIONS)).withFaceLandmarks();
  if (!detection) return null;
  const blob = await snapshot(video);
  if (!blob) return null;
  const box = detection.detection.box;
  return {
    blob,
    score: detection.detection.score,
    sharpness: imageSharpness(video),
    box: { width: box.width, height: box.height },
    ...metrics(detection.landmarks)
  };
}
