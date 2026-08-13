import type { BallDetection, RimCalibration } from "../../types/tracking";
import type { LearnedObjectDetection } from "./learnedBasketballDetector.web";

export interface PixelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  confidence: number;
  trackId?: number;
}

export interface HoopRimAnchor {
  centerOffsetX: number;
  centerOffsetY: number;
  widthScale: number;
  heightScale: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function boxWidth(box: PixelBox): number {
  return Math.max(1, box.right - box.left);
}

function boxHeight(box: PixelBox): number {
  return Math.max(1, box.bottom - box.top);
}

function boxCenter(box: PixelBox): { x: number; y: number } {
  return {
    x: (box.left + box.right) / 2,
    y: (box.top + box.bottom) / 2,
  };
}

export function learnedDetectionToPixelBox(detection: LearnedObjectDetection): PixelBox {
  return {
    left: detection.left,
    top: detection.top,
    right: detection.right,
    bottom: detection.bottom,
    confidence: detection.confidence,
  };
}

export function trackRowToPixelBox(row: number[]): PixelBox | null {
  const [left, top, right, bottom, trackId, confidence] = row;
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(right) ||
    !Number.isFinite(bottom) ||
    !Number.isFinite(confidence) ||
    (right ?? 0) <= (left ?? 0) ||
    (bottom ?? 0) <= (top ?? 0)
  ) {
    return null;
  }
  return {
    left: left ?? 0,
    top: top ?? 0,
    right: right ?? 0,
    bottom: bottom ?? 0,
    confidence: confidence ?? 0,
    trackId: Number.isFinite(trackId) ? trackId : undefined,
  };
}

export function toByteTrackDetections(boxes: PixelBox[]): {
  xywh: number[][];
  conf: number[];
  cls: number[];
} {
  return {
    xywh: boxes.map((box) => [
      (box.left + box.right) / 2,
      (box.top + box.bottom) / 2,
      boxWidth(box),
      boxHeight(box),
    ]),
    conf: boxes.map((box) => box.confidence),
    cls: boxes.map(() => 0),
  };
}

export function chooseBoxNearReference(
  boxes: PixelBox[],
  reference: PixelBox,
  preferredTrackId?: number,
): PixelBox | null {
  if (boxes.length === 0) return null;
  const preferred = preferredTrackId === undefined
    ? null
    : boxes.find((box) => box.trackId === preferredTrackId) ?? null;
  if (preferred) return preferred;

  const referenceCenter = boxCenter(reference);
  const referenceDiagonal = Math.max(1, Math.hypot(boxWidth(reference), boxHeight(reference)));
  let best: PixelBox | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    const center = boxCenter(box);
    const normalizedDistance = Math.hypot(
      center.x - referenceCenter.x,
      center.y - referenceCenter.y,
    ) / referenceDiagonal;
    const sizeChange = Math.abs(Math.log(boxWidth(box) / boxWidth(reference))) +
      Math.abs(Math.log(boxHeight(box) / boxHeight(reference)));
    const score = box.confidence * 0.48 - normalizedDistance * 0.38 - sizeChange * 0.14;
    if (score > bestScore) {
      best = box;
      bestScore = score;
    }
  }
  return best;
}

export function chooseCalibrationHoop(
  hoops: PixelBox[],
  rim: RimCalibration,
  frameWidth: number,
  frameHeight: number,
): PixelBox | null {
  if (hoops.length === 0) return null;
  const rimCenterX = (rim.x + rim.width / 2) * frameWidth;
  const rimCenterY = (rim.y + rim.height / 2) * frameHeight;
  let best: PixelBox | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const hoop of hoops) {
    const width = boxWidth(hoop);
    const height = boxHeight(hoop);
    const center = boxCenter(hoop);
    const containsRimCenter =
      rimCenterX >= hoop.left - width * 0.2 &&
      rimCenterX <= hoop.right + width * 0.2 &&
      rimCenterY >= hoop.top - height * 0.2 &&
      rimCenterY <= hoop.bottom + height * 0.2;
    const normalizedDistance = Math.hypot(
      center.x - rimCenterX,
      center.y - rimCenterY,
    ) / Math.max(1, Math.hypot(width, height));
    // A manually marked rim is a strong spatial prior. Do not let a weak
    // detector response elsewhere on the court steal the hoop lock.
    if (!containsRimCenter && normalizedDistance > 1.8) continue;
    const score = hoop.confidence + (containsRimCenter ? 1 : 0) - normalizedDistance * 0.45;
    if (score > bestScore) {
      best = hoop;
      bestScore = score;
    }
  }
  return best;
}

