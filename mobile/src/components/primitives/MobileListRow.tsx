import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../../styles/tokens";
import { MobileIcon } from "./MobileIcon";

interface MobileListRowProps {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  showChevron?: boolean;
  onPress?: () => void;
}

export function MobileListRow({
  leading,
  title,
  subtitle,
  trailing,
  showChevron,
  onPress,
}: MobileListRowProps) {
  const Body = (
    <>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      {showChevron ? (
        <View style={styles.chevron}>
          <MobileIcon name="chevron-right" size={16} color={colors.faint} />
        </View>
      ) : null}
    </>
  );

  if (!onPress) {
    return <View style={styles.row}>{Body}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {Body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  pressed: {
    backgroundColor: colors.accent,
  },
  leading: {
    flexShrink: 0,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    color: colors.fg,
    fontSize: 14.5,
    fontWeight: "500",
  },
  subtitle: {
    color: colors.faint,
    fontSize: 12,
    lineHeight: 16,
  },
  trailing: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  chevron: {
    flexShrink: 0,
    marginLeft: spacing[1],
  },
});
