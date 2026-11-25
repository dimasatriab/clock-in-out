import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);

let faceapi;
let Canvas;
let detectQueue = Promise.resolve();

export const faceRuntime = {
  ready: false,
  async detect(buffer) {
    if (!faceRuntime.ready) {
      const error = new Error('models_not_ready');
      error.code = 'models_not_ready';
      throw error;
    }
    return enqueue(() => detectLoaded(buffer));
  }
};

function enqueue(fn) {
  const run = detectQueue.then(fn, fn);
  detectQueue = run.then(() => {}, () => {});
  return run;
}

export function modelDir() {
  return path.join(path.dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
}

export async function loadFaceModels() {
  if (!globalThis.window) globalThis.window = { document: { createElement() { return {}; } } };
  if (!globalThis.document) globalThis.document = globalThis.window.document;
  const canvas = await import('@napi-rs/canvas');
  Canvas = canvas.Canvas;
  faceapi = await import('@vladmandic/face-api/dist/face-api.esm.js');
  await faceapi.tf.setBackend('cpu');
  await faceapi.tf.ready();
  faceapi.env.monkeyPatch({
    Canvas: canvas.Canvas,
    Image: canvas.Image,
    ImageData: canvas.ImageData,
    createCanvasElement: () => new canvas.Canvas(1, 1),
    createImageElement: () => new canvas.Image(),
    readFile: async (file) => {
      const buf = await readFile(file);
      const exact = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      return { buffer: exact, toString: () => buf.toString('utf8') };
    }
  });
  const dir = modelDir();
  await faceapi.nets.tinyFaceDetector.loadFromDisk(dir);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(dir);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(dir);
  faceRuntime.ready = true;
}

function eyeAspect(eye) {
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return (distance(eye[1], eye[5]) + distance(eye[2], eye[4])) / (2 * Math.max(distance(eye[0], eye[3]), 1e-6));
}

function metricsFromLandmarks(landmarks) {
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

async function detectLoaded(buffer) {
  const { loadImage } = await import('@napi-rs/canvas');
  const image = await loadImage(buffer);
  const maxSide = 640;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = new Canvas(width, height);
  canvas.getContext('2d').drawImage(image, 0, 0, width, height);
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 });
  const found = await faceapi.detectAllFaces(canvas, options).withFaceLandmarks().withFaceDescriptors();
  if (!found.length) return { error: 'no_face' };
  found.sort((left, right) => right.detection.box.width - left.detection.box.width);
  const face = found[0];
  const descriptor = Array.from(face.descriptor);
  if (descriptor.length !== 128) return { error: 'no_face' };
  return {
    descriptor,
    ...metricsFromLandmarks(face.landmarks),
    score: face.detection.score,
    box: { width: face.detection.box.width, height: face.detection.box.height }
  };
}
