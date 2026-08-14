import { Tracker as ByteTracker } from "byte-track-ts";

import {
  createTrackerEngineState,
  MIN_AUTOMATIC_DECISION_CONFIDENCE,
  stepTracker,
} from "../tracking/engine";
import type {
  BallDetection,
  PlayerDetection,
  RimCalibration,
  ShotKind,
} from "../../types/tracking";
import { createVisionTrackState, selectTrackedBall } from "./ballTracker";
import { selectHoopZoneCandidates } from "./hoopZone";
import {
  loadLearnedBasketballDetector,
  type LearnedBasketballDetector,
} from "./learnedBasketballDetector.web";
import {
  chooseAutomaticHoop,
  chooseBoxNearReference,
  createHoopRimAnchor,
  learnedDetectionToPixelBox,
  pixelBoxToBallDetection,
  rimFromAutomaticHoop,
  rimFromTrackedHoop,
  toByteTrackDetections,
  trackRowToPixelBox,
  type HoopRimAnchor,
  type PixelBox,
} from "./learnedTracking";
import {
  BALL_TRACKER_SETTINGS,
  HOOP_TRACKER_SETTINGS,
  MIN_AUTOMATIC_HOOP_CONFIDENCE,
  PLAYER_TRACKER_SETTINGS,
} from "./trackerSettings";

export interface LiveBrowserFrame {
  ball: BallDetection | null;
  player: PlayerDetection | null;
  rim: RimCalibration | null;
  rimConfidence: number;
  backend: "webgpu" | "wasm";
}

interface LiveBrowserPipelineCallbacks {
  onFrame: (frame: LiveBrowserFrame) => void;
  onShot: (kind: ShotKind) => void;
  onReview: () => void;
  onError: (message: string) => void;
}

export interface LiveBrowserPipeline {
  setSessionActive: (active: boolean) => void;
  relockHoop: () => void;
  stop: () => void;
}

function playerFromBox(
  box: PixelBox | null,
  frameWidth: number,
  frameHeight: number,
  at: number,
): PlayerDetection | null {
  if (!box) return null;
  return {
    x: box.left / frameWidth,
    y: box.top / frameHeight,
    width: (box.right - box.left) / frameWidth,
    height: (box.bottom - box.top) / frameHeight,
    confidence: box.confidence,
    at,
  };
}

function choosePrimaryPlayer(boxes: PixelBox[]): PixelBox | null {
  let best: PixelBox | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    const area = Math.max(1, box.right - box.left) * Math.max(1, box.bottom - box.top);
    const score = box.confidence * 0.72 + Math.min(0.28, Math.sqrt(area) / 900);
    if (score > bestScore) {
      best = box;
      bestScore = score;
    }
  }
  return best;
}

