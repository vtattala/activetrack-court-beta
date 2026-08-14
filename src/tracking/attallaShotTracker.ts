import type { ShotKind } from "../../types/tracking";

/**
 * Detector observation consumed by the MIT-licensed Attalla shot pipeline.
 * Coordinates are pixels in one consistently sized decoded frame.
 */
export interface AttallaObjectDetection {
  kind: "ball" | "hoop";
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

interface TimedObjectDetection extends AttallaObjectDetection {
  atMs: number;
}

interface TrackedHoop extends TimedObjectDetection {
  id: number;
}

interface TrackedBall {
  id: number;
  detections: TimedObjectDetection[];
}

interface BallHoopPair {
  ballId: number;
  hoopId: number;
}

export interface AttallaShotTrackerState {
  hoops: TrackedHoop[];
  balls: TrackedBall[];
  armedPairs: BallHoopPair[];
  nextHoopId: number;
  nextBallId: number;
  lastShotAt: number;
}

export interface AttallaShotDecision {
  kind: ShotKind;
  atMs: number;
  confidence: number;
  crossingX: number;
  hoopId: number;
  ballId: number;
}

export interface AttallaShotTrackerStep {
  state: AttallaShotTrackerState;
  decisions: AttallaShotDecision[];
}

// The source drops a track after 20 input frames. The public reference clip is
// 28.89 FPS, so a timestamp window is the frame-rate-safe equivalent.
const TRACK_STALE_MS = 720;
const MAX_BALL_HISTORY = 30;
const SHOT_COOLDOWN_MS = 1_200;
const BALL_CONFIDENCE = 0.4;
const NEAR_HOOP_BALL_CONFIDENCE = 0.3;
const HOOP_CONFIDENCE = 0.3;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function distance(left: TimedObjectDetection, right: TimedObjectDetection): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function diagonal(detection: TimedObjectDetection): number {
  return Math.hypot(detection.width, detection.height);
}

function hasPair(pairs: BallHoopPair[], ballId: number): boolean {
  return pairs.some((pair) => pair.ballId === ballId);
}

function cloneState(state: AttallaShotTrackerState): AttallaShotTrackerState {
  return {
    ...state,
    hoops: state.hoops.map((hoop) => ({ ...hoop })),
    balls: state.balls.map((ball) => ({
      ...ball,
      detections: ball.detections.map((detection) => ({ ...detection })),
    })),
    armedPairs: state.armedPairs.map((pair) => ({ ...pair })),
  };
}

function isInsideHoopArea(
  ball: TimedObjectDetection,
  hoops: TrackedHoop[],
): boolean {
  return hoops.some((hoop) =>
    ball.x > hoop.x - hoop.width * 2 &&
    ball.x < hoop.x + hoop.width * 2 &&
    ball.y > hoop.y + hoop.height / 2 - hoop.height * 3 &&
    ball.y < hoop.y + hoop.height / 2
  );
}

function cleanTracks(state: AttallaShotTrackerState, atMs: number): void {
  state.balls = state.balls
    .filter((ball) => {
      const latest = ball.detections.at(-1);
      return latest !== undefined && atMs - latest.atMs <= TRACK_STALE_MS;
    })
    .map((ball) => ({
      ...ball,
      detections: ball.detections.slice(-MAX_BALL_HISTORY),
    }));
  state.hoops = state.hoops.filter((hoop) => atMs - hoop.atMs <= TRACK_STALE_MS);
  const ballIds = new Set(state.balls.map((ball) => ball.id));
  const hoopIds = new Set(state.hoops.map((hoop) => hoop.id));
  state.armedPairs = state.armedPairs.filter((pair) =>
    ballIds.has(pair.ballId) && hoopIds.has(pair.hoopId)
  );
}

function addHoop(state: AttallaShotTrackerState, detection: TimedObjectDetection): number | null {
  if (detection.confidence < HOOP_CONFIDENCE) return null;
  for (let index = 0; index < state.hoops.length; index += 1) {
    const existing = state.hoops[index];
    if (!existing) continue;
    if (distance(existing, detection) < diagonal(existing)) {
      state.hoops[index] = { ...detection, id: existing.id };
      return existing.id;
    }
  }
  const id = state.nextHoopId;
  state.nextHoopId += 1;
  state.hoops.push({ ...detection, id });
  return id;
}

function addBall(state: AttallaShotTrackerState, detection: TimedObjectDetection): number | null {
  const nearHoop = isInsideHoopArea(detection, state.hoops);
  if (
    detection.confidence < BALL_CONFIDENCE &&
    !(nearHoop && detection.confidence > NEAR_HOOP_BALL_CONFIDENCE)
  ) {
    return null;
  }

  let closest: TrackedBall | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const ball of state.balls) {
    const latest = ball.detections.at(-1);
    if (!latest) continue;
    const candidateDistance = distance(latest, detection);
    const multiplier = hasPair(state.armedPairs, ball.id) ? 4 : 2;
    if (
      candidateDistance < diagonal(latest) * multiplier &&
      candidateDistance < closestDistance
    ) {
      closest = ball;
      closestDistance = candidateDistance;
    }
  }

