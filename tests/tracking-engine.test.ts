import assert from "node:assert/strict";
import test from "node:test";

import {
  createTrackerEngineState,
  MIN_AUTOMATIC_DECISION_CONFIDENCE,
  stepTracker,
} from "../src/tracking/engine";
import type { BallDetection, RimCalibration, TrackerEngineState } from "../types/tracking";

const rim: RimCalibration = { x: 0.4, y: 0.2, width: 0.2, height: 0.05 };

function ball(x: number, y: number, at: number): BallDetection {
  return { x, y, at, width: 0.05, height: 0.05, confidence: 0.9 };
}

function step(
  state: TrackerEngineState,
  detection: BallDetection | null,
  now: number,
) {
  return stepTracker(state, detection, rim, now);
}

test("counts a downward crossing through the rim as a make", () => {
  let state = createTrackerEngineState();
  state = step(state, ball(0.5, 0.42, 0), 0).state;
  state = step(state, ball(0.5, 0.17, 100), 100).state;
  state = step(state, ball(0.5, 0.12, 200), 200).state;
  const result = step(state, ball(0.5, 0.25, 450), 450);
  assert.equal(result.shot, "make");
  assert.ok(result.confidence >= MIN_AUTOMATIC_DECISION_CONFIDENCE);
  assert.equal(result.reason, "rim-crossing");
  assert.equal(result.state.armed, false);
});

test("counts a right-adjacent airball as a miss", () => {
  let state = createTrackerEngineState();
  state = step(state, ball(0.65, 0.44, 0), 0).state;
  state = step(state, ball(0.65, 0.17, 100), 100).state;
  state = step(state, ball(0.65, 0.12, 200), 200).state;
  const result = step(state, ball(0.65, 0.25, 500), 500);
  assert.equal(result.shot, "miss");
  assert.ok(result.confidence >= MIN_AUTOMATIC_DECISION_CONFIDENCE);
  assert.equal(result.reason, "airball");
});

test("does not arm on an object that only descends through the rim", () => {
  let state = createTrackerEngineState();
  state = step(state, ball(0.5, 0.1, 0), 0).state;
  state = step(state, ball(0.5, 0.18, 100), 100).state;
  const result = step(state, ball(0.5, 0.27, 200), 200);
  assert.equal(result.shot, null);
  assert.equal(result.state.armed, false);
});

test("does not call a miss while the ball is still rising", () => {
  let state = createTrackerEngineState();
  state = step(state, ball(0.5, 0.44, 0), 0).state;
  state = step(state, ball(0.5, 0.17, 100), 100).state;
  state = step(state, ball(0.5, 0.12, 200), 200).state;
  const result = step(state, ball(0.84, 0.1, 300), 300);
  assert.equal(result.shot, null);
});

test("counts a descending shot that leaves the expanded rim lane as a miss", () => {
  let state = createTrackerEngineState();
  state = step(state, ball(0.5, 0.44, 0), 0).state;
  state = step(state, ball(0.5, 0.17, 100), 100).state;
  state = step(state, ball(0.5, 0.12, 200), 200).state;
  state = step(state, ball(0.84, 0.1, 300), 300).state;
  const result = step(state, ball(0.84, 0.17, 550), 550);
  assert.equal(result.shot, "miss");
  assert.ok(result.confidence >= MIN_AUTOMATIC_DECISION_CONFIDENCE);
});

test("marks a lost-ball shot as too uncertain for automatic counting", () => {
  let state = createTrackerEngineState();
  state = step(state, ball(0.5, 0.44, 0), 0).state;
  state = step(state, ball(0.5, 0.17, 100), 100).state;
  state = step(state, ball(0.5, 0.12, 200), 200).state;
  const result = step(state, null, 1_101);
  assert.equal(result.shot, "miss");
  assert.ok(result.confidence < MIN_AUTOMATIC_DECISION_CONFIDENCE);
  assert.equal(result.reason, "lost");
});

test("uses the interpolated rim-plane position instead of the next frame position", () => {
  let state = createTrackerEngineState();
  state = step(state, ball(0.48, 0.42, 0), 0).state;
  state = step(state, ball(0.48, 0.17, 100), 100).state;
  state = step(state, ball(0.48, 0.12, 200), 200).state;
  const result = step(state, ball(0.6, 0.3, 450), 450);
  assert.equal(result.shot, "make");
  assert.equal(result.reason, "rim-crossing");
});

test("routes a near-edge rim crossing to review instead of automatic counting", () => {
  let state = createTrackerEngineState();
  state = step(state, ball(0.57, 0.42, 0), 0).state;
  state = step(state, ball(0.57, 0.17, 100), 100).state;
  state = step(state, ball(0.57, 0.12, 200), 200).state;
  const result = step(state, ball(0.57, 0.25, 450), 450);
  assert.equal(result.shot, "make");
  assert.ok(result.confidence < MIN_AUTOMATIC_DECISION_CONFIDENCE);
});

test("suppresses duplicate shot events during the cooldown", () => {
  let state = createTrackerEngineState();
  state = step(state, ball(0.5, 0.42, 0), 0).state;
  state = step(state, ball(0.5, 0.17, 100), 100).state;
  state = step(state, ball(0.5, 0.12, 200), 200).state;
  const first = step(state, ball(0.5, 0.25, 450), 450);
  assert.equal(first.shot, "make");

  state = step(first.state, ball(0.5, 0.42, 550), 550).state;
  state = step(state, ball(0.5, 0.17, 650), 650).state;
  state = step(state, ball(0.5, 0.12, 750), 750).state;
  const duplicate = step(state, ball(0.5, 0.25, 900), 900);
  assert.equal(duplicate.shot, null);
});
