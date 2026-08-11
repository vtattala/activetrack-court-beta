import {
  createTrackerEngineState,
  MIN_AUTOMATIC_DECISION_CONFIDENCE,
  stepTracker,
} from "../tracking/engine";
import type {
  BallDetection,
  RimCalibration,
  VideoAnalysisResult,
  VideoShotDecision,
} from "../../types/tracking";
import { createVisionTrackState, selectTrackedBall } from "./ballTracker";
import {
  applyVideoQualityGate,
  buildVideoAnalysisDiagnostics,
  buildVideoFrameTimes,
  createVideoStabilityState,
  IMPORT_ANALYSIS_FPS,
  MAX_IMPORT_DURATION_SECONDS,
  resolveVideoSampleTiming,
  stepVideoStability,
} from "./videoAnalysisPolicy";

export { IMPORT_ANALYSIS_FPS, MAX_IMPORT_DURATION_SECONDS };
const ANALYSIS_MAX_WIDTH = 320;
const ANALYSIS_MAX_HEIGHT = 180;

export interface VideoPreview {
  uri: string;
  width: number;
  height: number;
  durationSeconds: number;
  atSeconds: number;
}

export interface VideoAnalysisOptions {
  durationSeconds?: number;
  onProgress?: (completedFrames: number, totalFrames: number) => void;
  isCancelled?: () => boolean;
}

export async function releaseVideoPreview(): Promise<void> {
  // Browser previews are data URLs and do not create a temporary file.
}

function createLoadedVideo(uri: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    let settled = false;
    const timeout = window.setTimeout(() => finish(new Error("The selected video took too long to load.")), 15_000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", handleReady);
      video.removeEventListener("error", handleError);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(video);
    };
    const handleReady = () => finish();
    const handleError = () => finish(new Error("The selected video could not be opened in this browser."));

    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.addEventListener("loadeddata", handleReady);
    video.addEventListener("error", handleError);
    video.src = uri;
    video.load();
  });
}

function disposeVideo(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function seekVideo(video: HTMLVideoElement, requestedTime: number): Promise<void> {
  const target = Math.max(0, Math.min(requestedTime, Math.max(0, video.duration - 0.02)));
  if (Math.abs(video.currentTime - target) < 0.002 && video.readyState >= 2) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(
      () => finish(new Error("A frame could not be read from this video.")),
      10_000,
    );
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const handleSeeked = () => finish();
    const handleError = () => finish(new Error("A frame could not be read from this video."));

    video.addEventListener("seeked", handleSeeked);
    video.addEventListener("error", handleError);
    video.currentTime = target;
  });
}

