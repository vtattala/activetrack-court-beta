import {
  createTrackerEngineState,
  MIN_AUTOMATIC_DECISION_CONFIDENCE,
  stepTracker,
} from "../tracking/engine";
import type {
  RimCalibration,
  VideoAnalysisResult,
  VideoShotDecision,
} from "../../types/tracking";
import { createVisionTrackState, selectTrackedBall } from "./ballTracker";
import { detectBasketballCandidates } from "./pixelBallDetector";
import { selectHoopZoneCandidates } from "./hoopZone";
import { createRimTrackState, stepRimTracker } from "./rimTracker";
import {
  alignTrackerEngineToRimShift,
  alignVisionTrackToRimShift,
} from "./trackingAlignment";
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
const ANALYSIS_MAX_WIDTH = 640;
const ANALYSIS_MAX_HEIGHT = 640;

export interface VideoPreview {
  uri: string;
  width: number;
  height: number;
  durationSeconds: number;
  atSeconds: number;
}

export interface VideoAnalysisOptions {
  durationSeconds?: number;
  rimCalibrationTimeSeconds?: number;
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
    const timeout = window.setTimeout(
      () => finish(new Error("The selected video took too long to load.")),
      15_000,
    );

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

function frameGray(pixels: ImageData): Uint8Array {
  const gray = new Uint8Array(pixels.width * pixels.height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    gray[index] = Math.round(
      (pixels.data[offset] ?? 0) * 0.299 +
      (pixels.data[offset + 1] ?? 0) * 0.587 +
      (pixels.data[offset + 2] ?? 0) * 0.114,
    );
  }
  return gray;
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
    const canvas = createFrameCanvas(video, 960, 960);
    drawVideoFrame(video, canvas);
    return {
      uri: canvas.toDataURL("image/jpeg", 0.92),
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
  let ballCandidateFrames = 0;
  let ballTrackedFrames = 0;

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

    const calibrationTime = Math.max(
      0,
      Math.min(
        options.rimCalibrationTimeSeconds ?? Math.min(1, durationSeconds * 0.08),
        Math.max(0, durationSeconds - 0.02),
      ),
    );
    await seekVideo(video, calibrationTime);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const calibrationPixels = context.getImageData(0, 0, canvas.width, canvas.height);
    let rimTrack = createRimTrackState(
      frameGray(calibrationPixels),
      canvas.width,
      canvas.height,
      rim,
    );
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

      const detectionFrame = detectBasketballCandidates(
        pixels,
        previousGray,
        timestamp,
        rimTrack.rim,
      );
      const lostRimFramesBeforeStep = rimTrack.consecutiveLostFrames;
      const rimStep = stepRimTracker(
        detectionFrame.gray,
        canvas.width,
        canvas.height,
        rimTrack,
      );
      rimTrack = rimStep.state;
      if (rimStep.found && lostRimFramesBeforeStep < 4) {
        visionTrack = alignVisionTrackToRimShift(
          visionTrack,
          rimStep.displacementX,
          rimStep.displacementY,
        );
        tracker = alignTrackerEngineToRimShift(
          tracker,
          rimStep.displacementX,
          rimStep.displacementY,
        );
      } else if (lostRimFramesBeforeStep >= 4) {
        const lastShotAt = tracker.lastShotAt;
        visionTrack = createVisionTrackState();
        tracker = { ...createTrackerEngineState(), lastShotAt };
      }

      let changedPixels = 0;
      if (previousGray && previousGray.length === detectionFrame.gray.length) {
        for (let index = 0; index < detectionFrame.gray.length; index += 1) {
          if (Math.abs((detectionFrame.gray[index] ?? 0) - (previousGray[index] ?? 0)) >= 38) {
            changedPixels += 1;
          }
        }
      }
      const changedPixelRatio = previousGray
        ? changedPixels / Math.max(1, detectionFrame.gray.length)
        : 0;
      stability = stepVideoStability(stability, changedPixelRatio);
      previousGray = detectionFrame.gray;

      if (!rimStep.found) {
        if (rimStep.state.consecutiveLostFrames >= 2) {
          const lastShotAt = tracker.lastShotAt;
          visionTrack = createVisionTrackState();
          tracker = { ...createTrackerEngineState(), lastShotAt };
        }
        framesAnalyzed += 1;
        samplesCompleted += 1;
        options.onProgress?.(samplesCompleted, frameTimes.length);
        if (framesAnalyzed % 3 === 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
        continue;
      }

      const hoopCandidates = selectHoopZoneCandidates(
        detectionFrame.candidates,
        rimStep.rim,
        canvas.width,
        canvas.height,
      );
      if (hoopCandidates.length > 0) ballCandidateFrames += 1;
      const selection = selectTrackedBall(
        hoopCandidates,
        visionTrack,
        rimStep.rim,
        timestamp,
      );
      visionTrack = selection.state;
      if (selection.detection) ballTrackedFrames += 1;

      const step = stepTracker(tracker, selection.detection, rimStep.rim, timestamp);
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
      if (step.shot || step.reason === "cooldown") {
        visionTrack = createVisionTrackState();
      } else if (!visionTrack.current && !tracker.armed && tracker.previous) {
        const lastShotAt = tracker.lastShotAt;
        tracker = { ...createTrackerEngineState(), lastShotAt };
      }

      framesAnalyzed += 1;
      samplesCompleted += 1;
      options.onProgress?.(samplesCompleted, frameTimes.length);
      if (framesAnalyzed % 3 === 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    }

    const diagnostics = buildVideoAnalysisDiagnostics(
      framesAnalyzed,
      duplicateFramesSkipped,
      largestFrameGapMs,
      stability.cameraMotionEvents,
      {
        rimTrackedFrames: rimTrack.trackedFrames,
        rimTrackingLostFrames: rimTrack.lostFrames,
        averageRimTrackingConfidence:
          rimTrack.confidenceTotal / Math.max(1, rimTrack.framesProcessed),
        rimGlobalReacquisitions: rimTrack.globalReacquisitions,
        ballCandidateFrames,
        ballTrackedFrames,
      },
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
