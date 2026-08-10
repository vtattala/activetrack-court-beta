"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type ShotKind = "make" | "miss";
type ShotMethod = "tracked" | "manual" | "demo";
type Point = { x: number; y: number; at: number; confidence: number };
type Rim = { x: number; y: number; width: number; height: number };
type ShotEvent = {
  id: number;
  kind: ShotKind;
  method: ShotMethod;
  elapsed: number;
};

const DEFAULT_RIM: Rim = { x: 0.38, y: 0.22, width: 0.24, height: 0.08 };
const ANALYSIS_WIDTH = 240;

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const analysisRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const animationRef = useRef<number | null>(null);
  const pointsRef = useRef<Point[]>([]);
  const rimRef = useRef<Rim>(DEFAULT_RIM);
  const sessionActiveRef = useRef(false);
  const calibratedRef = useRef(false);
  const armedRef = useRef(false);
  const armedAtRef = useRef(0);
  const lastDetectedAtRef = useRef(0);
  const lastShotAtRef = useRef(0);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const elapsedRef = useRef(0);
  const downloadUrlRef = useRef("");

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment",
  );
  const [sessionActive, setSessionActive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [makes, setMakes] = useState(0);
  const [misses, setMisses] = useState(0);
  const [events, setEvents] = useState<ShotEvent[]>([]);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrated, setCalibrated] = useState(false);
  const [rim, setRim] = useState<Rim>(DEFAULT_RIM);
  const [draftRim, setDraftRim] = useState<Rim | null>(null);
  const [ballVisible, setBallVisible] = useState(false);
  const [confidence, setConfidence] = useState(0);
  const [demoMode, setDemoMode] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [sessionComplete, setSessionComplete] = useState(false);
  const [recordingSupported, setRecordingSupported] = useState(true);

  const attempts = makes + misses;
  const accuracy = attempts ? Math.round((makes / attempts) * 100) : 0;

  useEffect(() => {
    sessionActiveRef.current = sessionActive;
  }, [sessionActive]);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  useEffect(() => {
    downloadUrlRef.current = downloadUrl;
  }, [downloadUrl]);

  useEffect(() => {
    calibratedRef.current = calibrated;
  }, [calibrated]);

  useEffect(() => {
    rimRef.current = rim;
  }, [rim]);

  useEffect(() => {
    if (!sessionActive) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [sessionActive]);

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
    };
  }, []);

  const addShot = useCallback(
    (kind: ShotKind, method: ShotMethod) => {
      const nextEvent: ShotEvent = {
        id: Date.now() + Math.random(),
        kind,
        method,
        elapsed: elapsedRef.current,
      };
      if (kind === "make") setMakes((value) => value + 1);
      else setMisses((value) => value + 1);
      setEvents((value) => [nextEvent, ...value].slice(0, 12));

      if (navigator.vibrate) {
        navigator.vibrate(kind === "make" ? [35, 35, 70] : 45);
      }
    },
    [],
  );

  const recordTrackedShot = useCallback(
    (kind: ShotKind) => {
      const now = performance.now();
      if (now - lastShotAtRef.current < 1600) return;
      lastShotAtRef.current = now;
      armedRef.current = false;
      addShot(kind, demoMode ? "demo" : "tracked");
    },
    [addShot, demoMode],
  );

  const stopCamera = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
    setBallVisible(false);
    setConfidence(0);
  }, []);

  const startCamera = useCallback(
    async (nextFacing: "environment" | "user" = facingMode) => {
      setCameraError("");
      setDemoMode(false);
      stopCamera();
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("Camera access is not available in this browser.");
        return false;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: nextFacing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 60 },
          },
        });
        streamRef.current = stream;
        if (!videoRef.current) return false;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
        setCalibrated(false);
        setCalibrating(true);
        setFacingMode(nextFacing);
        return true;
      } catch (error) {
        const message = error instanceof DOMException && error.name === "NotAllowedError"
          ? "Camera permission was blocked. Allow camera access, then try again."
          : "We could not start the camera. Close other camera apps and try again.";
        setCameraError(message);
        return false;
      }
    },
    [facingMode, stopCamera],
  );

  const switchCamera = async () => {
    const nextFacing = facingMode === "environment" ? "user" : "environment";
    await startCamera(nextFacing);
  };

  const startDemo = () => {
    stopCamera();
    setCameraError("");
    setDemoMode(true);
    setCameraReady(true);
    setCalibrated(true);
    setCalibrating(false);
    setBallVisible(true);
    setConfidence(92);
  };

  const startRecording = () => {
    if (!streamRef.current || typeof MediaRecorder === "undefined") {
      setRecordingSupported(false);
      return;
    }
    try {
      const preferredType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const recorder = new MediaRecorder(streamRef.current, { mimeType: preferredType });
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const clip = new Blob(recordingChunksRef.current, { type: preferredType });
        if (!clip.size) return;
        setDownloadUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return URL.createObjectURL(clip);
        });
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      setRecordingSupported(true);
    } catch {
      setRecordingSupported(false);
    }
  };

  const beginSession = async () => {
    let isReady = cameraReady;
    if (!isReady) isReady = await startCamera();
    if (!isReady) return;
    if (!demoMode && !calibratedRef.current) {
      setCalibrating(true);
      return;
    }
    setMakes(0);
    setMisses(0);
    setEvents([]);
    setElapsed(0);
    setSessionComplete(false);
    setDownloadUrl("");
    pointsRef.current = [];
    armedRef.current = false;
    lastShotAtRef.current = 0;
    setSessionActive(true);
    if (!demoMode) startRecording();
  };

  const endSession = () => {
    setSessionActive(false);
    setSessionComplete(true);
    armedRef.current = false;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  useEffect(() => {
    if (!sessionActive || !demoMode) return;
    let index = 0;
    const demoResults: ShotKind[] = ["make", "make", "miss", "make"];
    const timer = window.setInterval(() => {
      recordTrackedShot(demoResults[index % demoResults.length]);
      index += 1;
    }, 3300);
    return () => window.clearInterval(timer);
  }, [demoMode, recordTrackedShot, sessionActive]);

  useEffect(() => {
    if (!cameraReady || demoMode) return;
    const video = videoRef.current;
    const overlay = overlayRef.current;
    const analysis = analysisRef.current;
    if (!video || !overlay || !analysis) return;

    const analysisContext = analysis.getContext("2d", { willReadFrequently: true });
    const overlayContext = overlay.getContext("2d");
    if (!analysisContext || !overlayContext) return;

    let lastAnalysisAt = 0;
    let priorBallVisible = false;

    const drawOverlay = (point: Point | null) => {
      const width = overlay.width;
      const height = overlay.height;
      overlayContext.clearRect(0, 0, width, height);

      const activeRim = draftRim ?? rimRef.current;
      const rimX = activeRim.x * width;
      const rimY = activeRim.y * height;
      const rimWidth = activeRim.width * width;
      const rimHeight = activeRim.height * height;

      overlayContext.save();
      overlayContext.strokeStyle = calibrating ? "#ff5a1f" : "rgba(231,255,87,.92)";
      overlayContext.lineWidth = Math.max(3, width / 320);
      overlayContext.setLineDash(calibrating ? [14, 9] : []);
      overlayContext.strokeRect(rimX, rimY, rimWidth, rimHeight);
      overlayContext.setLineDash([]);
      overlayContext.fillStyle = calibrating ? "#ff5a1f" : "#e7ff57";
      overlayContext.font = `700 ${Math.max(14, width / 50)}px Arial`;
      overlayContext.fillText(calibrating ? "DRAG OVER RIM" : "RIM LOCKED", rimX, Math.max(22, rimY - 10));

      if (pointsRef.current.length > 1) {
        overlayContext.beginPath();
        pointsRef.current.forEach((item, index) => {
          if (index === 0) overlayContext.moveTo(item.x, item.y);
          else overlayContext.lineTo(item.x, item.y);
        });
        overlayContext.strokeStyle = "rgba(255,90,31,.68)";
        overlayContext.lineWidth = Math.max(4, width / 240);
        overlayContext.lineCap = "round";
        overlayContext.stroke();
      }

      if (point) {
        const radius = Math.max(13, width * 0.018);
        overlayContext.beginPath();
        overlayContext.arc(point.x, point.y, radius, 0, Math.PI * 2);
        overlayContext.strokeStyle = "#ff5a1f";
        overlayContext.lineWidth = Math.max(4, width / 260);
        overlayContext.stroke();
        overlayContext.beginPath();
        overlayContext.arc(point.x, point.y, 3, 0, Math.PI * 2);
        overlayContext.fillStyle = "#e7ff57";
        overlayContext.fill();
      }
      overlayContext.restore();
    };

    const detectBall = (): Point | null => {
      if (!video.videoWidth || !video.videoHeight) return null;
      const analysisHeight = Math.round(ANALYSIS_WIDTH * (video.videoHeight / video.videoWidth));
      analysis.width = ANALYSIS_WIDTH;
      analysis.height = analysisHeight;
      analysisContext.drawImage(video, 0, 0, ANALYSIS_WIDTH, analysisHeight);
      const pixels = analysisContext.getImageData(0, 0, ANALYSIS_WIDTH, analysisHeight).data;
      const total = ANALYSIS_WIDTH * analysisHeight;
      const mask = new Uint8Array(total);
      const seen = new Uint8Array(total);
      const queue = new Int32Array(total);

      for (let index = 0; index < total; index += 1) {
        const offset = index * 4;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        const max = Math.max(red, green, blue);
        const min = Math.min(red, green, blue);
        const saturation = max ? (max - min) / max : 0;
        if (
          red > 105 &&
          green > 32 &&
          green < 205 &&
          blue < 155 &&
          red > green * 1.12 &&
          green > blue * 0.72 &&
          saturation > 0.34
        ) {
          mask[index] = 1;
        }
      }

      let best: { x: number; y: number; score: number; confidence: number } | null = null;
      const previous = pointsRef.current.at(-1);

      for (let start = 0; start < total; start += 1) {
        if (!mask[start] || seen[start]) continue;
        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        seen[start] = 1;
        let area = 0;
        let sumX = 0;
        let sumY = 0;
        let minX = ANALYSIS_WIDTH;
        let minY = analysisHeight;
        let maxX = 0;
        let maxY = 0;

        while (head < tail) {
          const current = queue[head++];
          const x = current % ANALYSIS_WIDTH;
          const y = Math.floor(current / ANALYSIS_WIDTH);
          area += 1;
          sumX += x;
          sumY += y;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);

          const neighbors = [current - 1, current + 1, current - ANALYSIS_WIDTH, current + ANALYSIS_WIDTH];
          for (const neighbor of neighbors) {
            if (neighbor < 0 || neighbor >= total || seen[neighbor] || !mask[neighbor]) continue;
            const neighborX = neighbor % ANALYSIS_WIDTH;
            if (Math.abs(neighborX - x) > 1) continue;
            seen[neighbor] = 1;
            queue[tail++] = neighbor;
          }
        }

        const boxWidth = maxX - minX + 1;
        const boxHeight = maxY - minY + 1;
        const ratio = boxWidth / boxHeight;
        const fill = area / (boxWidth * boxHeight);
        if (
          area < 10 || area > 1400 || boxWidth < 3 || boxHeight < 3 ||
          boxWidth > ANALYSIS_WIDTH * 0.28 || boxHeight > analysisHeight * 0.36 ||
          ratio < 0.42 || ratio > 2.1 || fill < 0.28
        ) continue;

        const centerX = sumX / area;
        const centerY = sumY / area;
        const videoX = centerX * (video.videoWidth / ANALYSIS_WIDTH);
        const videoY = centerY * (video.videoHeight / analysisHeight);
        const distancePenalty = previous
          ? Math.hypot(videoX - previous.x, videoY - previous.y) / video.videoWidth
          : 0;
        const roundness = 1 - Math.min(1, Math.abs(1 - ratio));
        const score = area * (0.6 + fill) * (0.7 + roundness) - distancePenalty * 180;
        const componentConfidence = Math.round(Math.min(97, 54 + fill * 25 + roundness * 18));
        if (!best || score > best.score) {
          best = { x: videoX, y: videoY, score, confidence: componentConfidence };
        }
      }

      return best
        ? { x: best.x, y: best.y, at: performance.now(), confidence: best.confidence }
        : null;
    };

    const evaluateTrajectory = (point: Point | null) => {
      const now = performance.now();
      if (!sessionActiveRef.current || !calibratedRef.current) return;
      const activeRim = rimRef.current;
      const rimLeft = activeRim.x * video.videoWidth;
      const rimRight = (activeRim.x + activeRim.width) * video.videoWidth;
      const rimCenterY = (activeRim.y + activeRim.height * 0.55) * video.videoHeight;
      const expandedLeft = rimLeft - activeRim.width * video.videoWidth * 0.9;
      const expandedRight = rimRight + activeRim.width * video.videoWidth * 0.9;

      if (!point) {
        if (armedRef.current && now - lastDetectedAtRef.current > 850) recordTrackedShot("miss");
        return;
      }

      lastDetectedAtRef.current = now;
      const previous = pointsRef.current.at(-2);
      if (!previous) return;
      const inApproachLane = point.x > expandedLeft && point.x < expandedRight;
      const aboveRim = point.y < rimCenterY - activeRim.height * video.videoHeight * 0.25;
      const movingUp = point.y < previous.y - video.videoHeight * 0.002;

      if (!armedRef.current && inApproachLane && aboveRim && movingUp) {
        armedRef.current = true;
        armedAtRef.current = now;
      }

      if (!armedRef.current) return;
      const crossedDown = previous.y < rimCenterY && point.y >= rimCenterY;
      if (crossedDown) {
        const inset = (rimRight - rimLeft) * 0.12;
        const throughOpening = point.x > rimLeft + inset && point.x < rimRight - inset;
        recordTrackedShot(throughOpening ? "make" : "miss");
        return;
      }

      const belowRim = point.y > rimCenterY + activeRim.height * video.videoHeight * 3.4;
      const leftLane = point.x < expandedLeft || point.x > expandedRight;
      if ((belowRim || leftLane || now - armedAtRef.current > 2200) && now - armedAtRef.current > 320) {
        recordTrackedShot("miss");
      }
    };

    const loop = (now: number) => {
      if (video.videoWidth && overlay.width !== video.videoWidth) {
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
      }

      let point: Point | null = pointsRef.current.at(-1) ?? null;
      if (now - lastAnalysisAt > 85) {
        lastAnalysisAt = now;
        point = detectBall();
        if (point) {
          pointsRef.current = [...pointsRef.current.slice(-11), point];
          setConfidence(point.confidence);
          if (!priorBallVisible) setBallVisible(true);
          priorBallVisible = true;
        } else {
          if (priorBallVisible) setBallVisible(false);
          priorBallVisible = false;
          if (pointsRef.current.at(-1) && now - pointsRef.current.at(-1)!.at > 500) {
            pointsRef.current = [];
          }
        }
        evaluateTrajectory(point);
      }
      drawOverlay(point && priorBallVisible ? point : null);
      animationRef.current = requestAnimationFrame(loop);
    };

    animationRef.current = requestAnimationFrame(loop);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [calibrating, cameraReady, demoMode, draftRim, recordTrackedShot]);

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = overlayRef.current!;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!calibrating || !overlayRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = pointerPosition(event);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!calibrating || !dragStartRef.current || !overlayRef.current) return;
    const current = pointerPosition(event);
    const canvas = overlayRef.current;
    setDraftRim({
      x: Math.min(dragStartRef.current.x, current.x) / canvas.width,
      y: Math.min(dragStartRef.current.y, current.y) / canvas.height,
      width: Math.abs(current.x - dragStartRef.current.x) / canvas.width,
      height: Math.abs(current.y - dragStartRef.current.y) / canvas.height,
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!calibrating || !dragStartRef.current || !overlayRef.current) return;
    const current = pointerPosition(event);
    const canvas = overlayRef.current;
    const start = dragStartRef.current;
    dragStartRef.current = null;
    const next: Rim = {
      x: Math.min(start.x, current.x) / canvas.width,
      y: Math.min(start.y, current.y) / canvas.height,
      width: Math.max(0.08, Math.abs(current.x - start.x) / canvas.width),
      height: Math.max(0.025, Math.abs(current.y - start.y) / canvas.height),
    };
    next.x = Math.min(next.x, 1 - next.width);
    next.y = Math.min(next.y, 1 - next.height);
    setRim(next);
    rimRef.current = next;
    setDraftRim(null);
    setCalibrated(true);
    setCalibrating(false);
  };

  const undoLast = () => {
    const last = events[0];
    if (!last) return;
    if (last.kind === "make") setMakes((value) => Math.max(0, value - 1));
    else setMisses((value) => Math.max(0, value - 1));
    setEvents((value) => value.slice(1));
  };

  const statusLabel = useMemo(() => {
    if (!cameraReady) return "Camera idle";
    if (calibrating) return "Mark the rim";
    if (ballVisible) return `Ball locked · ${confidence}%`;
    return "Scanning for ball";
  }, [ballVisible, calibrating, cameraReady, confidence]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="ActiveTrack home">
          <span className="brand-mark" aria-hidden="true"><i /></span>
          <span>ACTIVE<span>TRACK</span></span>
        </a>
        <div className="header-status">
          <span className="beta-chip">BETA 01</span>
          <span className="privacy-chip"><i /> On-device analysis</span>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span>●</span> LIVE SHOT TRACKING</p>
          <h1>Your reps.<br /><em>Counted.</em></h1>
          <p className="hero-description">
            Set your phone courtside. ActiveTrack follows the ball and calls every make and miss while you shoot.
          </p>
        </div>

        <div className="session-stats" aria-label="Session statistics">
          <div className="stat stat-makes">
            <span>MAKES</span>
            <strong>{String(makes).padStart(2, "0")}</strong>
          </div>
          <div className="stat stat-misses">
            <span>MISSES</span>
            <strong>{String(misses).padStart(2, "0")}</strong>
          </div>
          <div className="stat stat-accuracy">
            <span>ACCURACY</span>
            <strong>{accuracy}<small>%</small></strong>
          </div>
          <div className="stat-time">
            <span className={sessionActive ? "live-dot active" : "live-dot"} />
            {formatTime(elapsed)}
          </div>
        </div>
      </section>

      <section className="workspace">
        <div className="camera-column">
          <div className={`camera-card ${calibrating ? "is-calibrating" : ""}`}>
            <div className="camera-toolbar">
              <div className="vision-status">
                <span className={ballVisible ? "scan-icon locked" : "scan-icon"} aria-hidden="true" />
                <div><small>ACTIVE VISION</small><strong>{statusLabel}</strong></div>
              </div>
              {sessionActive && <span className="rec-chip"><i /> REC</span>}
              {cameraReady && !demoMode && (
                <button className="icon-button" onClick={switchCamera} aria-label="Switch camera">↻</button>
              )}
            </div>

            <div className="camera-stage">
              <video ref={videoRef} muted playsInline className={cameraReady && !demoMode ? "visible" : ""} />
              <canvas
                ref={overlayRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                aria-label={calibrating ? "Drag a box over the basketball rim" : "Ball tracking overlay"}
              />
              <canvas ref={analysisRef} className="analysis-canvas" aria-hidden="true" />

              {!cameraReady && (
                <div className="camera-empty">
                  <div className="court-preview" aria-hidden="true">
                    <span className="preview-rim" />
                    <span className="preview-ball" />
                    <span className="preview-arc" />
                  </div>
                  <div className="empty-copy">
                    <span className="basketball-icon" aria-hidden="true" />
                    <strong>Frame the hoop + shooter</strong>
                    <p>Landscape works best. Keep the full ball flight in view.</p>
                  </div>
                </div>
              )}

              {demoMode && (
                <div className="demo-court" aria-label="Tracking demonstration">
                  <span className="demo-grid" />
                  <span className="demo-backboard" />
                  <span className="demo-rim" />
                  <span className="demo-ball" />
                  <span className="demo-track" />
                  <div className="demo-label">DEMO FEED</div>
                </div>
              )}

              {calibrating && cameraReady && !demoMode && (
                <div className="calibration-hint">
                  <strong>MARK THE RIM</strong>
                  <span>Drag a tight box across the rim opening</span>
                </div>
              )}

              <div className="frame-corners" aria-hidden="true"><i /><i /><i /><i /></div>
            </div>

            {cameraError && <p className="camera-error" role="alert">{cameraError}</p>}

            <div className="camera-controls">
              {!cameraReady ? (
                <>
                  <button className="primary-button" onClick={() => startCamera()}>
                    <span className="button-camera" aria-hidden="true" /> Start camera
                  </button>
                  <button className="secondary-button" onClick={startDemo}>Try demo</button>
                </>
              ) : !sessionActive ? (
                <>
                  {demoMode ? (
                    <button className="secondary-button" onClick={() => startCamera()}>Use camera</button>
                  ) : (
                    <button
                      className={`secondary-button ${calibrating ? "selected" : ""}`}
                      onClick={() => setCalibrating(true)}
                    >
                      {calibrated ? "Adjust rim" : "Mark rim"}
                    </button>
                  )}
                  <button
                    className="primary-button"
                    onClick={beginSession}
                    disabled={!demoMode && !calibrated}
                  >
                    <span className="record-ring" aria-hidden="true" /> Start session
                  </button>
                </>
              ) : (
                <>
                  <button className="manual-button make" onClick={() => addShot("make", "manual")}>+ Make</button>
                  <button className="end-button" onClick={endSession}><i /> End session</button>
                  <button className="manual-button miss" onClick={() => addShot("miss", "manual")}>+ Miss</button>
                </>
              )}
            </div>
          </div>

          <div className="setup-strip">
            <div><span>01</span><p><strong>Set phone courtside</strong><small>Stable, 10–20 ft from hoop</small></p></div>
            <b>→</b>
            <div><span>02</span><p><strong>Mark the rim</strong><small>Drag over the opening</small></p></div>
            <b>→</b>
            <div><span>03</span><p><strong>Start shooting</strong><small>Stats update live</small></p></div>
          </div>
        </div>

        <aside className="side-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">SESSION FEED</p><h2>Every shot, live.</h2></div>
            <button className="undo-button" onClick={undoLast} disabled={!events.length}>Undo</button>
          </div>

          <div className="event-feed" aria-live="polite">
            {events.length ? events.map((event, index) => (
              <article className={`shot-event ${event.kind}`} key={event.id}>
                <span className="event-number">{String(attempts - index).padStart(2, "0")}</span>
                <span className="event-result">{event.kind === "make" ? "✓" : "×"}</span>
                <div>
                  <strong>{event.kind === "make" ? "MAKE" : "MISS"}</strong>
                  <small>{event.method === "tracked" ? "Auto detected" : event.method === "demo" ? "Demo detection" : "Manual correction"}</small>
                </div>
                <time>{formatTime(event.elapsed)}</time>
              </article>
            )) : (
              <div className="feed-empty">
                <span>00</span>
                <strong>No attempts yet</strong>
                <p>Your makes and misses will stack here as you shoot.</p>
              </div>
            )}
          </div>

          <div className="tracking-note">
            <span className="note-icon">i</span>
            <p><strong>Beta tracking tip</strong>Use a regulation orange ball, steady lighting, and a background that does not match the ball.</p>
          </div>

          {sessionComplete && (
            <div className="session-recap">
              <p className="eyebrow">SESSION SAVED</p>
              <div><strong>{makes}/{attempts}</strong><span>{accuracy}% accuracy<br />in {formatTime(elapsed)}</span></div>
              {downloadUrl && (
                <a href={downloadUrl} download={`activetrack-${Date.now()}.webm`}>Download recorded clip ↓</a>
              )}
              {!recordingSupported && !demoMode && <small>Your browser tracked the session but could not save the clip.</small>}
            </div>
          )}
        </aside>
      </section>

      <footer>
        <p>ACTIVE<span>TRACK</span> / COURT VISION BETA</p>
        <p>Video is analyzed on this device. Nothing is uploaded.</p>
      </footer>
    </main>
  );
}
