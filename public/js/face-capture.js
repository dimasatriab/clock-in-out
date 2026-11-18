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

export async function openCamera(video) {
  const attempts = [
    { video: { facingMode: { ideal: 'user' }, width: { ideal: 720 }, height: { ideal: 960 } }, audio: false },
    { video: { facingMode: 'user' }, audio: false },
    { video: true, audio: false }
  ];
  let lastError;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();
      if (!video.videoWidth) {
        await new Promise((resolve) => {
          video.onloadedmetadata = () => resolve();
        });
      }
      return stream;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Kamera tidak bisa dibuka.');
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
  return { ear, yaw: (tip.x - (leftCenter.x + rightCenter.x) / 2) / eyeDistance };
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

export function watchLiveness(video, { onStatus, signal }) {
  const faceapi = window.faceapi;
  const options = new faceapi.TinyFaceDetectorOptions(OPTIONS);
  const samples = [];
  let stopped = false;
  let busy = false;
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
      if (!busy) {
        busy = true;
        try {
          const detection = await faceapi.detectSingleFace(video, options).withFaceLandmarks();
          if (stopped) return;
          if (!detection) onStatus('Wajah belum terlihat. Hadap kamera di tempat terang.');
          else {
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
            onStatus('Wajah terlihat. Kedipkan mata sekali, atau gelengkan kepala pelan.');
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

export async function capturePose(video) {
  const faceapi = window.faceapi;
  const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions(OPTIONS)).withFaceLandmarks();
  if (!detection) return null;
  const blob = await snapshot(video);
  if (!blob) return null;
  return { blob, ...metrics(detection.landmarks) };
}