export function createHoopRimAnchor(
  rim: RimCalibration,
  hoop: PixelBox,
  frameWidth: number,
  frameHeight: number,
): HoopRimAnchor {
  const hoopWidth = boxWidth(hoop);
  const hoopHeight = boxHeight(hoop);
  const center = boxCenter(hoop);
  const rimCenterX = (rim.x + rim.width / 2) * frameWidth;
  const rimCenterY = (rim.y + rim.height / 2) * frameHeight;
  return {
    centerOffsetX: (rimCenterX - center.x) / hoopWidth,
    centerOffsetY: (rimCenterY - center.y) / hoopHeight,
    widthScale: (rim.width * frameWidth) / hoopWidth,
    heightScale: (rim.height * frameHeight) / hoopHeight,
  };
}

export function rimFromTrackedHoop(
  hoop: PixelBox,
  anchor: HoopRimAnchor,
  frameWidth: number,
  frameHeight: number,
): RimCalibration {
  const hoopWidth = boxWidth(hoop);
  const hoopHeight = boxHeight(hoop);
  const center = boxCenter(hoop);
  const rimWidth = clamp(hoopWidth * anchor.widthScale / frameWidth, 0.02, 0.5);
  const rimHeight = clamp(hoopHeight * anchor.heightScale / frameHeight, 0.008, 0.28);
  const rimCenterX = (center.x + anchor.centerOffsetX * hoopWidth) / frameWidth;
  const rimCenterY = (center.y + anchor.centerOffsetY * hoopHeight) / frameHeight;
  return {
    x: clamp(rimCenterX - rimWidth / 2, 0, 1 - rimWidth),
    y: clamp(rimCenterY - rimHeight / 2, 0, 1 - rimHeight),
    width: rimWidth,
    height: rimHeight,
  };
}

export function pixelBoxToBallDetection(
  box: PixelBox,
  frameWidth: number,
  frameHeight: number,
  at: number,
): BallDetection {
  const width = boxWidth(box) / frameWidth;
  const height = boxHeight(box) / frameHeight;
  return {
    x: ((box.left + box.right) / 2) / frameWidth,
    y: ((box.top + box.bottom) / 2) / frameHeight,
    width,
    height,
    // Keep the detector score honest. ByteTrack continuity raises motion
    // confidence, but a weak raw box must never become a near-certain ball.
    confidence: clamp(0.55 + box.confidence * 0.45, 0, 1),
    motionConfidence: box.trackId === undefined ? 0.3 : 0.86,
    appearanceConfidence: clamp(box.confidence, 0, 1),
    at,
  };
}

export function mergeLearnedAndMotionCandidates(
  learned: BallDetection[],
  motion: BallDetection[],
): BallDetection[] {
  if (learned.length === 0) return motion;
  const merged = [...learned];
  for (const candidate of motion) {
    const duplicate = learned.some((detection) => {
      const allowedDistance = Math.max(
        0.025,
        Math.max(detection.width, detection.height, candidate.width, candidate.height) * 1.4,
      );
      return Math.hypot(detection.x - candidate.x, detection.y - candidate.y) <= allowedDistance;
    });
    if (!duplicate) merged.push(candidate);
  }
  return merged;
}