function createFrameCanvas(
  video: HTMLVideoElement,
  maximumWidth: number,
  maximumHeight: number,
): HTMLCanvasElement {
  const sourceWidth = Math.max(1, video.videoWidth);
  const sourceHeight = Math.max(1, video.videoHeight);
  const scale = Math.min(maximumWidth / sourceWidth, maximumHeight / sourceHeight, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  return canvas;
}

function drawVideoFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser cannot read video frames.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return context;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function isBasketballColor(red: number, green: number, blue: number): boolean {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  if (maximum < 48 || maximum === minimum) return false;

  const saturation = (maximum - minimum) / maximum;
  let hue = 0;
  if (maximum === red) hue = 60 * (((green - blue) / (maximum - minimum)) % 6);
  else if (maximum === green) hue = 60 * ((blue - red) / (maximum - minimum) + 2);
  else hue = 60 * ((red - green) / (maximum - minimum) + 4);
  if (hue < 0) hue += 360;

  return hue >= 4 && hue <= 38 && saturation >= 0.28;
}

function detectOrangeCandidates(
  pixels: ImageData,
  at: number,
): { candidates: BallDetection[]; gray: Uint8Array } {
  const { width, height, data } = pixels;
  const pixelCount = width * height;
  const rawMask = new Uint8Array(pixelCount);
  const gray = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const red = data[offset] ?? 0;
    const green = data[offset + 1] ?? 0;
    const blue = data[offset + 2] ?? 0;
    gray[index] = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
    if (isBasketballColor(red, green, blue)) rawMask[index] = 1;
  }

  const medianMask = new Uint8Array(pixelCount);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let neighbors = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          neighbors += rawMask[(y + offsetY) * width + x + offsetX] ?? 0;
        }
      }
      if (neighbors >= 4) medianMask[y * width + x] = 1;
    }
  }

  const dilated = new Uint8Array(pixelCount);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (
        medianMask[index] ||
        medianMask[index - 1] ||
        medianMask[index + 1] ||
        medianMask[index - width] ||
        medianMask[index + width]
      ) {
        dilated[index] = 1;
      }
    }
  }
  const mask = new Uint8Array(pixelCount);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (
        dilated[index] &&
        dilated[index - 1] &&
        dilated[index + 1] &&
        dilated[index - width] &&
        dilated[index + width]
      ) {
        mask[index] = 1;
      }
    }
  }

  const frameArea = Math.max(1, pixelCount);
  const minimumArea = Math.max(7, frameArea * 0.00012);
  const maximumArea = frameArea * 0.12;
  const candidates: BallDetection[] = [];

  for (let seed = 0; seed < pixelCount; seed += 1) {
    if (mask[seed] !== 1) continue;
    let head = 0;
    let tail = 0;
    queue[tail] = seed;
    tail += 1;
    mask[seed] = 2;

    let area = 0;
    let perimeter = 0;
    let minimumX = width;
    let maximumX = 0;
    let minimumY = height;
    let maximumY = 0;

    while (head < tail) {
      const index = queue[head] ?? 0;
      head += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      area += 1;
      minimumX = Math.min(minimumX, x);
      maximumX = Math.max(maximumX, x);
      minimumY = Math.min(minimumY, y);
      maximumY = Math.max(maximumY, y);

      if (x === 0 || mask[index - 1] === 0) perimeter += 1;
      if (x === width - 1 || mask[index + 1] === 0) perimeter += 1;
      if (y === 0 || mask[index - width] === 0) perimeter += 1;
      if (y === height - 1 || mask[index + width] === 0) perimeter += 1;

      const left = index - 1;
      const right = index + 1;
      const above = index - width;
      const below = index + width;
      if (x > 0 && mask[left] === 1) {
        mask[left] = 2;
        queue[tail] = left;
        tail += 1;
      }
      if (x < width - 1 && mask[right] === 1) {
        mask[right] = 2;
        queue[tail] = right;
        tail += 1;
      }
      if (y > 0 && mask[above] === 1) {
        mask[above] = 2;
        queue[tail] = above;
        tail += 1;
      }
      if (y < height - 1 && mask[below] === 1) {
        mask[below] = 2;
        queue[tail] = below;
        tail += 1;
      }
    }

    if (area < minimumArea || area > maximumArea) continue;
    const rectWidth = maximumX - minimumX + 1;
    const rectHeight = maximumY - minimumY + 1;
    const rectArea = Math.max(1, rectWidth * rectHeight);
    const ratio = rectWidth / Math.max(1, rectHeight);
    const fill = clamp(area / rectArea, 0, 1);
    const circularity = perimeter > 0
      ? clamp((4 * Math.PI * area) / (perimeter * perimeter), 0, 1)
      : 0;
    const roundness = 1 - clamp(Math.abs(1 - ratio), 0, 1);
    const validShape =
      rectWidth >= Math.max(3, width * 0.009) &&
      rectHeight >= Math.max(3, height * 0.014) &&
      rectWidth <= width * 0.26 &&
      rectHeight <= height * 0.4 &&
      ratio >= 0.4 &&
      ratio <= 2.4 &&
      fill >= 0.27 &&
      circularity >= 0.24;
    if (!validShape) continue;

    const confidence = clamp(
      0.28 + fill * 0.22 + roundness * 0.2 + circularity * 0.34,
      0,
      0.99,
    );
    if (confidence < 0.52) continue;

    candidates.push({
      x: (minimumX + rectWidth / 2) / width,
      y: (minimumY + rectHeight / 2) / height,
      width: rectWidth / width,
      height: rectHeight / height,
      confidence,
      at,
    });
  }

  candidates.sort((left, right) => right.confidence - left.confidence);
  return { candidates: candidates.slice(0, 8), gray };
}

