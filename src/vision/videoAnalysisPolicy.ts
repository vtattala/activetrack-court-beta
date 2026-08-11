import type {
  RimCalibration,
  VideoAnalysisDiagnostics,
  VideoShotDecision,
} from "../../types/tracking";

export const IMPORT_ANALYSIS_FPS = 15;
export const MAX_IMPORT_DURATION_SECONDS = 300;
const DUPLICATE_TIMESTAMP_TOLERANCE_MS = 2;
const MAX_RELIABLE_FRAME_GAP_MS = 350;
const MAX_DUPLICATE_SAMPLE_RATIO = 0.08;

export interface VideoSampleTiming {
  timestampMs: number;
  atSeconds: number;
  gapMs: number;
  duplicate: boolean;
}

export interface VideoStabilityState {
  highMotionStreak: number;
  cooldownFrames: number;
  cameraMotionEvents: number;
}

export interface VideoTrackingQuality {
  rimTrackedFrames?: number;
  rimTrackingLostFrames?: number;
  averageRimTrackingConfidence?: number;
  ballCandidateFrames?: number;
  ballTrackedFrames?: number;
}

export function createVideoStabilityState(): VideoStabilityState {
  return { highMotionStreak: 0, cooldownFrames: 0, cameraMotionEvents: 0 };
}

export function stepVideoStability(
  state: VideoStabilityState,
  changedPixelRatio: number,
): VideoStabilityState {
  const cooldownFrames = Math.max(0, state.cooldownFrames - 1);
  const highMotion = changedPixelRatio >= 0.38;
  const highMotionStreak = highMotion ? state.highMotionStreak + 1 : 0;
  const cameraMotion = cooldownFrames === 0 &&
    (changedPixelRatio >= 0.72 || highMotionStreak >= 2);
  return {
    highMotionStreak: cameraMotion ? 0 : highMotionStreak,
    cooldownFrames: cameraMotion ? IMPORT_ANALYSIS_FPS : cooldownFrames,
    cameraMotionEvents: state.cameraMotionEvents + (cameraMotion ? 1 : 0),
  };
}

export function buildVideoFrameTimes(durationSeconds: number): number[] {
  const safeDuration = Math.max(0.02, durationSeconds);
  const frameCount = Math.max(1, Math.floor(safeDuration * IMPORT_ANALYSIS_FPS));
  return Array.from({ length: frameCount }, (_, index) =>
    Math.max(
      0,
      Math.min(safeDuration - 0.02, (index + 0.5) / IMPORT_ANALYSIS_FPS),
    )
  );
}

export function resolveVideoSampleTiming(
  requestedTimeSeconds: number,
  actualTimeSeconds: number | null | undefined,
  previousTimestampMs: number | null,
): VideoSampleTiming {
  const resolvedSeconds = Number.isFinite(actualTimeSeconds)
    ? Math.max(0, actualTimeSeconds ?? requestedTimeSeconds)
    : Math.max(0, requestedTimeSeconds);
  const timestampMs = Math.round(resolvedSeconds * 1_000);
  const gapMs = previousTimestampMs === null
    ? 0
    : Math.max(0, timestampMs - previousTimestampMs);
  return {
    timestampMs,
    atSeconds: resolvedSeconds,
    gapMs,
    duplicate: previousTimestampMs !== null &&
      timestampMs <= previousTimestampMs + DUPLICATE_TIMESTAMP_TOLERANCE_MS,
  };
}

export function validateVideoRimCalibration(rim: RimCalibration): string | null {
  const values = [rim.x, rim.y, rim.width, rim.height];
  if (values.some((value) => !Number.isFinite(value))) {
    return "Draw the rim box again.";
  }
  if (
    rim.x < 0 ||
    rim.y < 0 ||
    rim.width <= 0 ||
    rim.height <= 0 ||
    rim.x + rim.width > 1.001 ||
    rim.y + rim.height > 1.001
  ) {
    return "Keep the complete rim box inside the video frame.";
  }
  if (rim.width < 0.035 || rim.height < 0.012) {
    return "The rim box is too small. Draw tightly around the full opening.";
  }
  if (rim.width > 0.5 || rim.height > 0.28) {
    return "The rim box is too large. Include only the hoop opening.";
  }
  const aspectRatio = rim.width / rim.height;
  if (aspectRatio < 1.4) {
    return "The rim box should be wider than it is tall.";
  }
  if (aspectRatio > 14) {
    return "The rim box is too thin. Include the full height of the opening.";
  }
  return null;
}

export function buildVideoAnalysisDiagnostics(
  framesAnalyzed: number,
  duplicateFramesSkipped: number,
  largestFrameGapMs: number,
  cameraMotionEvents = 0,
  tracking: VideoTrackingQuality = {},
): VideoAnalysisDiagnostics {
  const totalSamples = framesAnalyzed + duplicateFramesSkipped;
  const duplicateRatio = totalSamples > 0
    ? duplicateFramesSkipped / totalSamples
    : 0;
  const warnings: string[] = [];
  if (duplicateRatio > MAX_DUPLICATE_SAMPLE_RATIO) {
    warnings.push(
      "The video decoder returned too many repeated or unreadable frames, so every detected shot requires review.",
    );
  }
  if (largestFrameGapMs > MAX_RELIABLE_FRAME_GAP_MS) {
    warnings.push(
      "The video contains a long frame gap, so every detected shot requires review.",
    );
  }
  const rimTrackedFrames = tracking.rimTrackedFrames ?? 0;
  const rimTrackingLostFrames = tracking.rimTrackingLostFrames ?? 0;
  const rimTrackingSamples = rimTrackedFrames + rimTrackingLostFrames;
  const rimLostRatio = rimTrackingSamples > 0
    ? rimTrackingLostFrames / rimTrackingSamples
    : 1;
  const rimTrackingVerified =
    rimTrackingSamples > 0 &&
    rimLostRatio <= 0.12 &&
    (tracking.averageRimTrackingConfidence ?? 0) >= 0.56;
  if (cameraMotionEvents > 0 && !rimTrackingVerified) {
    warnings.push(
      "Camera movement or a cut exceeded the hoop track, so every detected shot requires review.",
    );
  }
  if (rimTrackingSamples > 0 && rimLostRatio > 0.12) {
    warnings.push(
      "The hoop could not be locked in enough frames, so every detected shot requires review.",
    );
  }
  return {
    analysisFps: IMPORT_ANALYSIS_FPS,
    duplicateFramesSkipped,
    largestFrameGapMs,
    cameraMotionEvents,
    rimTrackedFrames,
    rimTrackingLostFrames,
    averageRimTrackingConfidence: tracking.averageRimTrackingConfidence ?? 0,
    ballCandidateFrames: tracking.ballCandidateFrames ?? 0,
    ballTrackedFrames: tracking.ballTrackedFrames ?? 0,
    requiresFullReview: warnings.length > 0,
    warnings,
  };
}

export function applyVideoQualityGate(
  decisions: VideoShotDecision[],
  diagnostics: VideoAnalysisDiagnostics,
): VideoShotDecision[] {
  if (!diagnostics.requiresFullReview) return decisions;
  return decisions.map((decision) => ({ ...decision, finalKind: null }));
}
