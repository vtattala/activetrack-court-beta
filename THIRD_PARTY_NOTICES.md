# Third-party notices

ActiveTrack's browser video analyzer includes the following third-party components:

## Joseph Attalla basketball shot detector

- Source: https://github.com/josephattalla/Basketball-Shot-Detection
- Revision: `e320817d0f87eceb4093c871de6d29d1adca0006`
- Model: `bball_model.pt`, exported to ONNX for local browser inference
- Author: Joseph Y Attalla
- License: MIT; full text in `LICENSES/attalla-basketball-shot-detection-MIT.txt`
- Original SHA-256: `40F3E596652A427BA290B3F72384E49AED12CAF1A8AE41BEAEF4A8FFFCF09FA3`
- ONNX SHA-256: `5D2E8C0F39EAB69C98D371333ABF5E74F06A2245B5A7889D12352A620EF541A9`

The model detects basketballs and hoops. ActiveTrack ports the repository's
multi-ball/multi-hoop association and above-rim to below-net line-crossing
classifier to strict TypeScript. The port fixes the upstream constructor typo,
vertical-line division failure, frame-rate-dependent track expiry, and duplicate
event handling while retaining the published detector thresholds and geometry.

## byte-track-ts

- Source: https://github.com/billmyplate/byte-track-ts
- Revision: `ac2439c47175307d559daf423c8a8a425abb67bb`
- License: MIT

## ONNX Runtime Web

- Source: https://github.com/microsoft/onnxruntime
- Version: 1.27.0
- License: MIT
- Distribution: pinned jsDelivr package assets are loaded at runtime

## Prior systems evaluated but not incorporated

No source or model weights from the unlicensed `avishah3`,
`AggieSportsAnalytics`, or `srz08` repositories are incorporated. The `chonyy`
project includes a noncommercial OpenPose license and is not incorporated.
`iamyb/shotcut` was reviewed but publishes a Windows binary rather than an
integrable detector implementation.

`sPappalard/SwishAI` was evaluated as an architectural reference. It uses a
separately trained semantic "ball in basket" class and is licensed under AGPLv3;
its source and weights are not incorporated into ActiveTrack.
