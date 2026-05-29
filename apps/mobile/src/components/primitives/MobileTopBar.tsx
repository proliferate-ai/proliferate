import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "../../styles/tokens";
import { MobileIcon, type MobileIconName } from "./MobileIcon";

interface MobileTopBarProps {
  title: string;
  subtitle?: string;
  leading?:
    | { kind: "menu"; onPress: () => void }
    | { kind: "back"; onPress: () => void }
    | { kind: "none" };
  trailing?: ReactNode;
}

export function MobileTopBar({
  title,
  subtitle,
  leading = { kind: "none" },
  trailing,
}: MobileTopBarProps) {
  return (
    <View style={styles.bar}>
      {leading.kind !== "none" ? (
        <MobileTopBarIconButton
          name={leading.kind === "menu" ? "menu" : "chevron-left"}
          accessibilityLabel={leading.kind === "menu" ? "Open navigation" : "Back"}
          onPress={leading.onPress}
        />
      ) : (
        <View style={styles.spacer} />
      )}

      <View style={styles.titleArea}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View style={styles.trailing}>{trailing}</View>
    </View>
  );
}

interface MobileTopBarIconButtonProps {
  name: MobileIconName;
  accessibilityLabel: string;
  onPress?: () => void;
}

export function MobileTopBarIconButton({
  name,
  accessibilityLabel,
  onPress,
}: MobileTopBarIconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !onPress }}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        !onPress && styles.disabled,
        pressed && styles.pressed,
      ]}
      hitSlop={6}
    >
      <MobileIcon name={name} size={20} color={colors.fg} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.background,
  },
  spacer: {
    width: 40,
    height: 40,
  },
  titleArea: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: spacing[1],
  },
  title: {
    color: colors.fg,
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  subtitle: {
    color: colors.faint,
    fontSize: 12,
    marginTop: 1,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  pressed: {
    opacity: 0.55,
    backgroundColor: colors.accent,
  },
  disabled: {
    opacity: 0.42,
  },
});
