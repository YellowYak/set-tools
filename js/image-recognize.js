/**
 * image-recognize.js
 *
 * Browser-side ML pipeline for detecting and classifying Set cards in a photo.
 *
 * Two models are used:
 *   Detector  — YOLOv8 OBB (best.onnx), run via onnxruntime-web
 *   Classifier — MobileNetV2 multi-head (model.json), run via TensorFlow.js
 *
 * Both libraries are lazy-loaded from CDN on first use so regular solver
 * users pay no download cost.
 *
 * Public API:
 *   recognizeCards(imageFile, allCards, onProgress?)
 *     → Promise<{ deckIndices, detections, previewCanvas }>
 */

// ── Model paths (served from the static HTTP server) ──────────────────────────
const DETECTOR_PATH   = 'models/best.onnx';
const CLASSIFIER_PATH = 'models/model.json';

// ── Inference constants ────────────────────────────────────────────────────────
const DETECTOR_SIZE   = 640;   // YOLOv8 input square side
const CLASSIFIER_SIZE = 224;   // MobileNetV2 input square side
const CONF_THRESHOLD  = 0.25;  // minimum detection confidence to keep
const NMS_THRESHOLD   = 0.35;  // IoU threshold for NMS (AABB approximation)
const PREVIEW_MAX_W   = 600;   // max width of annotated preview canvas

// ── Classifier label arrays ────────────────────────────────────────────────────
const COLORS    = ['red', 'green', 'purple'];
const SHAPES    = ['diamond', 'oval', 'squiggle'];
const FILLS_RAW = ['empty', 'striped', 'filled']; // model labels
const FILL_MAP  = { empty: 'open', striped: 'striped', filled: 'solid' }; // → game values
const COUNTS    = [1, 2, 3];

// ── Classifier output index map ────────────────────────────────────────────────
// Verified by two-card calibration against model.json graph topology.
// TF.js returns outputs as a positional array in signature order:
//   preds[0] = color head  (Identity   → color_1/Softmax)
//   preds[1] = fill head   (Identity_2 → fill_1/Softmax)
//   preds[2] = shape head  (Identity_3 → shape_1/Softmax)
//   preds[3] = count head  (Identity_1 → count_1/Softmax)
const CLASSIFIER_OUT_MAP = Object.freeze({ color: 0, shape: 2, fill: 1, count: 3 });

// ── CDN URLs ───────────────────────────────────────────────────────────────────
const TFJS_CDN = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
const ORT_CDN  = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.min.js';
const ORT_WASM = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';

// ── Module-level singletons ────────────────────────────────────────────────────
let libsLoaded      = false;
let detectorSession = null;
let classifierModel = null;

// =============================================================================
// Library loading
// =============================================================================

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureLibsLoaded() {
  if (libsLoaded) return;
  // Sequential: ort.env.wasm.wasmPaths must be set after ort loads
  await loadScript(TFJS_CDN);
  await loadScript(ORT_CDN);
  /* global ort */
  ort.env.wasm.wasmPaths = ORT_WASM;
  libsLoaded = true;
}

// =============================================================================
// Model singletons
// =============================================================================

async function getDetector() {
  if (!detectorSession) {
    /* global ort */
    detectorSession = await ort.InferenceSession.create(DETECTOR_PATH, {
      executionProviders: ['wasm'],
    });
  }
  return detectorSession;
}

async function getClassifier() {
  if (!classifierModel) {
    /* global tf */
    // Model was converted from a TF SavedModel → use loadGraphModel, not loadLayersModel
    classifierModel = await tf.loadGraphModel(CLASSIFIER_PATH);
  }
  return classifierModel;
}

// =============================================================================
// Image loading
// =============================================================================

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}

// =============================================================================
// Detector preprocessing — letterbox image to 640×640
// =============================================================================

/**
 * Draws img onto a 640×640 canvas with gray letterbox padding.
 * Returns { canvas, scale, padLeft, padTop } for later coordinate inversion.
 */
function letterboxImage(img) {
  const canvas = document.createElement('canvas');
  canvas.width  = DETECTOR_SIZE;
  canvas.height = DETECTOR_SIZE;
  const ctx = canvas.getContext('2d');

  const scale   = Math.min(DETECTOR_SIZE / img.naturalWidth, DETECTOR_SIZE / img.naturalHeight);
  const newW    = Math.round(img.naturalWidth  * scale);
  const newH    = Math.round(img.naturalHeight * scale);
  const padLeft = Math.floor((DETECTOR_SIZE - newW) / 2);
  const padTop  = Math.floor((DETECTOR_SIZE - newH) / 2);

  ctx.fillStyle = 'rgb(114,114,114)'; // YOLO default pad color
  ctx.fillRect(0, 0, DETECTOR_SIZE, DETECTOR_SIZE);
  ctx.drawImage(img, padLeft, padTop, newW, newH);

  return { canvas, scale, padLeft, padTop };
}

