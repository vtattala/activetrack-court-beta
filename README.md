# ActiveTrack Native

ActiveTrack is an Expo SDK 57 basketball camera app that counts makes and misses in real time. Camera frames stay on the device and are processed by VisionCamera 5, Skia, GPU resizing, worklets, and Fast OpenCV. The live view tracks the ball's predicted trajectory and the dominant moving player independently, so player appearance is never used as a basketball signal.

The browser ActiveTrack camera and recorded-video route use the same basketball-trained YOLO detector, ByteTrack settings, and pure scoring state machine. The live browser camera automatically finds the hoop and keeps its tracked identity while following the ball and primary player. The video route accepts a device-library recording up to five minutes long, automatically selects a clear hoop frame, and analyzes decoded frames at 30 FPS; manual rim adjustment remains available only as a correction. Makes require a descending ball to enter the rim and exit through the net corridor, with a near-rim recovery path for skipped detector frames. Adjacent crossings and completed trajectories that leave the scoring lane are misses. Low-confidence decisions remain uncounted for review.

For best tracking, record in landscape 10-20 feet from the hoop, keep the rim and ball visible, avoid hard cuts or extreme zoom changes, and use even court lighting. No vision system can promise zero mistakes on arbitrary footage; this is a beta and its thresholds still need validation against a larger labeled-video set.

## Run locally

For the localhost preview, run `npm run web` and open `http://localhost:8081`. The browser supports real camera analysis on secure origins, a separately labeled simulation, history, manual corrections, automatic hoop lock, and local recorded-video analysis. Camera permission and model support vary by browser; the deployed HTTPS site is the recommended web test surface.

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
