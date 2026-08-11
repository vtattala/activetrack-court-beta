import { useEffect, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { colors, monoFont } from "../constants/theme";
import type { ShotKind, ShotMethod } from "../types/tracking";

interface CameraTrackerProps {
  sessionActive: boolean;
  onShot: (kind: ShotKind, method: ShotMethod) => void;
  onBeginSession: () => void;
  onEndSession: (recordingUri: string | null) => Promise<void> | void;
}

export function CameraTracker({
  sessionActive,
  onShot,
  onBeginSession,
  onEndSession,
}: CameraTrackerProps) {
  const [demoReady, setDemoReady] = useState(false);
  const [ending, setEnding] = useState(false);
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!demoReady) return;
    progress.setValue(0);
    const animation = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 3_300,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [demoReady, progress]);

  useEffect(() => {
    if (!sessionActive || !demoReady) return;
    let index = 0;
    const outcomes: ShotKind[] = ["make", "make", "miss", "make"];
    const timer = window.setInterval(() => {
      const outcome = outcomes[index % outcomes.length];
      if (outcome) onShot(outcome, "demo");
      index += 1;
    }, 3_300);
    return () => window.clearInterval(timer);
  }, [demoReady, onShot, sessionActive]);

  const translateX = progress.interpolate({
    inputRange: [0, 0.48, 0.68, 1],
    outputRange: [0, 290, 405, 500],
  });
  const translateY = progress.interpolate({
    inputRange: [0, 0.48, 0.68, 1],
    outputRange: [210, -115, -60, 105],
  });
  const rotation = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "900deg"],
  });

  const endSession = async () => {
    setEnding(true);
    try {
      await onEndSession(null);
    } finally {
      setEnding(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.toolbar}>
        <View style={[styles.scanIcon, demoReady && styles.scanIconReady]}>
          <View style={styles.scanHorizontal} />
          <View style={styles.scanVertical} />
        </View>
        <View style={styles.statusCopy}>
          <Text style={styles.statusEyebrow}>BROWSER PREVIEW</Text>
          <Text style={styles.statusText}>
            {sessionActive ? "Demo trajectory tracking active" : demoReady ? "Demo camera ready" : "Preview ready"}
          </Text>
        </View>
        {sessionActive ? (
          <View style={styles.recordingBadge}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>LIVE DEMO</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.stage}>
        {demoReady ? (
          <View style={styles.demoStage}>
            <View style={styles.backboard} />
            <View style={styles.rim} />
            <View style={styles.arc} />
            <Animated.View
              style={[
                styles.ball,
                { transform: [{ translateX }, { translateY }, { rotate: rotation }] },
              ]}
            >
              <View style={styles.ballSeamVertical} />
              <View style={styles.ballSeamHorizontal} />
            </Animated.View>
            <View style={styles.rimTarget} />
            <Text style={styles.demoLabel}>SIMULATED TRACKING FEED</Text>
          </View>
        ) : (
          <View style={styles.emptyStage}>
            <View style={styles.emptyBall}>
              <View style={styles.ballSeamVertical} />
              <View style={styles.ballSeamHorizontal} />
            </View>
            <Text style={styles.emptyTitle}>Local browser preview</Text>
            <Text style={styles.emptyBody}>
              Run a demo session here, or choose VIDEO above to analyze an actual basketball recording.
            </Text>
          </View>
        )}

        <View style={styles.nativeNotice}>
          <Text style={styles.nativeNoticeTitle}>LIVE CAMERA</Text>
          <Text style={styles.nativeNoticeBody}>Available in the native iPhone build</Text>
        </View>
        <FrameCorners />
      </View>

      <View style={styles.controls}>
        {!demoReady ? (
          <ActionButton label="START DEMO" primary onPress={() => setDemoReady(true)} />
        ) : !sessionActive ? (
          <>
            <ActionButton label="RESET DEMO" onPress={() => setDemoReady(false)} />
            <ActionButton label="START SESSION" primary onPress={onBeginSession} />
          </>
        ) : (
          <>
            <ActionButton label="+ MAKE" tone="make" onPress={() => onShot("make", "manual")} />
            <ActionButton
              label={ending ? "SAVING..." : "END SESSION"}
              light
              disabled={ending}
              onPress={() => void endSession()}
            />
            <ActionButton label="+ MISS" tone="miss" onPress={() => onShot("miss", "manual")} />
          </>
        )}
      </View>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  primary = false,
  light = false,
  disabled = false,
  tone,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  light?: boolean;
  disabled?: boolean;
  tone?: "make" | "miss";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        primary && styles.actionPrimary,
        light && styles.actionLight,
        disabled && styles.actionDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.actionText,
          light && styles.actionLightText,
          tone === "make" && styles.actionMakeText,
          tone === "miss" && styles.actionMissText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function FrameCorners() {
  return (
    <View style={styles.frameCorners} pointerEvents="none">
      <View style={[styles.corner, styles.cornerTopLeft]} />
      <View style={[styles.corner, styles.cornerTopRight]} />
      <View style={[styles.corner, styles.cornerBottomLeft]} />
      <View style={[styles.corner, styles.cornerBottomRight]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    shadowColor: colors.orange,
    shadowOffset: { width: 7, height: 7 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  toolbar: {
    minHeight: 57,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  scanIcon: {
    width: 28,
    height: 28,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  scanIconReady: {
    borderColor: colors.acid,
    backgroundColor: "rgba(223,255,79,0.06)",
  },
  scanHorizontal: {
    position: "absolute",
    width: 12,
    height: 1,
    backgroundColor: colors.acid,
  },
  scanVertical: {
    position: "absolute",
    width: 1,
    height: 12,
    backgroundColor: colors.acid,
  },
  statusCopy: { flex: 1 },
  statusEyebrow: {
    color: colors.muted,
    fontFamily: monoFont,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  statusText: { color: colors.text, fontSize: 11, fontWeight: "600", marginTop: 2 },
  recordingBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.orangeSoft,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  recordingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.orange,
    marginRight: 5,
  },
  recordingText: {
    color: colors.red,
    fontFamily: monoFont,
    fontSize: 9,
    fontWeight: "800",
  },
  stage: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: colors.black,
    overflow: "hidden",
  },
  emptyStage: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#0A0F0B",
    justifyContent: "center",
    alignItems: "center",
  },
  emptyBall: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.orange,
    overflow: "hidden",
    marginBottom: 13,
  },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  emptyBody: {
    color: colors.muted,
    maxWidth: 430,
    textAlign: "center",
    fontSize: 11,
    lineHeight: 17,
    marginTop: 6,
    paddingHorizontal: 20,
  },
  demoStage: { ...StyleSheet.absoluteFill, backgroundColor: "#0A100B" },
  backboard: {
    position: "absolute",
    top: "11%",
    right: "12%",
    width: "24%",
    height: "32%",
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.65)",
  },
  rim: {
    position: "absolute",
    top: "39%",
    right: "19%",
    width: "17%",
    height: "5%",
    borderWidth: 3,
    borderColor: colors.orange,
    borderRadius: 999,
  },
  rimTarget: {
    position: "absolute",
    top: "38%",
    right: "18%",
    width: "19%",
    height: "8%",
    borderWidth: 2,
    borderColor: colors.acid,
    borderStyle: "dashed",
  },
  arc: {
    position: "absolute",
    left: "20%",
    top: "18%",
    width: "55%",
    height: "60%",
    borderTopWidth: 2,
    borderTopColor: "rgba(223,255,79,0.52)",
    borderRadius: 999,
    transform: [{ rotate: "-6deg" }],
  },
  ball: {
    position: "absolute",
    left: "15%",
    top: "19%",
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.orange,
    borderWidth: 2,
    borderColor: "#6F2409",
    overflow: "hidden",
  },
  ballSeamVertical: {
    position: "absolute",
    left: "48%",
    width: 2,
    height: "100%",
    backgroundColor: "#6F2409",
  },
  ballSeamHorizontal: {
    position: "absolute",
    top: "48%",
    width: "100%",
    height: 2,
    backgroundColor: "#6F2409",
  },
  demoLabel: {
    position: "absolute",
    left: 20,
    bottom: 17,
    color: colors.acid,
    fontFamily: monoFont,
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  nativeNotice: {
    position: "absolute",
    right: 16,
    bottom: 14,
    backgroundColor: "rgba(7,10,8,0.86)",
    borderWidth: 1,
    borderColor: colors.lineStrong,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  nativeNoticeTitle: {
    color: colors.orange,
    fontFamily: monoFont,
    fontSize: 8,
    fontWeight: "900",
  },
  nativeNoticeBody: { color: colors.muted, fontSize: 8, marginTop: 2 },
  frameCorners: { ...StyleSheet.absoluteFill, margin: 13 },
  corner: { position: "absolute", width: 21, height: 21, borderColor: "rgba(255,255,255,0.58)" },
  cornerTopLeft: { left: 0, top: 0, borderLeftWidth: 1, borderTopWidth: 1 },
  cornerTopRight: { right: 0, top: 0, borderRightWidth: 1, borderTopWidth: 1 },
  cornerBottomLeft: { left: 0, bottom: 0, borderLeftWidth: 1, borderBottomWidth: 1 },
  cornerBottomRight: { right: 0, bottom: 0, borderRightWidth: 1, borderBottomWidth: 1 },
  controls: {
    minHeight: 68,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  actionButton: {
    minWidth: 124,
    minHeight: 43,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    marginHorizontal: 5,
    paddingHorizontal: 16,
  },
  actionPrimary: { backgroundColor: colors.orange, borderColor: colors.orange },
  actionLight: { backgroundColor: colors.text, borderColor: colors.text },
  actionDisabled: { opacity: 0.4 },
  actionText: {
    color: colors.text,
    fontFamily: monoFont,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  actionLightText: { color: colors.background },
  actionMakeText: { color: colors.green },
  actionMissText: { color: colors.red },
  pressed: { opacity: 0.65 },
});
