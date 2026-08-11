import type {
  BallDetection,
  RimCalibration,
  ShotKind,
  TrackerEngineState,
  TrackerStep,
} from "../../types/tracking";

export const SHOT_COOLDOWN_MS = 1_650;
export const LOST_BALL_MISS_MS = 900;
export const MAX_SHOT_FLIGHT_MS = 2_800;
export const MIN_AUTOMATIC_DECISION_CONFIDENCE = 0.86;
const MAX_TRAJECTORY_POINTS = 24;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function createTrackerEngineState(): TrackerEngineState {
  return {
    armed: false,
    armedAt: 0,
    lastDetectedAt: 0,
    lastShotAt: -SHOT_COOLDOWN_MS,
    previous: null,
    trajectory: [],
    ascendingFrames: 0,
    descendingFrames: 0,
    apexY: 1,
  };
}

function finishShot(
  state: TrackerEngineState,
  shot: ShotKind,
  now: number,
  confidence: number,
  reason: TrackerStep["reason"],
): TrackerStep {
  if (now - state.lastShotAt < SHOT_COOLDOWN_MS) {
    return {
      state: {
        ...state,
        armed: false,
        armedAt: 0,
        trajectory: [],
        ascendingFrames: 0,
        descendingFrames: 0,
        apexY: 1,
      },
      shot: null,
      confidence: 0,
      reason: "cooldown",
    };
  }

  return {
    state: {
      ...state,
      armed: false,
      armedAt: 0,
      lastShotAt: now,
      trajectory: [],
      ascendingFrames: 0,
      descendingFrames: 0,
      apexY: 1,
    },
    shot,
    confidence: clamp(confidence, 0, 1),
    reason,
  };
}

export function stepTracker(
  current: TrackerEngineState,
  detection: BallDetection | null,
  rim: RimCalibration,
  now: number,
): TrackerStep {
  if (!detection) {
    if (
      current.armed &&
      current.lastDetectedAt > 0 &&
      now - current.lastDetectedAt > LOST_BALL_MISS_MS
    ) {
      const visualConfidence = current.previous?.confidence ?? 0.5;
      return finishShot(
        current,
        "miss",
        now,
        0.54 + visualConfidence * 0.18,
        "lost",
      );
    }
    return { state: current, shot: null, confidence: 0, reason: "none" };
  }

  const previous = current.previous;
  const trajectory = [...current.trajectory, detection].slice(-MAX_TRAJECTORY_POINTS);
  let next: TrackerEngineState = {
    ...current,
    lastDetectedAt: now,
    previous: detection,
    trajectory,
    apexY: Math.min(current.apexY, detection.y),
  };

  if (!previous || detection.at <= previous.at) {
    return { state: next, shot: null, confidence: 0, reason: "none" };
  }

  const deltaY = detection.y - previous.y;
  const movingUp = deltaY < -0.003;
  const movingDown = deltaY > 0.003;
  next = {
    ...next,
    ascendingFrames: movingUp
      ? Math.min(8, current.ascendingFrames + 1)
      : current.armed
        ? current.ascendingFrames
        : Math.max(0, current.ascendingFrames - 1),
    descendingFrames: movingDown
      ? Math.min(8, current.descendingFrames + 1)
      : movingUp
        ? 0
        : current.descendingFrames,
  };

  const rimLeft = rim.x;
  const rimRight = rim.x + rim.width;
  const rimPlaneY = rim.y + rim.height * 0.48;
  const expandedLeft = rimLeft - rim.width * 0.95;
  const expandedRight = rimRight + rim.width * 0.95;
  const inApproachLane = detection.x > expandedLeft && detection.x < expandedRight;
  const aboveRim = detection.y < rimPlaneY - rim.height * 0.18;

  if (
    !next.armed &&
    inApproachLane &&
    aboveRim &&
    movingUp &&
    next.ascendingFrames >= 2
  ) {
    next = {
      ...next,
      armed: true,
      armedAt: now,
      apexY: Math.min(previous.y, detection.y),
      descendingFrames: 0,
    };
  }

  if (!next.armed) {
    return { state: next, shot: null, confidence: 0, reason: "none" };
  }

  const crossedDown =
    movingDown &&
    previous.y < rimPlaneY &&
    detection.y >= rimPlaneY;
  const averageBallRadiusX = (previous.width + detection.width) * 0.25;
  const centerInset = clamp(
    Math.max(rim.width * 0.14, averageBallRadiusX * 0.72),
    rim.width * 0.14,
    rim.width * 0.3,
  );
  const safeLeft = rimLeft + centerInset;
  const safeRight = rimRight - centerInset;

  if (crossedDown) {
    const crossingRatio = clamp(
      (rimPlaneY - previous.y) / Math.max(0.0001, detection.y - previous.y),
      0,
      1,
    );
    const crossingX = previous.x + (detection.x - previous.x) * crossingRatio;
    const throughOpening = crossingX > safeLeft && crossingX < safeRight;
    const nearestBoundary = Math.min(
      Math.abs(crossingX - safeLeft),
      Math.abs(crossingX - safeRight),
    );
    const ambiguousBoundary = nearestBoundary < rim.width * 0.055;
    const visualConfidence = Math.min(previous.confidence, detection.confidence);
    const trajectorySpan = Math.max(0, rimPlaneY - next.apexY);
    const spanConfidence = clamp(trajectorySpan / Math.max(0.001, rim.height * 1.6), 0, 1);
    const elapsedSeconds = (detection.at - previous.at) / 1_000;
    const downwardSpeed = elapsedSeconds > 0 ? deltaY / elapsedSeconds : 0;
    const speedConfidence = clamp((downwardSpeed - 0.08) / 1.1, 0, 1);
    const evidenceConfidence =
      0.78 + visualConfidence * 0.13 + spanConfidence * 0.05 + speedConfidence * 0.04;
    const confidence = ambiguousBoundary
      ? Math.min(0.8, evidenceConfidence)
      : evidenceConfidence;

    return finishShot(
      next,
      throughOpening ? "make" : "miss",
      now,
      confidence,
      throughOpening ? "rim-crossing" : "airball",
    );
  }

  const belowRim = detection.y > rimPlaneY + rim.height * 2.8;
  const outsideOpening = detection.x <= safeLeft || detection.x >= safeRight;
  const leftExpandedLane = detection.x < expandedLeft || detection.x > expandedRight;
  const timedOut = now - next.armedAt > MAX_SHOT_FLIGHT_MS;
  const hasClearDescent = movingDown && next.descendingFrames >= 1;

  if (
    hasClearDescent &&
    now - next.armedAt > 320 &&
    ((belowRim && outsideOpening) || leftExpandedLane)
  ) {
    const visualConfidence = Math.min(previous.confidence, detection.confidence);
    return finishShot(
      next,
      "miss",
      now,
      0.84 + visualConfidence * 0.13,
      "airball",
    );
  }

  if (timedOut) {
    return finishShot(next, "miss", now, 0.68, "timeout");
  }

  return { state: next, shot: null, confidence: 0, reason: "none" };
}
