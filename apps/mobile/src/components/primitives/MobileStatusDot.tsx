import { StyleSheet, View } from "react-native";

import { colors } from "../../styles/tokens";

import type { ProductChat } from "@proliferate/product-domain/chats/model";

type StatusKind = ProductChat["status"];

interface MobileStatusDotProps {
  status: StatusKind;
  size?: number;
}

const TONE: Record<StatusKind, string> = {
  running: colors.success,
  idle: colors.faint,
  paused: colors.faint,
  failed: colors.destructive,
  done: colors.info,
};

export function MobileStatusDot({ status, size = 7 }: MobileStatusDotProps) {
  const tone = TONE[status];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tone,
        ...(status === "running"
          ? styles.runningGlow
          : null),
      }}
    />
  );
}

const styles = StyleSheet.create({
  runningGlow: {
    shadowColor: colors.success,
    shadowOpacity: 0.6,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
});
