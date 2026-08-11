# ActiveTrack Native

ActiveTrack is an Expo SDK 57 basketball camera app that counts makes and misses in real time. Camera frames stay on the device and are processed by VisionCamera 5, Skia, GPU resizing, worklets, and Fast OpenCV. The live view tracks the ball's predicted trajectory and the dominant moving player independently, so player appearance is never used as a basketball signal.

The recorded-video route accepts a device-library video up to five minutes long, lets the user choose a clear calibration frame and mark the fixed rim, then runs the same ball-candidate, trajectory, confidence, and shot-decision pipeline used by the live camera. Native and localhost analysis sample at 15 FPS and use actual decoded-frame timestamps. Repeated frames, long timing gaps, camera movement, and cuts disable automatic scoring. Makes are decided from the ball's interpolated downward crossing of the marked rim plane. Adjacent crossings are misses, and every result can be replayed and corrected.

For best tracking, lock the phone in landscape 10–20 feet from the hoop, keep the rim and the player's full body visible, avoid zooming or panning, and use even court lighting. No vision system can promise zero mistakes on arbitrary footage; the beta intentionally favors review over silently recording a questionable result.

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
