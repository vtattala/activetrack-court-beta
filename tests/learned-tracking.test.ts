import assert from "node:assert/strict";
import test from "node:test";
import { Tracker as ByteTracker } from "byte-track-ts";
import type { BallDetection, RimCalibration } from "../types/tracking";
import {
  chooseCalibrationHoop,
  chooseAutomaticHoop,
  createHoopRimAnchor,
  mergeLearnedAndMotionCandidates,
  pixelBoxToBallDetection,
  rimFromTrackedHoop,
  rimFromAutomaticHoop,
  toByteTrackDetections,
  trackRowToPixelBox,
  type PixelBox,
} from "../src/vision/learnedTracking";

const frameWidth = 640;
const frameHeight = 360;
const rim: RimCalibration = { x: 0.7, y: 0.29, width: 0.09, height: 0.035 };

test("calibration chooses the learned hoop surrounding the marked rim", () => {
  const selected = chooseCalibrationHoop(
    [
      { left: 40, top: 50, right: 130, bottom: 150, confidence: 0.96 },
      { left: 430, top: 75, right: 530, bottom: 170, confidence: 0.88 },
    ],
    rim,
    frameWidth,
    frameHeight,
  );
  assert.ok(selected);
  assert.equal(selected.left, 430);
});

test("automatic calibration selects the strongest visible hoop", () => {
  const selected = chooseAutomaticHoop(
    [
      { left: 40, top: 50, right: 90, bottom: 100, confidence: 0.31 },
      { left: 430, top: 75, right: 530, bottom: 175, confidence: 0.9 },
    ],
    frameWidth,
    frameHeight,
  );
  assert.ok(selected);
  assert.equal(selected.hoop.left, 430);
  assert.equal(selected.ambiguous, false);
});

test("automatic hoop geometry produces a narrow valid rim opening", () => {
  const automatic = rimFromAutomaticHoop(
    { left: 430, top: 75, right: 530, bottom: 175, confidence: 0.9 },
    frameWidth,
    frameHeight,
  );
  assert.ok(automatic.width >= 0.035);
  assert.ok(automatic.height >= 0.012);
  assert.ok((automatic.width * frameWidth) / (automatic.height * frameHeight) > 3);
  assert.ok(automatic.y < 0.36);
});

test("rim anchor follows learned hoop translation and scale", () => {
  const calibrationHoop: PixelBox = {
    left: 430,
    top: 75,
    right: 530,
    bottom: 175,
    confidence: 0.9,
  };
  const anchor = createHoopRimAnchor(rim, calibrationHoop, frameWidth, frameHeight);
  const trackedHoop: PixelBox = {
    left: 300,
    top: 95,
    right: 420,
    bottom: 215,
    confidence: 0.92,
  };
  const trackedRim = rimFromTrackedHoop(
    trackedHoop,
    anchor,
    frameWidth,
    frameHeight,
  );
  assert.ok(trackedRim.x < rim.x - 0.15);
  assert.ok(trackedRim.y > rim.y);
  assert.ok(trackedRim.width > rim.width);
  assert.ok(Math.abs(trackedRim.width / rim.width - 1.2) < 0.02);
});

test("learned detections suppress duplicate motion candidates but preserve gap fillers", () => {
  const learned: BallDetection[] = [{
    x: 0.5,
    y: 0.4,
    width: 0.04,
    height: 0.04,
    confidence: 0.95,
    at: 100,
  }];
  const motion: BallDetection[] = [
    { ...learned[0]!, x: 0.51, confidence: 0.7 },
    { ...learned[0]!, x: 0.72, confidence: 0.72 },
  ];
  const merged = mergeLearnedAndMotionCandidates(learned, motion);
  assert.equal(merged.length, 2);
  assert.equal(merged[0], learned[0]);
  assert.equal(merged[1]?.x, 0.72);
});

test("does not promote a weak untracked learned box to a certain basketball", () => {
  const untracked = pixelBoxToBallDetection(
    { left: 10, top: 10, right: 20, bottom: 20, confidence: 0.03 },
    100,
    100,
    0,
  );
  const tracked = pixelBoxToBallDetection(
    { left: 10, top: 10, right: 20, bottom: 20, confidence: 0.7, trackId: 4 },
    100,
    100,
    0,
  );
  assert.ok(untracked.confidence < 0.6);
  assert.ok((untracked.motionConfidence ?? 1) < 0.36);
  assert.ok((tracked.motionConfidence ?? 0) > 0.8);
});

test("ByteTrack keeps a stable ID for a moving hoop", () => {
  const tracker = new ByteTracker({
    track_high_thresh: 0.4,
    track_low_thresh: 0.08,
    new_track_thresh: 0.35,
    track_buffer: 30,
    match_thresh: 0.8,
    fuse_score: true,
  });
  const boxes: PixelBox[] = [
    { left: 430, top: 75, right: 530, bottom: 175, confidence: 0.93 },
    { left: 422, top: 78, right: 522, bottom: 178, confidence: 0.91 },
    { left: 414, top: 81, right: 514, bottom: 181, confidence: 0.89 },
  ];
  const outputs = boxes.map((box) => tracker.update(toByteTrackDetections([box])));
  const tracks = outputs
    .map((rows) => rows[0] ? trackRowToPixelBox(rows[0]) : null)
    .filter((box): box is PixelBox => box !== null);
  assert.equal(tracks.length, 3);
  assert.ok(tracks[0]?.trackId !== undefined);
  assert.ok(tracks.every((track) => track.trackId === tracks[0]?.trackId));
});
