# ActiveTrack Native

ActiveTrack is an Expo SDK 57 basketball camera app that counts makes and misses in real time. Camera frames stay on the device and are processed by VisionCamera 5, Skia, GPU resizing, worklets, and Fast OpenCV. The live view tracks the ball's predicted trajectory and the dominant moving player independently, so player appearance is never used as a basketball signal.

The recorded-video route accepts a device-library video up to five minutes long, lets the user choose a clear calibration frame and mark the rim, then runs a basketball-trained YOLO detector over decoded frames at 30 FPS. ByteTrack associates hoop, ball, and player detections across frames; the manual rim calibration remains authoritative for a fixed camera and anchors to a learned hoop track only after a sustained lock. The existing motion detector fills short ball-detection gaps. Scoring pauses while video quality is uncertain instead of guessing. Makes require a tracked ball to enter above the rim plane and exit below it; adjacent downward crossings are misses, and every result can be replayed and corrected.

For best tracking, record in landscape 10-20 feet from the hoop, keep the rim and ball visible, avoid hard cuts or extreme zoom changes, and use even court lighting. No vision system can promise zero mistakes on arbitrary footage; this is a beta and its thresholds still need validation against a larger labeled-video set.

## Run locally

For the localhost preview, run `npm run web` and open `http://localhost:8081`. The browser supports demo sessions, history, manual corrections, rim calibration, and local recorded-video analysis. Its camera card is an explicitly labeled simulation.

The real-time camera pipeline uses native frame processors and requires an Expo development build. Expo Go cannot load the tracking modules.

1. Install dependencies with `npm install`.
2. Generate native projects with `npx expo prebuild`.
3. On macOS, build the iOS development client with `npx expo run:ios --device`; from Windows, use an EAS development build.
4. Start Metro with `npx expo start --dev-client`.

## Validate

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run doctor`

Before App Store submission, replace the placeholder bundle identifier in `app.json` and connect the project to the correct Apple Developer account with EAS.

## Model and tracking credits

The browser analyzer uses the CC BY 4.0 E-BARD basketball detector, the MIT-licensed `byte-track-ts` tracker, and ONNX Runtime Web. Full attribution and exact revisions are in `THIRD_PARTY_NOTICES.md`.
