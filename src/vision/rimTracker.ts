import type { RimCalibration } from "../../types/tracking";

const TEMPLATE_COLUMNS = 13;
const TEMPLATE_ROWS = 9;
const MIN_MATCH_CONFIDENCE = 0.56;

export interface RimAppearanceTemplate {
  columns: number;
  rows: number;
  patchWidth: number;
  patchHeight: number;
  normalizedSamples: Float32Array;
}

export interface RimTrackState {
  rim: RimCalibration;
  template: RimAppearanceTemplate;
  framesProcessed: number;
  trackedFrames: number;
  lostFrames: number;
  confidenceTotal: number;
  consecutiveLostFrames: number;
}

export interface RimTrackStep {
  rim: RimCalibration;
  confidence: number;
  found: boolean;
  state: RimTrackState;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeSamples(samples: Float32Array): Float32Array {
  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= Math.max(1, samples.length);

  let variance = 0;
  for (const sample of samples) variance += (sample - mean) ** 2;
  const deviation = Math.sqrt(variance / Math.max(1, samples.length));
  const scale = Math.max(7, deviation);
  const normalized = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    normalized[index] = ((samples[index] ?? mean) - mean) / scale;
  }
  return normalized;
}

function samplePatch(
  gray: Uint8Array,
  frameWidth: number,
  frameHeight: number,
  centerX: number,
  centerY: number,
  patchWidth: number,
  patchHeight: number,
  columns: number,
  rows: number,
): Float32Array {
  const samples = new Float32Array(columns * rows);
  const left = centerX - patchWidth / 2;
  const top = centerY - patchHeight / 2;
  let target = 0;

  for (let row = 0; row < rows; row += 1) {
    const sampleY = clamp(
      Math.round(top + ((row + 0.5) / rows) * patchHeight),
      1,
      Math.max(1, frameHeight - 2),
    );
    for (let column = 0; column < columns; column += 1) {
      const sampleX = clamp(
        Math.round(left + ((column + 0.5) / columns) * patchWidth),
        1,
        Math.max(1, frameWidth - 2),
      );
      const index = sampleY * frameWidth + sampleX;
      const horizontalEdge = Math.abs((gray[index + 1] ?? 0) - (gray[index - 1] ?? 0));
      const verticalEdge = Math.abs(
        (gray[index + frameWidth] ?? 0) - (gray[index - frameWidth] ?? 0),
      );
      const intensity = gray[index] ?? 0;
      samples[target] = intensity * 0.36 + (horizontalEdge + verticalEdge) * 0.64;
      target += 1;
    }
  }
  return samples;
}

function correlation(left: Float32Array, right: Float32Array): number {
  let dot = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftEnergy += a * a;
    rightEnergy += b * b;
  }
  const denominator = Math.sqrt(leftEnergy * rightEnergy);
  return denominator > 0.0001 ? clamp(dot / denominator, -1, 1) : -1;
}

export function createRimTrackState(
  gray: Uint8Array,
  frameWidth: number,
  frameHeight: number,
  rim: RimCalibration,
): RimTrackState {
  const rimWidthPixels = Math.max(3, rim.width * frameWidth);
  const rimHeightPixels = Math.max(2, rim.height * frameHeight);
  const patchWidth = Math.round(clamp(rimWidthPixels * 1.9, 24, frameWidth * 0.48));
  const patchHeight = Math.round(
    clamp(
      Math.max(rimHeightPixels * 4.2, rimWidthPixels * 0.9),
      18,
      frameHeight * 0.34,
    ),
  );
  const centerX = (rim.x + rim.width / 2) * frameWidth;
  const centerY = (rim.y + rim.height / 2) * frameHeight;
  const samples = samplePatch(
    gray,
    frameWidth,
    frameHeight,
    centerX,
    centerY,
    patchWidth,
    patchHeight,
    TEMPLATE_COLUMNS,
    TEMPLATE_ROWS,
  );

  return {
    rim: { ...rim },
    template: {
      columns: TEMPLATE_COLUMNS,
      rows: TEMPLATE_ROWS,
      patchWidth,
      patchHeight,
      normalizedSamples: normalizeSamples(samples),
    },
    framesProcessed: 0,
    trackedFrames: 0,
    lostFrames: 0,
    confidenceTotal: 0,
    consecutiveLostFrames: 0,
  };
}

export function stepRimTracker(
  gray: Uint8Array,
  frameWidth: number,
  frameHeight: number,
  current: RimTrackState,
): RimTrackStep {
  const baseCenterX = (current.rim.x + current.rim.width / 2) * frameWidth;
  const baseCenterY = (current.rim.y + current.rim.height / 2) * frameHeight;
  const rimWidthPixels = Math.max(3, current.rim.width * frameWidth);
  const expansion = 1 + Math.min(4, current.consecutiveLostFrames) * 0.45;
  const radiusX = Math.round(clamp(rimWidthPixels * 0.62 * expansion, 6, frameWidth * 0.12));
  const radiusY = Math.round(clamp(rimWidthPixels * 0.48 * expansion, 5, frameHeight * 0.1));
  const stride = Math.max(radiusX, radiusY) > 20 ? 2 : 1;

  let bestCenterX = baseCenterX;
  let bestCenterY = baseCenterY;
  let bestScore = -1;
  let bestConfidence = 0;

  for (let offsetY = -radiusY; offsetY <= radiusY; offsetY += stride) {
    for (let offsetX = -radiusX; offsetX <= radiusX; offsetX += stride) {
      const centerX = baseCenterX + offsetX;
      const centerY = baseCenterY + offsetY;
      const samples = normalizeSamples(
        samplePatch(
          gray,
          frameWidth,
          frameHeight,
          centerX,
          centerY,
          current.template.patchWidth,
          current.template.patchHeight,
          current.template.columns,
          current.template.rows,
        ),
      );
      const match = correlation(current.template.normalizedSamples, samples);
      const confidence = clamp((match + 1) / 2, 0, 1);
      const distancePenalty = Math.hypot(offsetX / radiusX, offsetY / radiusY) * 0.035;
      const score = confidence - distancePenalty;
      if (score > bestScore) {
        bestScore = score;
        bestConfidence = confidence;
        bestCenterX = centerX;
        bestCenterY = centerY;
      }
    }
  }

  const found = bestConfidence >= MIN_MATCH_CONFIDENCE;
  const smoothing = bestConfidence >= 0.78 ? 0.78 : 0.52;
  const resolvedCenterX = found
    ? baseCenterX + (bestCenterX - baseCenterX) * smoothing
    : baseCenterX;
  const resolvedCenterY = found
    ? baseCenterY + (bestCenterY - baseCenterY) * smoothing
    : baseCenterY;
  const rim = found
    ? {
        ...current.rim,
        x: clamp(resolvedCenterX / frameWidth - current.rim.width / 2, 0, 1 - current.rim.width),
        y: clamp(resolvedCenterY / frameHeight - current.rim.height / 2, 0, 1 - current.rim.height),
      }
    : current.rim;
  const state: RimTrackState = {
    ...current,
    rim,
    framesProcessed: current.framesProcessed + 1,
    trackedFrames: current.trackedFrames + (found ? 1 : 0),
    lostFrames: current.lostFrames + (found ? 0 : 1),
    confidenceTotal: current.confidenceTotal + bestConfidence,
    consecutiveLostFrames: found ? 0 : current.consecutiveLostFrames + 1,
  };

  return { rim, confidence: bestConfidence, found, state };
}
