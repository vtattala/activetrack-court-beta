import { useMemo, useState } from "react";
import {
  Image,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Line, Rect } from "react-native-svg";

import { colors, monoFont } from "../constants/theme";
import type { RimCalibration } from "../types/tracking";

interface VideoRimCalibrationProps {
  imageUri: string;
  imageWidth: number;
  imageHeight: number;
  rim: RimCalibration | null;
  calibrating: boolean;
  onRimChange: (rim: RimCalibration) => void;
}

interface StageSize {
  width: number;
  height: number;
}

export function VideoRimCalibration({
  imageUri,
  imageWidth,
  imageHeight,
  rim,
  calibrating,
  onRimChange,
}: VideoRimCalibrationProps) {
  const [stageSize, setStageSize] = useState<StageSize>({ width: 0, height: 0 });
  const [draftRim, setDraftRim] = useState<RimCalibration | null>(null);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setStageSize({ width, height });
  };

  const responder = useMemo(
    () => {
      return PanResponder.create({
        onStartShouldSetPanResponder: () => calibrating,
        onMoveShouldSetPanResponder: () => calibrating,
        onPanResponderGrant: () => setDraftRim(null),
        onPanResponderMove: (event, gesture) => {
          if (!stageSize.width || !stageSize.height) return;
          const currentX = Math.max(0, Math.min(stageSize.width, event.nativeEvent.locationX));
          const currentY = Math.max(0, Math.min(stageSize.height, event.nativeEvent.locationY));
          const startX = Math.max(0, Math.min(stageSize.width, currentX - gesture.dx));
          const startY = Math.max(0, Math.min(stageSize.height, currentY - gesture.dy));
          setDraftRim({
            x: Math.min(startX, currentX) / stageSize.width,
            y: Math.min(startY, currentY) / stageSize.height,
            width: Math.abs(currentX - startX) / stageSize.width,
            height: Math.abs(currentY - startY) / stageSize.height,
          });
        },
        onPanResponderRelease: (event, gesture) => {
          if (!stageSize.width || !stageSize.height) return;
          const currentX = Math.max(0, Math.min(stageSize.width, event.nativeEvent.locationX));
          const currentY = Math.max(0, Math.min(stageSize.height, event.nativeEvent.locationY));
          const startX = Math.max(0, Math.min(stageSize.width, currentX - gesture.dx));
          const startY = Math.max(0, Math.min(stageSize.height, currentY - gesture.dy));
          const width = Math.max(0.035, Math.abs(currentX - startX) / stageSize.width);
          const height = Math.max(0.012, Math.abs(currentY - startY) / stageSize.height);
          const nextRim = {
            x: Math.min(Math.min(startX, currentX) / stageSize.width, 1 - width),
            y: Math.min(Math.min(startY, currentY) / stageSize.height, 1 - height),
            width,
            height,
          };
          setDraftRim(null);
          onRimChange(nextRim);
        },
        onPanResponderTerminate: () => setDraftRim(null),
      });
    },
    [calibrating, onRimChange, stageSize.height, stageSize.width],
  );

  const activeRim = draftRim ?? rim;

  return (
    <View
      style={[styles.stage, { aspectRatio: imageWidth / Math.max(1, imageHeight) }]}
      onLayout={onLayout}
    >
      <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
      {activeRim && stageSize.width > 0 ? (
        <Svg
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          width={stageSize.width}
          height={stageSize.height}
        >
          <Rect
            x={activeRim.x * stageSize.width}
            y={activeRim.y * stageSize.height}
            width={activeRim.width * stageSize.width}
            height={activeRim.height * stageSize.height}
            fill="rgba(255,90,31,0.08)"
            stroke={calibrating ? colors.orange : colors.acid}
            strokeWidth={3}
            strokeDasharray={calibrating ? "10 7" : undefined}
          />
          <Line
            x1={activeRim.x * stageSize.width}
            x2={(activeRim.x + activeRim.width) * stageSize.width}
            y1={(activeRim.y + activeRim.height * 0.48) * stageSize.height}
            y2={(activeRim.y + activeRim.height * 0.48) * stageSize.height}
            stroke={colors.acid}
            strokeWidth={1.5}
          />
        </Svg>
      ) : null}
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents={calibrating ? "auto" : "none"}
        {...responder.panHandlers}
      />
      {calibrating ? (
        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintTitle}>MARK THE RIM</Text>
          <Text style={styles.hintBody}>Box only the opening; the center line is the scoring plane</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    width: "100%",
    maxHeight: 520,
    backgroundColor: colors.black,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  hint: {
    position: "absolute",
    bottom: 14,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.orange,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  hintTitle: {
    color: colors.white,
    fontFamily: monoFont,
    fontSize: 9,
    fontWeight: "900",
    marginRight: 9,
  },
  hintBody: {
    color: colors.white,
    fontSize: 9,
  },
});