export async function createVideoPreview(
  uri: string,
  requestedTimeSeconds = 0.25,
): Promise<VideoPreview> {
  const video = await createLoadedVideo(uri);
  try {
    const durationSeconds = video.duration;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error("The selected video has no readable duration.");
    }
    await seekVideo(video, requestedTimeSeconds);
    const canvas = createFrameCanvas(video, 960, 540);
    drawVideoFrame(video, canvas);
    return {
      uri: canvas.toDataURL("image/jpeg", 0.9),
      width: canvas.width,
      height: canvas.height,
      durationSeconds,
      atSeconds: video.currentTime,
    };
  } finally {
    disposeVideo(video);
  }
}

export async function analyzeBasketballVideo(
  uri: string,
  rim: RimCalibration,
  options: VideoAnalysisOptions = {},
): Promise<VideoAnalysisResult> {
  const video = await createLoadedVideo(uri);
  let tracker = createTrackerEngineState();
  let visionTrack = createVisionTrackState();
  const decisions: VideoShotDecision[] = [];
  let framesAnalyzed = 0;
  let samplesCompleted = 0;
  let duplicateFramesSkipped = 0;
  let largestFrameGapMs = 0;
  let previousTimestampMs: number | null = null;
  let previousGray: Uint8Array | null = null;
  let stability = createVideoStabilityState();

  try {
    const durationSeconds = options.durationSeconds && options.durationSeconds > 0
      ? Math.min(options.durationSeconds, video.duration)
      : video.duration;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error("The selected video has no readable duration.");
    }
    if (durationSeconds > MAX_IMPORT_DURATION_SECONDS) {
      throw new Error(`Choose a video that is ${MAX_IMPORT_DURATION_SECONDS / 60} minutes or shorter.`);
    }

    const frameTimes = buildVideoFrameTimes(durationSeconds);
    const canvas = createFrameCanvas(video, ANALYSIS_MAX_WIDTH, ANALYSIS_MAX_HEIGHT);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("This browser cannot analyze video frames.");
    options.onProgress?.(0, frameTimes.length);

    for (const requestedTime of frameTimes) {
      if (options.isCancelled?.()) throw new Error("Video analysis was cancelled.");
      await seekVideo(video, requestedTime);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const timing = resolveVideoSampleTiming(
        requestedTime,
        video.currentTime,
        previousTimestampMs,
      );
      if (timing.duplicate) {
        duplicateFramesSkipped += 1;
        samplesCompleted += 1;
        options.onProgress?.(samplesCompleted, frameTimes.length);
        continue;
      }
      previousTimestampMs = timing.timestampMs;
      largestFrameGapMs = Math.max(largestFrameGapMs, timing.gapMs);
      const timestamp = timing.timestampMs;
      const detection = detectOrangeCandidates(pixels, timestamp);
      let changedPixels = 0;
      if (previousGray && previousGray.length === detection.gray.length) {
        for (let index = 0; index < detection.gray.length; index += 1) {
          if (
            Math.abs((detection.gray[index] ?? 0) - (previousGray[index] ?? 0)) >= 38
          ) {
            changedPixels += 1;
          }
        }
      }
      const changedPixelRatio = previousGray
        ? changedPixels / Math.max(1, detection.gray.length)
        : 0;
      previousGray = detection.gray;
      stability = stepVideoStability(stability, changedPixelRatio);
      const selection = selectTrackedBall(detection.candidates, visionTrack, rim, timestamp);
      visionTrack = selection.state;

      const step = stepTracker(tracker, selection.detection, rim, timestamp);
      tracker = step.state;
      if (step.shot) {
        decisions.push({
          id: `${timestamp}-${decisions.length}`,
          atSeconds: timing.atSeconds,
          suggestedKind: step.shot,
          finalKind: step.confidence >= MIN_AUTOMATIC_DECISION_CONFIDENCE
            ? step.shot
            : null,
          confidence: step.confidence,
          reason: step.reason,
        });
      }

      framesAnalyzed += 1;
      samplesCompleted += 1;
      options.onProgress?.(samplesCompleted, frameTimes.length);
      if (framesAnalyzed % 4 === 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    }

    const diagnostics = buildVideoAnalysisDiagnostics(
      framesAnalyzed,
      duplicateFramesSkipped,
      largestFrameGapMs,
      stability.cameraMotionEvents,
    );
    return {
      durationSeconds,
      framesAnalyzed,
      decisions: applyVideoQualityGate(decisions, diagnostics),
      diagnostics,
    };
  } finally {
    disposeVideo(video);
  }
}