/**
 * Converts a canvas to a Float32Array in CHW RGB order, values 0–1.
 * Shape: [1, 3, H, W]
 */
function canvasToDetectorTensor(canvas) {
  const ctx  = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const n    = canvas.width * canvas.height;
  const f32  = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    f32[i]         = data[i * 4]     / 255; // R
    f32[i + n]     = data[i * 4 + 1] / 255; // G
    f32[i + 2 * n] = data[i * 4 + 2] / 255; // B
  }
  return f32;
}

// =============================================================================
// Detector inference + post-processing
// =============================================================================

async function runDetector(img) {
  const { canvas, scale, padLeft, padTop } = letterboxImage(img);
  const inputData = canvasToDetectorTensor(canvas);
  const tensor    = new ort.Tensor('float32', inputData, [1, 3, DETECTOR_SIZE, DETECTOR_SIZE]);

  const session = await getDetector();
  const feeds   = { [session.inputNames[0]]: tensor };
  const results = await session.run(feeds);
  const output  = results[session.outputNames[0]]; // shape [1, 300, 7]

  return { output, scale, padLeft, padTop };
}

/**
 * Parse raw YOLO output into detection objects.
 * Filters by CONF_THRESHOLD and converts coords from 640×640 space
 * back to the original image's pixel space.
 *
 * Each detection: { xc, yc, w, h, angle (radians), conf, cls }
 */
function parseDetections(output, scale, padLeft, padTop) {
  const data    = output.data;
  const dims    = Array.from(output.dims);
  const numDets = dims[1];
  const numCols = dims[2] ?? 7;
  const result  = [];

  for (let i = 0; i < numDets; i++) {
    const off  = i * numCols;
    // Column order: [x, y, w, h, confidence, class_id, angle]
    const conf = data[off + 4];
    if (conf < CONF_THRESHOLD) continue;

    const xc    = (data[off + 0] - padLeft) / scale;
    const yc    = (data[off + 1] - padTop)  / scale;
    const w     =  data[off + 2]            / scale;
    const h     =  data[off + 3]            / scale;
    const cls   = Math.round(data[off + 5]);
    const angle =  data[off + 6];

    result.push({ xc, yc, w, h, angle, conf, cls });
  }

  return result;
}

// =============================================================================
// NMS — axis-aligned bounding box approximation of OBB
// =============================================================================

function obbToAabb(det) {
  const cos   = Math.abs(Math.cos(det.angle));
  const sin   = Math.abs(Math.sin(det.angle));
  const halfW = (det.w * cos + det.h * sin) / 2;
  const halfH = (det.w * sin + det.h * cos) / 2;
  return { x1: det.xc - halfW, y1: det.yc - halfH, x2: det.xc + halfW, y2: det.yc + halfH };
}

function iou(a, b) {
  const x1    = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1);
  const x2    = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter === 0) return 0;
  const aArea = (a.x2 - a.x1) * (a.y2 - a.y1);
  const bArea = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (aArea + bArea - inter);
}

function nms(detections) {
  const sorted     = [...detections].sort((a, b) => b.conf - a.conf);
  const kept       = [];
  const suppressed = new Set();

  for (let i = 0; i < sorted.length; i++) {
    if (suppressed.has(i)) continue;
    kept.push(sorted[i]);
    const boxA = obbToAabb(sorted[i]);
    for (let j = i + 1; j < sorted.length; j++) {
      if (suppressed.has(j)) continue;
      if (iou(boxA, obbToAabb(sorted[j])) > NMS_THRESHOLD) suppressed.add(j);
    }
  }
  return kept;
}

// =============================================================================
// Card crop — canvas affine transform (translate + rotate + scale)
// =============================================================================

/**
 * Crops a rotated card region from img into a CLASSIFIER_SIZE × CLASSIFIER_SIZE canvas.
 * Portrait orientation is enforced: if w > h, swap w/h and adjust angle by π/2.
 */
function cropCard(img, det) {
  let { xc, yc, w, h, angle } = det;

  // Enforce portrait
  if (w > h) {
    [w, h] = [h, w];
    angle += Math.PI / 2;
  }

  const out = document.createElement('canvas');
  out.width  = CLASSIFIER_SIZE;
  out.height = CLASSIFIER_SIZE;
  const ctx  = out.getContext('2d');

  // Scale so the card fills the output canvas
  const sx = CLASSIFIER_SIZE / w;
  const sy = CLASSIFIER_SIZE / h;

  // Pipeline: scale → translate to center of output → rotate → translate
  // so card center lands at origin → draw full image
  ctx.save();
  ctx.scale(sx, sy);
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-angle);
  ctx.translate(-xc, -yc);
  ctx.drawImage(img, 0, 0);
  ctx.restore();

  return out;
}

// =============================================================================
// Classifier inference
// =============================================================================

/**
 * Converts a 224×224 canvas to a [1, 224, 224, 3] float32 tensor
 * normalized to [-1, 1]: pixel = (rawPixel / 127.5) - 1.0
 */
