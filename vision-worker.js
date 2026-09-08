/* MANTIS local YOLOv8n-OIV7 worker. */
import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/+esm';

// The worker is served from the Android appasset origin. Point ONNX Runtime's
// WASM binaries at the CDN explicitly instead of resolving them beside the
// local worker file (which would produce a silent 404 in WebView).
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';

const SIZE = 320;
const MODEL_URL = new URL('./yolov8n-oiv7.onnx', import.meta.url).href;
const LABELS = {
  15: 'backpack', 54: 'book', 57: 'bottle', 104: 'chair', 113: 'clock',
  121: 'cup', 129: 'mouse', 134: 'phone', 237: 'handbag', 244: 'headphones',
  505: 'glasses', 577: 'watch'
};
const ALIASES = { phone: ['phone', 'corded phone', 'mobile phone'], glasses: ['glasses', 'sunglasses'] };
let session = null;
let activeDevice = 'wasm';

function canonical(value) { return String(value || '').toLowerCase().replace(/[_-]/g, ' ').trim(); }
function wanted(label, targets) {
  const l = canonical(label);
  return (Array.isArray(targets) ? targets : [targets]).some(target => {
    const t = canonical(target);
    return l === t || (ALIASES[t] || []).some(alias => l === alias);
  });
}
function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / Math.max(1e-6, a.width * a.height + b.width * b.height - inter);
}

async function initModel(preferredDevice = 'wasm') {
  if (session) { self.postMessage({ type: 'init-complete', device: activeDevice }); return; }
  try {
    self.postMessage({ type: 'init-progress', status: 'downloading', progress: 0, device: 'wasm' });
    session = await ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ['wasm'], graphOptimizationLevel: 'all'
    });
    activeDevice = 'wasm';
    self.postMessage({ type: 'init-progress', status: 'loading', progress: 95, device: activeDevice });
    self.postMessage({ type: 'init-complete', device: activeDevice });
  } catch (error) {
    session = null;
    self.postMessage({ type: 'init-error', error: error.message || 'Failed to load YOLO model', device: activeDevice });
  }
}

async function detect(imageData, targets, requestId) {
  if (!session) { self.postMessage({ type: 'result', detections: [], inferenceTime: 0, id: requestId, error: 'Model not ready' }); return; }
  const started = performance.now();
  try {
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const source = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
    ctx.drawImage(await createImageBitmap(source), 0, 0, SIZE, SIZE);
    const pixels = ctx.getImageData(0, 0, SIZE, SIZE).data;
    const input = new Float32Array(3 * SIZE * SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) {
      input[i] = pixels[i * 4] / 255;
      input[SIZE * SIZE + i] = pixels[i * 4 + 1] / 255;
      input[2 * SIZE * SIZE + i] = pixels[i * 4 + 2] / 255;
    }
    const tensor = new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]);
    const output = (await session.run({ [session.inputNames[0]]: tensor }))[session.outputNames[0]];
    const data = output.data, count = output.dims[2], classes = output.dims[1] - 4;
    const candidates = [];
    for (let i = 0; i < count; i++) {
      let bestClass = -1, bestScore = 0;
      for (let c = 0; c < classes; c++) {
        const score = Number(data[(4 + c) * count + i]);
        if (score > bestScore) { bestScore = score; bestClass = c; }
      }
      const label = LABELS[bestClass];
      // Do not discard weak-but-real candidates here. The main thread still
      // requires a confidence threshold plus temporal/spatial stability.
      if (!label || bestScore < 0.015 || !wanted(label, targets)) continue;
      const cx = Number(data[i]), cy = Number(data[count + i]);
      const w = Number(data[2 * count + i]), h = Number(data[3 * count + i]);
      candidates.push({ label, confidence: bestScore, x: Math.max(0, (cx - w / 2) / SIZE), y: Math.max(0, (cy - h / 2) / SIZE), width: w / SIZE, height: h / SIZE });
    }
    candidates.sort((a, b) => b.confidence - a.confidence);
    const detections = candidates.filter((candidate, index) => !candidates.slice(0, index).some(previous => iou(candidate, previous) > 0.5)).slice(0, 5);
    self.postMessage({ type: 'result', detections, inferenceTime: Math.round(performance.now() - started), device: activeDevice, id: requestId });
  } catch (error) {
    self.postMessage({ type: 'result', detections: [], inferenceTime: Math.round(performance.now() - started), device: activeDevice, id: requestId, error: error.message || 'YOLO inference failed' });
  }
}

self.onmessage = async ({ data: msg }) => {
  if (msg.type === 'init') await initModel(msg.device || 'wasm');
  else if (msg.type === 'detect') await detect(msg.imageData, msg.targets, msg.id);
  else if (msg.type === 'dispose') { if (session) await session.release(); session = null; }
};
