import type { ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  type TextProps,
  type TextStyle,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { colors, layout, radius, spacing, text } from "../../styles/tokens";

interface MobileScreenProps {
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}

interface MobileCardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

interface MobileScreenHeaderProps {
  eyebrow: string;
  title: string;
  description?: string;
}

interface MobileStatusPillProps {
  children: ReactNode;
  tone?: "success" | "info" | "muted";
}

export function MobileScreen({ children, contentStyle }: MobileScreenProps) {
  return (
    <ScrollView contentContainerStyle={[styles.screen, contentStyle]}>
      {children}
    </ScrollView>
  );
}

export function MobileStack({ children }: { children: ReactNode }) {
  return <View style={styles.stack}>{children}</View>;
}

export function MobileScreenHeader({
  eyebrow,
  title,
  description,
}: MobileScreenHeaderProps) {
  return (
    <View style={styles.header}>
      <Text style={text.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  );
}

export function MobileCard({ children, style }: MobileCardProps) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function MobileSectionHeader({
  title,
  meta,
}: {
  title: string;
  meta?: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
    </View>
  );
}

export function MobileCardTitle({
  children,
  numberOfLines,
  style,
}: {
  children: ReactNode;
  numberOfLines?: TextProps["numberOfLines"];
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text numberOfLines={numberOfLines} style={[styles.cardTitle, style]}>
      {children}
    </Text>
  );
}

export function MobileStatusPill({
  children,
  tone = "muted",
}: MobileStatusPillProps) {
  return (
    <Text
      style={[
        styles.statusPill,
        tone === "success" && styles.statusPillSuccess,
        tone === "info" && styles.statusPillInfo,
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: {
    padding: layout.screenPadding,
    paddingBottom: layout.screenBottomPadding,
  },
  stack: {
    gap: layout.stackGap,
  },
  header: {
    gap: spacing[2],
    marginBottom: spacing[1],
  },
  title: {
    ...text.title,
  },
  description: {
    ...text.body,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: spacing[3],
  },
  sectionHeader: {
    marginTop: spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "700",
  },
  sectionMeta: {
    color: colors.faint,
    fontSize: 12,
  },
  cardTitle: {
    color: colors.fg,
    fontSize: 15,
    fontWeight: "700",
  },
  statusPill: {
    overflow: "hidden",
    borderRadius: radius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    color: colors.faint,
    backgroundColor: colors.accent,
    fontSize: 11,
    fontWeight: "700",
  },
  statusPillSuccess: {
    color: colors.success,
    backgroundColor: colors.successSubtle,
  },
  statusPillInfo: {
    color: colors.info,
    backgroundColor: colors.infoSubtle,
  },
});
