import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius } from "../../styles/tokens";

interface MobileButtonProps {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  leading?: ReactNode;
}

export function MobileButton({ label, onPress, variant = "primary", leading }: MobileButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === "primary" && styles.primary,
        variant === "secondary" && styles.secondary,
        variant === "ghost" && styles.ghost,
        pressed && styles.pressed,
      ]}
    >
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <Text
        style={[
          styles.label,
          variant === "primary" && styles.primaryLabel,
          variant !== "primary" && styles.secondaryLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    borderRadius: radius.md,
    paddingHorizontal: 14,
  },
  primary: {
    backgroundColor: colors.fg,
  },
  secondary: {
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  ghost: {
    backgroundColor: "transparent",
  },
  pressed: {
    opacity: 0.72,
  },
  label: {
    fontSize: 14,
    fontWeight: "700",
  },
  primaryLabel: {
    color: colors.bg,
  },
  secondaryLabel: {
    color: colors.fg,
  },
  leading: {
    minWidth: 16,
    alignItems: "center",
  },
});
