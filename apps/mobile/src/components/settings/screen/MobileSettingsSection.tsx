import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../../../styles/tokens";
import { MobileIcon, type MobileIconName } from "../../primitives/MobileIcon";
import { MobileSectionLabel } from "../../primitives/MobileLayout";

export function MobileSettingsSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <MobileSectionLabel>{label}</MobileSectionLabel>
      </View>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

export function MobileSettingsRow({
  icon,
  title,
  subtitle,
  value,
  valueTone = "muted",
  trailing,
  chevron,
  onPress,
}: {
  icon: MobileIconName;
  title: string;
  subtitle?: string;
  value?: string;
  valueTone?: "muted" | "success" | "warning";
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
}) {
  const valueColor =
    valueTone === "success" ? colors.success : valueTone === "warning" ? colors.warning : colors.faint;
  const content = (
    <>
      <MobileIcon name={icon} size={18} color={colors.fg} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[styles.rowValue, { color: valueColor }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {chevron ? (
        <MobileIcon name="chevron-right" size={15} color={colors.faint} />
      ) : null}
    </>
  );
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={styles.row}>{content}</View>;
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing[4],
  },
  sectionHeader: {
    paddingHorizontal: spacing[3],
    paddingBottom: 6,
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  rowPressed: {
    backgroundColor: colors.accent,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  rowTitle: {
    color: colors.fg,
    fontSize: 14.5,
    fontWeight: "500",
  },
  rowSubtitle: {
    color: colors.faint,
    fontSize: 12,
  },
  rowValue: {
    fontSize: 13,
    fontWeight: "500",
  },
});
