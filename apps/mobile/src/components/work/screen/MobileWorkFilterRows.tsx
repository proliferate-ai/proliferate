import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "../../../styles/tokens";
import { MobileIcon, type MobileIconName } from "../../primitives/MobileIcon";

export function MobileWorkSummaryPill({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon?: MobileIconName;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.summaryPill,
        selected && styles.summaryPillSelected,
        pressed && styles.pressed,
      ]}
    >
      {icon ? <MobileIcon name={icon} size={14} color={selected ? colors.fg : colors.faint} /> : null}
      <Text style={[styles.summaryPillText, selected && styles.summaryPillTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function MobileWorkFilterSummaryRow({
  icon,
  title,
  value,
  onPress,
}: {
  icon: MobileIconName;
  title: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.filterSummaryRow, pressed && styles.pressed]}
    >
      <View style={styles.filterSummaryIcon}>
        <MobileIcon name={icon} size={17} color={colors.fg} />
      </View>
      <View style={styles.filterSummaryText}>
        <Text style={styles.filterSummaryTitle}>{title}</Text>
        <Text style={styles.filterSummaryValue} numberOfLines={1}>{value}</Text>
      </View>
      <MobileIcon name="chevron-right" size={17} color={colors.faint} />
    </Pressable>
  );
}

export function MobileWorkFilterChoice({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon?: MobileIconName;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        selected && styles.choiceSelected,
        pressed && styles.pressed,
      ]}
    >
      {icon ? <MobileIcon name={icon} size={14} color={selected ? colors.fg : colors.faint} /> : null}
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
      {selected ? <MobileIcon name="check" size={15} color={colors.fg} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  summaryPill: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[3],
  },
  summaryPillSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.borderHeavy,
  },
  summaryPillText: {
    color: colors.faint,
    fontSize: 14,
    fontWeight: "600",
  },
  summaryPillTextSelected: {
    color: colors.fg,
  },
  filterSummaryRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: 18,
    paddingHorizontal: spacing[3],
  },
  filterSummaryIcon: {
    width: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  filterSummaryText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  filterSummaryTitle: {
    color: colors.fg,
    fontSize: 16,
    fontWeight: "600",
  },
  filterSummaryValue: {
    color: colors.faint,
    fontSize: 13,
    lineHeight: 17,
  },
  choice: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: 16,
    paddingHorizontal: spacing[3],
  },
  choiceSelected: {
    backgroundColor: colors.accent,
  },
  choiceText: {
    flex: 1,
    minWidth: 0,
    color: colors.faint,
    fontSize: 15,
    fontWeight: "600",
  },
  choiceTextSelected: {
    color: colors.fg,
  },
  pressed: {
    opacity: 0.7,
  },
});
