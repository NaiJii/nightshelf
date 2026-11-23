import { useEffect, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, Animated, StyleSheet } from "react-native";
import { refreshProgress } from "../lib/refresh-progress";

export function RefreshBar({ loading = false, batchProgress }: { loading?: boolean; batchProgress?: number }) {
  const progress = useSyncExternalStore(refreshProgress.subscribe, refreshProgress.snapshot, refreshProgress.snapshot);
  return loading || progress !== null || batchProgress !== undefined
    ? <ActiveBar percent={batchProgress ?? (typeof progress === "number" ? progress : undefined)} />
    : null;
}

function ActiveBar({ percent }: { percent?: number }) {
  const [visible, setVisible] = useState(false);
  const [lastPercent, setLastPercent] = useState(percent);
  const [opacity] = useState(() => new Animated.Value(1));
  // Keep the measured fill while the final results reach the screen.
  if (percent !== undefined && percent !== lastPercent) setLastPercent(percent);
  const shownPercent = percent ?? lastPercent;
  // A fast cache hit should not flash the bar.
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 120);
    return () => clearTimeout(timer);
  }, []);
  const pending = shownPercent === undefined;
  useEffect(() => {
    opacity.setValue(1);
    if (!visible || !pending) return;
    let cancelled = false;
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.35, duration: 520, useNativeDriver: true, isInteraction: false }),
      Animated.timing(opacity, { toValue: 1, duration: 520, useNativeDriver: true, isInteraction: false }),
    ]));
    void AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (!cancelled && !reduced) pulse.start();
    }).catch(() => {});
    return () => { cancelled = true; pulse.stop(); };
  }, [opacity, pending, visible]);
  if (!visible) return null;
  return <Animated.View
    pointerEvents="none"
    accessible
    accessibilityRole="progressbar"
    accessibilityLabel="Refreshing stories"
    accessibilityValue={shownPercent === undefined ? undefined : { min: 0, max: 100, now: shownPercent }}
    style={styles.track}
  >
    <Animated.View style={[styles.fill, { width: shownPercent === undefined ? "30%" : `${Math.max(4, shownPercent)}%`, opacity }]} />
  </Animated.View>;
}

const styles = StyleSheet.create({
  track: { position: "absolute", top: 0, left: 0, right: 0, height: 2, backgroundColor: "#c9a7ff26", zIndex: 2 },
  fill: { height: "100%", backgroundColor: "#c9a7ff" },
});
