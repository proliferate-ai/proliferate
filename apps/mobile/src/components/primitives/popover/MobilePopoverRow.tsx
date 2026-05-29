import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "../../../styles/tokens";
import { MobileIcon, type MobileIconName } from "../MobileIcon";
import { useMobilePopoverGroup } from "./popover-context";

export interface MobilePopoverRowProps {
  id?: string;
  icon?: MobileIconName;
  title: string;
  subtitle?: string;
  disabled?: boolean;
  destructive?: boolean;
  onPress?: () => void;
}

export function MobilePopoverRow({
  id,
  icon,
  title,
  subtitle,
  disabled,
  destructive,
  onPress,
}: MobilePopoverRowProps) {
  const group = useMobilePopoverGroup();
  const resolvedId = useMemo(() => id ?? `row:${title}`, [id, title]);
  const index = group?.registerIndex(resolvedId) ?? -1;
  const dimmed = group?.isDimmed(index) ?? false;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        dimmed && styles.rowDimmed,
        disabled && styles.rowDisabled,
        pressed && !disabled ? styles.rowPressed : null,
      ]}
    >
      {icon ? (
        <View style={styles.iconSlot}>
          <MobileIcon
            name={icon}
            size={17}
            color={resolveIconColor({ disabled, dimmed, destructive })}
          />
        </View>
      ) : (
        <View style={styles.iconSlot} />
      )}
      <View style={styles.text}>
        <Text
          numberOfLines={1}
          style={[
            styles.title,
            destructive && styles.titleDestructive,
            dimmed && styles.titleDimmed,
            disabled && styles.titleDisabled,
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={[styles.subtitle, dimmed && styles.subtitleDimmed]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function resolveIconColor({
  disabled,
  dimmed,
  destructive,
}: {
  disabled?: boolean;
  dimmed?: boolean;
  destructive?: boolean;
}): string {
  if (disabled) return colors.faint;
  if (dimmed) return colors.faint;
  if (destructive) return colors.destructive;
  return colors.fg;
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  rowDimmed: {
    opacity: 0.55,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  rowPressed: {
    backgroundColor: colors.popoverAccent,
  },
  iconSlot: {
    width: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  title: {
    color: colors.fg,
    fontSize: 15,
    fontWeight: "500",
  },
  titleDestructive: {
    color: colors.destructive,
  },
  titleDimmed: {
    color: colors.faint,
  },
  titleDisabled: {
    color: colors.faint,
  },
  subtitle: {
    color: colors.faint,
    fontSize: 12,
    lineHeight: 16,
  },
  subtitleDimmed: {
    color: colors.faint,
  },
});