function canvasToClassifierTensor(canvas) {
  /* global tf */
  return tf.tidy(() => {
    const raw = tf.browser.fromPixels(canvas);          // uint8 [224,224,3]
    const f   = raw.toFloat();
    const normalized = f.div(127.5).sub(1.0);           // [-1, 1]
    return normalized.expandDims(0);                    // [1,224,224,3]
  });
}

/**
 * Runs MobileNetV2 on a 224×224 crop canvas.
 * Returns { color, shape, fill, count } using game property values.
 */
async function classifyCard(cropCanvas) {
  /* global tf */
  const model = await getClassifier();

  const inputTensor = canvasToClassifierTensor(cropCanvas);
  const predictions = model.predict(inputTensor);
  inputTensor.dispose();

  // Normalize to an array — GraphModel returns Tensor[], LayersModel also returns Tensor[]
  let preds;
  if (Array.isArray(predictions)) {
    preds = predictions;
  } else if (predictions instanceof tf.Tensor) {
    preds = [predictions];
  } else {
    preds = Object.values(predictions);
  }

  const argmax = async (t) => (await t.argMax(1).data())[0];

  const colorIdx = await argmax(preds[CLASSIFIER_OUT_MAP.color]);
  const shapeIdx = await argmax(preds[CLASSIFIER_OUT_MAP.shape]);
  const fillIdx  = await argmax(preds[CLASSIFIER_OUT_MAP.fill]);
  const countIdx = await argmax(preds[CLASSIFIER_OUT_MAP.count]);

  preds.forEach(t => t.dispose());

  return {
    color: COLORS[colorIdx],
    shape: SHAPES[shapeIdx],
    fill:  FILL_MAP[FILLS_RAW[fillIdx]],
    count: COUNTS[countIdx],
  };
}

// =============================================================================
// Deck index lookup
// =============================================================================

function cardToDeckIndex(props, allCards) {
  return allCards.findIndex(c =>
    c.color === props.color &&
    c.shape === props.shape &&
    c.fill  === props.fill  &&
    c.count === props.count
  );
}

// =============================================================================
// Preview canvas — annotated photo with OBB overlays
// =============================================================================

/**
 * Returns a canvas showing the original image scaled to ≤ PREVIEW_MAX_W px wide,
 * with oriented bounding boxes drawn:
 *   green = successfully classified card
 *   red   = deckIdx === -1 (unrecognized)
 */
function drawPreviewOverlays(img, detections) {
  const scale  = Math.min(1, PREVIEW_MAX_W / img.naturalWidth);
  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(img.naturalWidth  * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx    = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  for (const det of detections) {
    ctx.save();
    ctx.translate(det.xc * scale, det.yc * scale);
    ctx.rotate(det.angle);
    ctx.strokeStyle = det.deckIdx >= 0 ? '#22c55e' : '#ef4444';
    ctx.lineWidth   = 2;
    ctx.strokeRect(
      -(det.w * scale) / 2,
      -(det.h * scale) / 2,
       det.w * scale,
       det.h * scale,
    );
    ctx.restore();
  }

  return canvas;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Detect and classify all Set cards in a photo.
 *
 * @param {File}     imageFile    — from <input type="file"> or camera capture
 * @param {object[]} allCards     — canonical 81-card deck from createDeck()
 * @param {Function} [onProgress] — optional callback(message: string) for status updates
 *
 * @returns {Promise<{
 *   deckIndices: number[],           // deck index per detected card (-1 if unrecognized)
 *   detections:  object[],           // raw detection objects with added .deckIdx and .cardProps
 *   previewCanvas: HTMLCanvasElement // annotated photo (green/red OBB overlays)
 * }>}
 */
export async function recognizeCards(imageFile, allCards, onProgress) {
  const progress = onProgress ?? (() => {});

  progress('Loading models (first use only, ~20 MB)…');
  await ensureLibsLoaded();

  progress('Loading image…');
  const img = await loadImage(imageFile);

  progress('Detecting cards…');
  const { output, scale, padLeft, padTop } = await runDetector(img);

  const rawDets  = parseDetections(output, scale, padLeft, padTop);
  const filtered = nms(rawDets);

  if (filtered.length === 0) {
    const previewCanvas = drawPreviewOverlays(img, []);
    return { deckIndices: [], detections: [], previewCanvas };
  }

  progress(`Classifying ${filtered.length} card${filtered.length !== 1 ? 's' : ''}…`);

  const detections  = [];
  const deckIndices = [];

  for (const det of filtered) {
    const crop      = cropCard(img, det);
    const cardProps = await classifyCard(crop);
    const deckIdx   = cardToDeckIndex(cardProps, allCards);

    detections.push({ ...det, cardProps, deckIdx });
    deckIndices.push(deckIdx);
  }

  const previewCanvas = drawPreviewOverlays(img, detections);

  return { deckIndices, detections, previewCanvas };
}