export async function startLiveBrowserPipeline(
  video: HTMLVideoElement,
  callbacks: LiveBrowserPipelineCallbacks,
): Promise<LiveBrowserPipeline> {
  const detector: LearnedBasketballDetector = await loadLearnedBasketballDetector();
  let hoopAssociation = new ByteTracker(HOOP_TRACKER_SETTINGS);
  let ballAssociation = new ByteTracker(BALL_TRACKER_SETTINGS);
  let playerAssociation = new ByteTracker(PLAYER_TRACKER_SETTINGS);
  let running = true;
  let sessionActive = false;
  let timer: number | null = null;
  let engine = createTrackerEngineState();
  let visionTrack = createVisionTrackState();
  let rim: RimCalibration | null = null;
  let rimConfidence = 0;
  let hoopAnchor: HoopRimAnchor | null = null;
  let lastHoopBox: PixelBox | null = null;
  let preferredHoopTrackId: number | undefined;
  let consecutiveFailures = 0;

  const resetShotTracking = () => {
    const lastShotAt = engine.lastShotAt;
    engine = { ...createTrackerEngineState(), lastShotAt };
    visionTrack = createVisionTrackState();
  };

  const relockHoop = () => {
    hoopAssociation = new ByteTracker(HOOP_TRACKER_SETTINGS);
    ballAssociation = new ByteTracker(BALL_TRACKER_SETTINGS);
    playerAssociation = new ByteTracker(PLAYER_TRACKER_SETTINGS);
    rim = null;
    rimConfidence = 0;
    hoopAnchor = null;
    lastHoopBox = null;
    preferredHoopTrackId = undefined;
    resetShotTracking();
    callbacks.onFrame({ ball: null, player: null, rim: null, rimConfidence: 0, backend: detector.backend });
  };

  const analyzeFrame = async () => {
    if (!running) return;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0) {
      timer = window.setTimeout(() => void analyzeFrame(), 100);
      return;
    }

    try {
      const now = Date.now();
      const frameWidth = video.videoWidth;
      const frameHeight = video.videoHeight;
      const learned = await detector.detect(video);
      if (!running) return;

      const rawHoops = learned.hoops.map(learnedDetectionToPixelBox);
      const trackedHoops = hoopAssociation
        .update(toByteTrackDetections(rawHoops))
        .map(trackRowToPixelBox)
        .filter((box): box is PixelBox => box !== null);

      if (!rim || !hoopAnchor || !lastHoopBox) {
        const automatic = chooseAutomaticHoop(rawHoops, frameWidth, frameHeight);
        if (automatic && automatic.confidence >= MIN_AUTOMATIC_HOOP_CONFIDENCE) {
          rim = rimFromAutomaticHoop(automatic.hoop, frameWidth, frameHeight);
          hoopAnchor = createHoopRimAnchor(rim, automatic.hoop, frameWidth, frameHeight);
          lastHoopBox = automatic.hoop;
          rimConfidence = automatic.confidence;
        }
      } else {
        const trackedHoop = chooseBoxNearReference(
          trackedHoops,
          lastHoopBox,
          preferredHoopTrackId,
        ) ?? chooseBoxNearReference(rawHoops, lastHoopBox);
        if (trackedHoop) {
          rim = rimFromTrackedHoop(trackedHoop, hoopAnchor, frameWidth, frameHeight);
          lastHoopBox = trackedHoop;
          preferredHoopTrackId = trackedHoop.trackId ?? preferredHoopTrackId;
          rimConfidence = Math.min(1, rimConfidence * 0.72 + trackedHoop.confidence * 0.28);
        }
      }

      const rawBalls = learned.basketballs.map(learnedDetectionToPixelBox);
      const trackedBalls = ballAssociation
        .update(toByteTrackDetections(rawBalls))
        .map(trackRowToPixelBox)
        .filter((box): box is PixelBox => box !== null);
      const candidateBoxes = trackedBalls.length > 0 ? trackedBalls : rawBalls;
      const rawPlayers = learned.players.map(learnedDetectionToPixelBox);
      const trackedPlayers = playerAssociation
        .update(toByteTrackDetections(rawPlayers))
        .map(trackRowToPixelBox)
        .filter((box): box is PixelBox => box !== null);

      let ball: BallDetection | null = null;
      if (rim) {
        const candidates = selectHoopZoneCandidates(
          candidateBoxes.map((box) => {
            const detection = pixelBoxToBallDetection(box, frameWidth, frameHeight, now);
            return trackedBalls.length > 0
              ? detection
              : { ...detection, motionConfidence: Math.max(0.52, detection.motionConfidence ?? 0) };
          }),
          rim,
          frameWidth,
          frameHeight,
        );
        const selection = selectTrackedBall(candidates, visionTrack, rim, now);
        visionTrack = selection.state;
        ball = selection.detection;

        if (sessionActive) {
          const result = stepTracker(engine, ball, rim, now);
          engine = result.state;
          if (result.shot && result.confidence >= MIN_AUTOMATIC_DECISION_CONFIDENCE) {
            callbacks.onShot(result.shot);
          } else if (result.shot) {
            callbacks.onReview();
          }
          if (result.shot || result.reason === "cooldown") {
            visionTrack = createVisionTrackState();
          }
        }
      } else {
        visionTrack = createVisionTrackState();
      }

      const playerBoxes = trackedPlayers.length > 0 ? trackedPlayers : rawPlayers;
      callbacks.onFrame({
        ball,
        player: playerFromBox(choosePrimaryPlayer(playerBoxes), frameWidth, frameHeight, now),
        rim,
        rimConfidence,
        backend: detector.backend,
      });
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) {
        callbacks.onError(
          error instanceof Error
            ? error.message
            : "The live basketball detector stopped unexpectedly.",
        );
        running = false;
        return;
      }
    }

    if (running) timer = window.setTimeout(() => void analyzeFrame(), 65);
  };

  void analyzeFrame();

  return {
    setSessionActive(active) {
      sessionActive = active;
      engine = createTrackerEngineState();
      visionTrack = createVisionTrackState();
    },
    relockHoop,
    stop() {
      running = false;
      if (timer !== null) window.clearTimeout(timer);
    },
  };
}
