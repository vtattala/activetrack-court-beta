# Third-party notices

ActiveTrack's browser video analyzer includes the following third-party components:

## E-BARD basketball object detector

- Source: https://huggingface.co/GabrieleGiudici/E-BARD-detection-models
- Model: `BODD_yolov8n_0001.pt`, exported to ONNX for local browser inference
- Author: Gabriele Giudici
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- Original SHA-256: `DFE3534D51BB21024D1A400C37F0C1FBF0C8B96EA9A56A5F3CB5454813BFD641`
- ONNX SHA-256: `843DCC481206EEFFBCC05C1390D8AC4561315A933DD4B96585F07CFB70FCBB01`

The model detects basketballs, hoops, players, and referees. See the model card for training data, evaluation results, and limitations.

## byte-track-ts

- Source: https://github.com/billmyplate/byte-track-ts
- Revision: `ac2439c47175307d559daf423c8a8a425abb67bb`
- License: MIT

## ONNX Runtime Web

- Source: https://github.com/microsoft/onnxruntime
- Version: 1.27.0
- License: MIT
- Distribution: pinned jsDelivr package assets are loaded at runtime

## Basketball scoring implementation references

The scoring state machine is an independent TypeScript implementation. Its
track-cleaning, trajectory-fitting, and above-rim/below-net design was informed
by the public descriptions and behavior of basketball-analysis projects,
including `avishah3/AI-Basketball-Shot-Detection-Tracker`,
`chonyy/AI-basketball-analysis`, `AggieSportsAnalytics/ShotTracker`, and
`srz08/basketball-shot-analysis`. ActiveTrack adds rim-relative smoothing,
interpolated crossings, delayed miss decisions, confidence review, and strict
adjacent-airball handling.

No source or model weights from the unlicensed `avishah3`,
`AggieSportsAnalytics`, or `srz08` repositories are incorporated. The `chonyy`
project includes a noncommercial OpenPose license and is not incorporated.
`iamyb/shotcut` was reviewed but publishes a Windows binary rather than an
integrable detector implementation.

`sPappalard/SwishAI` was evaluated as an architectural reference. It uses a
separately trained semantic "ball in basket" class and is licensed under AGPLv3;
its source and weights are not incorporated into ActiveTrack.
