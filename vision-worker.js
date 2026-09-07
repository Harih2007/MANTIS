/* ============================================
   MANTIS — Vision Worker
   Runs Transformers.js OWL-ViT inference
   off the main thread
   ============================================ */

// Import Transformers.js from CDN
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

// Configure: allow remote models, use browser cache
env.allowLocalModels = false;

// Model state
let detector = null;
let isLoading = false;
let isReady = false;
let activeDevice = 'wasm';

// ==========================================
// MODEL INITIALIZATION
// ==========================================
async function initModel(preferredDevice = 'wasm') {
  if (isReady && activeDevice === preferredDevice) {
    self.postMessage({ type: 'init-complete', device: activeDevice });
    return;
  }
  if (isLoading) return;
  isLoading = true;

  // If re-initializing with different device, dispose existing
  if (detector) {
    try { await detector.dispose(); } catch (e) { /* ignore */ }
    detector = null;
    isReady = false;
  }

  // Attempt preferred device, fallback to wasm if webgpu fails
  const devicesToTry = preferredDevice === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];

  for (const device of devicesToTry) {
    try {
      self.postMessage({
        type: 'init-progress',
        status: 'downloading',
        progress: 0,
        device
      });

      detector = await pipeline(
        'zero-shot-object-detection',
        'Xenova/owlvit-base-patch32',
        {
          device: device,
          progress_callback: (progress) => {
            if (progress.status === 'progress' && progress.progress !== undefined) {
              self.postMessage({
                type: 'init-progress',
                status: 'downloading',
                progress: Math.round(progress.progress),
                file: progress.file || '',
                device
              });
            } else if (progress.status === 'done') {
              self.postMessage({
                type: 'init-progress',
                status: 'loading',
                progress: 95,
                device
              });
            }
          }
        }
      );

      activeDevice = device;
      isReady = true;
      isLoading = false;
      self.postMessage({ type: 'init-complete', device: activeDevice });
      return;

    } catch (error) {
      console.warn(`[VisionWorker] Device ${device} failed:`, error.message);
      if (device === 'webgpu' && devicesToTry.includes('wasm')) {
        self.postMessage({
          type: 'init-progress',
          status: 'warning',
          message: 'WebGPU failed or unsupported. Falling back to WASM...',
          progress: 10
        });
        continue;
      }

      isLoading = false;
      isReady = false;
      self.postMessage({
        type: 'init-error',
        error: error.message || `Failed to load vision model on ${device}`,
        device
      });
      return;
    }
  }
}

// ==========================================
// INFERENCE
// ==========================================
async function detect(imageData, targets, requestId) {
  if (!isReady || !detector) {
    self.postMessage({
      type: 'result',
      detections: [],
      inferenceTime: 0,
      id: requestId,
      error: 'Model not ready'
    });
    return;
  }

  const startTime = performance.now();

  try {
    // Convert ImageData to a data URL via OffscreenCanvas
    // OWL-ViT pipeline expects an image URL, Blob, or RawImage
    const canvas = new OffscreenCanvas(imageData.width, imageData.height);
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });

    // Create object URL for the blob
    // Transformers.js can accept a Blob directly in newer versions
    const candidateLabels = Array.isArray(targets) ? targets : [targets];

    // Run the zero-shot detection pipeline
    const results = await detector(blob, candidateLabels, {
      threshold: 0.02, // Low raw floor so candidate scores are passed for client-side thresholding
      percentage: true  // Return coordinates as percentages (0-1)
    });

    const inferenceTime = Math.round(performance.now() - startTime);

    // Normalize output format
    const detections = results.map(det => ({
      label: det.label || candidateLabels[0],
      confidence: det.score || 0,
      x: det.box?.xmin ?? 0,
      y: det.box?.ymin ?? 0,
      width: (det.box?.xmax ?? 0) - (det.box?.xmin ?? 0),
      height: (det.box?.ymax ?? 0) - (det.box?.ymin ?? 0),
      // Also keep raw box
      xmin: det.box?.xmin ?? 0,
      ymin: det.box?.ymin ?? 0,
      xmax: det.box?.xmax ?? 0,
      ymax: det.box?.ymax ?? 0
    }));

    self.postMessage({
      type: 'result',
      detections,
      inferenceTime,
      device: activeDevice,
      id: requestId
    });

  } catch (error) {
    const inferenceTime = Math.round(performance.now() - startTime);
    self.postMessage({
      type: 'result',
      detections: [],
      inferenceTime,
      device: activeDevice,
      id: requestId,
      error: error.message || 'Inference failed'
    });
  }
}

// ==========================================
// MESSAGE HANDLER
// ==========================================
self.onmessage = async function (e) {
  const msg = e.data;

  switch (msg.type) {
    case 'init':
      await initModel(msg.device || 'wasm');
      break;

    case 'detect':
      await detect(msg.imageData, msg.targets, msg.id);
      break;

    case 'dispose':
      if (detector) {
        try {
          await detector.dispose();
        } catch (err) { /* ignore */ }
        detector = null;
        isReady = false;
      }
      break;

    default:
      break;
  }
};
