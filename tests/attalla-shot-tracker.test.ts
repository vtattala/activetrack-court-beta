import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createAttallaShotTrackerState,
  stepAttallaShotTracker,
  type AttallaObjectDetection,
  type AttallaShotDecision,
} from "../src/tracking/attallaShotTracker";

interface DetectionFixture {
  sourceSha256: string;
  groundTruth: { makes: number; misses: number };
  frames: Array<{
    atMs: number;
    detections: AttallaObjectDetection[];
  }>;
}

function runFrames(
  frames: DetectionFixture["frames"],
): AttallaShotDecision[] {
  let state = createAttallaShotTrackerState();
  const decisions: AttallaShotDecision[] = [];
  for (const frame of frames) {
    const result = stepAttallaShotTracker(state, frame.detections, frame.atMs);
    state = result.state;
    decisions.push(...result.decisions);
  }
  return decisions;
}

test("classifies a centered above-rim to below-net crossing as a make", () => {
  const hoop: AttallaObjectDetection = {
    kind: "hoop", x: 100, y: 100, width: 40, height: 18, confidence: 0.9,
  };
  const frames = [
    { atMs: 0, detections: [hoop, { kind: "ball" as const, x: 92, y: 65, width: 10, height: 10, confidence: 0.9 }] },
    { atMs: 70, detections: [hoop, { kind: "ball" as const, x: 96, y: 72, width: 10, height: 10, confidence: 0.9 }] },
    { atMs: 140, detections: [hoop, { kind: "ball" as const, x: 99, y: 82, width: 10, height: 10, confidence: 0.9 }] },
    { atMs: 210, detections: [hoop, { kind: "ball" as const, x: 101, y: 112, width: 10, height: 10, confidence: 0.9 }] },
  ];
  assert.deepEqual(runFrames(frames).map((decision) => decision.kind), ["make"]);
});

test("classifies a completed adjacent crossing as a miss", () => {
  const hoop: AttallaObjectDetection = {
    kind: "hoop", x: 100, y: 100, width: 40, height: 18, confidence: 0.9,
  };
  const frames = [
    { atMs: 0, detections: [hoop, { kind: "ball" as const, x: 140, y: 65, width: 10, height: 10, confidence: 0.9 }] },
    { atMs: 70, detections: [hoop, { kind: "ball" as const, x: 142, y: 72, width: 10, height: 10, confidence: 0.9 }] },
    { atMs: 140, detections: [hoop, { kind: "ball" as const, x: 144, y: 82, width: 10, height: 10, confidence: 0.9 }] },
    { atMs: 210, detections: [hoop, { kind: "ball" as const, x: 148, y: 112, width: 10, height: 10, confidence: 0.9 }] },
  ];
  assert.deepEqual(runFrames(frames).map((decision) => decision.kind), ["miss"]);
});

test("matches the three-make ground truth on the exact failed upload", () => {
  const fixturePath = path.join(
    process.cwd(),
    "tests",
    "fixtures",
    "attalla-reference-detections.json",
  );
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as DetectionFixture;
  assert.equal(
    fixture.sourceSha256,
    "6EC656830BE58954CFB3CB75BAE671C8C1FC549240B0ACE7153E4AA852466358",
  );
  const frames = fixture.frames.map((frame) => ({
    atMs: frame.atMs,
    detections: frame.detections.map((detection) => ({
      ...detection,
      x: detection.x * 2_304,
      y: detection.y * 1_440,
      width: detection.width * 2_304,
      height: detection.height * 1_440,
    })),
  }));
  const decisions = runFrames(frames);
  assert.equal(decisions.filter((decision) => decision.kind === "make").length, fixture.groundTruth.makes);
  assert.equal(decisions.filter((decision) => decision.kind === "miss").length, fixture.groundTruth.misses);
  assert.ok(decisions.every((decision) => decision.confidence >= 0.86));
});
