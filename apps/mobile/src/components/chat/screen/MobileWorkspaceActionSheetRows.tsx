import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CloudSessionProjection } from "@proliferate/cloud-sdk";
import { normalizeCloudComposerModelLabel, type CloudChatComposerControlOptionView } from "@proliferate/product-domain/chats/cloud/composer-controls";

import {
  formatMobileWorkspaceActionSessionStatus,
  isMobileWorkspaceActionSessionErrorStatus,
  mobileWorkspaceSessionDisplayTitle,
} from "../../../lib/domain/chat/mobile-workspace-action-session";
import { colors, radius, spacing } from "../../../styles/tokens";
import { MobileIcon, type MobileIconName } from "../../primitives/MobileIcon";

export function MobileWorkspaceActionSheetSection({
  title,
  count,
  children,
}: {
  title?: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      {title ? (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {count !== undefined ? (
            <Text style={styles.sectionCount}>{count}</Text>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function MobileWorkspaceActionSheetRow({
  icon,
  title,
  subtitle,
  value,
  valueMono,
  selected,
  disabled,
  chevron = true,
  onPress,
}: {
  icon: MobileIconName;
  title: string;
  subtitle?: string | null;
  value?: string | null;
  valueMono?: boolean;
  selected?: boolean;
  disabled?: boolean;
  chevron?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={{ selected, disabled }}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        disabled && styles.rowDisabled,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      <View style={styles.rowIcon}>
        <MobileIcon name={icon} size={16} color={disabled ? colors.faint : colors.fg} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, disabled && styles.rowTitleDisabled]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          style={[styles.rowValue, valueMono && styles.rowValueMono]}
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
      {chevron ? <MobileIcon name="chevron-right" size={14} color={colors.faint} /> : null}
    </Pressable>
  );
}

export function MobileWorkspaceActionSessionRow({
  session,
  index,
  selected,
  onPress,
}: {
  session: CloudSessionProjection;
  index: number;
  selected: boolean;
  onPress: () => void;
}) {
  const status = session.status ?? "idle";
  const sessionLabel = session.sessionId?.slice(0, 8) ?? "pending";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.sessionDot, { backgroundColor: sessionStatusColor(status) }]} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {mobileWorkspaceSessionDisplayTitle(session, index)}
        </Text>
        <Text
          style={[
            styles.rowSubtitle,
            isMobileWorkspaceActionSessionErrorStatus(status) && styles.rowSubtitleError,
          ]}
          numberOfLines={1}
        >
          {selected ? "Current · " : ""}
          {formatMobileWorkspaceActionSessionStatus(status)} · {sessionLabel}
        </Text>
      </View>
      {selected ? <MobileIcon name="check" size={15} color={colors.fg} /> : null}
    </Pressable>
  );
}

export function MobileWorkspaceActionOptionRow({
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
        option.selected && styles.rowSelected,
        option.disabled && styles.rowDisabled,
        pressed && !option.disabled ? styles.pressed : null,
      ]}
    >
      <View style={styles.optionCheck}>
        {option.selected ? <MobileIcon name="check" size={15} color={colors.fg} /> : null}
      </View>
      <View style={styles.rowText}>
        <Text
          style={[styles.optionTitle, option.disabled && styles.rowTitleDisabled]}
          numberOfLines={1}
        >
          {normalizeCloudComposerModelLabel(option.label)}
        </Text>
        {option.description ? (
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {option.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function sessionStatusColor(status: string): string {
  if (status === "running") {
    return colors.success;
  }
  if (isMobileWorkspaceActionSessionErrorStatus(status)) {
    return colors.destructive;
  }
  return colors.faint;
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sectionHeader: {
    minHeight: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[2],
  },
  sectionTitle: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  sectionCount: {
    minWidth: 22,
    overflow: "hidden",
    borderRadius: radius.full,
    backgroundColor: colors.card,
    color: colors.mutedForeground,
    fontSize: 10.5,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "center",
  },
  row: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
  },
  rowSelected: {
    backgroundColor: colors.accent,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.72,
  },
  rowIcon: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    color: colors.fg,
    fontSize: 13.5,
    fontWeight: "600",
  },
  rowTitleDisabled: {
    color: colors.faint,
  },
  rowSubtitle: {
    color: colors.faint,
    fontSize: 11.5,
    lineHeight: 15,
  },
  rowSubtitleError: {
    color: colors.destructive,
  },
  rowValue: {
    maxWidth: "42%",
    color: colors.mutedForeground,
    fontSize: 12.5,
    fontWeight: "500",
  },
  rowValueMono: {
    fontSize: 11.5,
  },
  sessionDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginLeft: 6,
    marginRight: 7,
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