  if (closest) {
    closest.detections.push(detection);
    if (closest.detections.length > MAX_BALL_HISTORY) closest.detections.shift();
    return closest.id;
  }

  const id = state.nextBallId;
  state.nextBallId += 1;
  state.balls.push({ id, detections: [detection] });
  return id;
}

function armApproachingBalls(state: AttallaShotTrackerState): void {
  for (const ball of state.balls) {
    if (
      ball.detections.length < 3 ||
      hasPair(state.armedPairs, ball.id)
    ) {
      continue;
    }
    const latest = ball.detections.at(-1);
    if (!latest) continue;
    for (const hoop of state.hoops) {
      if (hoop.width * hoop.height < latest.width * latest.height) continue;
      const insideBackboardArea =
        latest.x > hoop.x - hoop.width * 2 &&
        latest.x < hoop.x + hoop.width * 2 &&
        latest.y > hoop.y - hoop.height * 3 &&
        latest.y < hoop.y;
      if (insideBackboardArea) {
        state.armedPairs.push({ ballId: ball.id, hoopId: hoop.id });
        break;
      }
    }
  }
}

function scoreCompletedPairs(
  state: AttallaShotTrackerState,
  atMs: number,
): AttallaShotDecision[] {
  const decisions: AttallaShotDecision[] = [];
  const remainingPairs: BallHoopPair[] = [];

  for (const pair of state.armedPairs) {
    const ball = state.balls.find((candidate) => candidate.id === pair.ballId);
    const hoop = state.hoops.find((candidate) => candidate.id === pair.hoopId);
    const below = ball?.detections.at(-1);
    if (!ball || !hoop || !below) continue;
    if (below.y <= hoop.y + hoop.height / 2) {
      remainingPairs.push(pair);
      continue;
    }

    const hoopTop = hoop.y - hoop.height / 2;
    const above = [...ball.detections].reverse().find((detection) => detection.y < hoopTop);
    if (!above) continue;
    const verticalTravel = below.y - above.y;
    if (verticalTravel <= 0.0001) continue;

    const crossingX = above.x +
      ((hoop.y - above.y) / verticalTravel) * (below.x - above.x);
    const halfWidth = Math.max(0.0001, hoop.width / 2);
    const normalizedOffset = Math.abs(crossingX - hoop.x) / halfWidth;
    const kind: ShotKind = normalizedOffset < 1 ? "make" : "miss";
    const geometryConfidence = kind === "make"
      ? clamp(1 - normalizedOffset)
      : clamp(normalizedOffset - 1);
    const detectionConfidence = clamp(
      (above.confidence + below.confidence + hoop.confidence) / 3,
    );
    const spanConfidence = clamp(verticalTravel / Math.max(1, hoop.height * 1.5));
    const confidence = clamp(
      0.72 + detectionConfidence * 0.18 + geometryConfidence * 0.07 + spanConfidence * 0.03,
    );

    if (atMs - state.lastShotAt >= SHOT_COOLDOWN_MS) {
      decisions.push({
        kind,
        atMs,
        confidence,
        crossingX,
        hoopId: hoop.id,
        ballId: ball.id,
      });
      state.lastShotAt = atMs;
    }
  }

  state.armedPairs = remainingPairs;
  return decisions;
}

export function createAttallaShotTrackerState(): AttallaShotTrackerState {
  return {
    hoops: [],
    balls: [],
    armedPairs: [],
    nextHoopId: 0,
    nextBallId: 0,
    lastShotAt: Number.NEGATIVE_INFINITY,
  };
}

/**
 * TypeScript port of josephattalla/Basketball-Shot-Detection's detector-driven
 * ball/hoop association and above-rim -> below-net crossing classifier.
 * Source defects are fixed with timestamp-based expiry, a vertical-safe line
 * interpolation, deterministic nearest-track matching, and duplicate cooldown.
 */
export function stepAttallaShotTracker(
  current: AttallaShotTrackerState,
  detections: AttallaObjectDetection[],
  atMs: number,
): AttallaShotTrackerStep {
  const state = cloneState(current);
  const decisions: AttallaShotDecision[] = [];
  cleanTracks(state, atMs);

  for (const detection of detections) {
    if (
      !Number.isFinite(detection.x) ||
      !Number.isFinite(detection.y) ||
      !Number.isFinite(detection.width) ||
      !Number.isFinite(detection.height) ||
      detection.width <= 0 ||
      detection.height <= 0
    ) {
      continue;
    }
    const timed = { ...detection, atMs };
    if (detection.kind === "hoop") addHoop(state, timed);
    else addBall(state, timed);
    armApproachingBalls(state);
    decisions.push(...scoreCompletedPairs(state, atMs));
  }

  return { state, decisions };
}
