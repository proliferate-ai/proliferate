import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "../../../styles/tokens";
import { MobileIcon } from "../MobileIcon";

interface MobilePopoverOptionProps {
  title: string;
  subtitle?: string;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

export function MobilePopoverOption({
  title,
  subtitle,
  selected,
  disabled,
  onSelect,
}: MobilePopoverOptionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled || !onSelect}
      onPress={onSelect}
      style={({ pressed }) => [
        styles.row,
        disabled && styles.rowDisabled,
        pressed && !disabled ? styles.rowPressed : null,
      ]}
    >
      <View style={styles.checkSlot}>
        {selected ? <MobileIcon name="check" size={15} color={colors.fg} /> : null}
      </View>
      <View style={styles.text}>
        <Text
          numberOfLines={1}
          style={[styles.title, disabled && styles.titleDisabled]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  rowPressed: {
    backgroundColor: colors.popoverAccent,
  },
  checkSlot: {
    width: 18,
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
  titleDisabled: {
    color: colors.faint,
  },
  subtitle: {
    color: colors.faint,
    fontSize: 12,
    lineHeight: 16,
  },
});
