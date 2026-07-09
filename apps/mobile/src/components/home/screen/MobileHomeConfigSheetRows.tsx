import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  normalizeCloudComposerModelLabel,
  type CloudChatComposerControlOptionView,
  type CloudChatComposerControlView,
} from "@proliferate/product-domain/chats/cloud/composer-controls";

import { colors, radius, spacing } from "../../../styles/tokens";
import { MobileIcon, type MobileIconName } from "../../primitives/MobileIcon";

export function mobileHomeConfigControlIcon(
  control: CloudChatComposerControlView | null,
): MobileIconName {
  switch (control?.icon) {
    case "brain":
      return "brain";
    case "sparkles":
      return "sparkles";
    case "openai":
      return "openai";
    case "claude":
      return "claude";
    case "opencodeBuild":
    case "bot":
      return "sparkles";
    case "settings":
      return "settings";
    default:
      return "cloud";
  }
}

export function MobileHomeConfigSheetSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.sheetSection}>
      <Text style={styles.sheetSectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function MobileHomeConfigSheetRow({
  icon,
  title,
  subtitle,
  value,
  selected,
  disabled,
  chevron = true,
  onPress,
}: {
  icon: MobileIconName;
  title: string;
  subtitle?: string | null;
  value?: string | null;
  selected?: boolean;
  disabled?: boolean;
  chevron?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sheetRow,
        selected && styles.sheetRowSelected,
        disabled && styles.disabledPill,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      <View style={styles.sheetRowIcon}>
        <MobileIcon name={icon} size={16} color={disabled ? colors.faint : colors.fg} />
      </View>
      <View style={styles.sheetRowText}>
        <Text style={[styles.sheetRowTitle, disabled && styles.sheetRowTitleDisabled]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.sheetRowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={styles.sheetRowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {selected ? <MobileIcon name="check" size={15} color={colors.fg} /> : null}
      {chevron ? <MobileIcon name="chevron-right" size={14} color={colors.faint} /> : null}
    </Pressable>
  );
}

export function MobileHomeConfigOptionRow({
  option,
  onPress,
}: {
  option: CloudChatComposerControlOptionView;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(option.selected), disabled: option.disabled }}
      disabled={option.disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionRow,
        option.selected && styles.sheetRowSelected,
        option.disabled && styles.disabledPill,
        pressed && !option.disabled ? styles.pressed : null,
      ]}
    >
      <View style={styles.optionCheck}>
        {option.selected ? <MobileIcon name="check" size={15} color={colors.fg} /> : null}
      </View>
      <View style={styles.sheetRowText}>
        <Text
          style={[styles.optionTitle, option.disabled && styles.sheetRowTitleDisabled]}
          numberOfLines={1}
        >
          {normalizeCloudComposerModelLabel(option.label)}
        </Text>
        {option.description ? (
          <Text style={styles.sheetRowSubtitle} numberOfLines={2}>
            {option.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  sheetSection: {
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetSectionTitle: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingHorizontal: spacing[2],
    paddingBottom: spacing[2],
  },
  sheetRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
  },
  sheetRowSelected: {
    backgroundColor: colors.accent,
  },
  sheetRowIcon: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetRowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sheetRowTitle: {
    color: colors.fg,
    fontSize: 13.5,
    fontWeight: "600",
  },
  sheetRowTitleDisabled: {
    color: colors.faint,
  },
  sheetRowSubtitle: {
    color: colors.faint,
    fontSize: 11.5,
    lineHeight: 15,
  },
  sheetRowValue: {
    maxWidth: "42%",
    color: colors.mutedForeground,
    fontSize: 12.5,
    fontWeight: "500",
  },
  disabledPill: {
    opacity: 0.55,
  },
  optionRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
  },
  optionCheck: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  optionTitle: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "600",
  },
});
