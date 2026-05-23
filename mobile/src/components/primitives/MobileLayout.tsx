import type { ReactElement, ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { colors, layout, radius, spacing, text } from "../../styles/tokens";

interface MobileScreenProps {
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  refreshControl?: ReactElement<RefreshControlProps>;
  scroll?: boolean;
}

interface MobileCardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

interface MobileScreenHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
}

interface MobileStatusPillProps {
  children: ReactNode;
  tone?: "success" | "info" | "muted" | "warning";
}

export function MobileScreen({
  children,
  contentStyle,
  refreshControl,
  scroll = true,
}: MobileScreenProps) {
  if (!scroll) {
    return <View style={[styles.screen, contentStyle]}>{children}</View>;
  }
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.screen, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  );
}

export function MobileStack({ children, gap }: { children: ReactNode; gap?: number }) {
  return <View style={[styles.stack, gap !== undefined && { gap }]}>{children}</View>;
}

export function MobileScreenHeader({
  eyebrow,
  title,
  description,
}: MobileScreenHeaderProps) {
  return (
    <View style={styles.header}>
      {eyebrow ? <Text style={text.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  );
}

export function MobileCard({ children, style }: MobileCardProps) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function MobileSectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function MobileStatusPill({
  children,
  tone = "muted",
}: MobileStatusPillProps) {
  return (
    <View
      style={[
        styles.statusPill,
        tone === "success" && styles.statusPillSuccess,
        tone === "info" && styles.statusPillInfo,
        tone === "warning" && styles.statusPillWarning,
      ]}
    >
      <Text
        style={[
          styles.statusPillText,
          tone === "success" && styles.statusPillTextSuccess,
          tone === "info" && styles.statusPillTextInfo,
          tone === "warning" && styles.statusPillTextWarning,
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

export function MobileEmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  screen: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing[3],
    paddingBottom: layout.screenBottomPadding,
  },
  stack: {
    gap: layout.stackGap,
  },
  header: {
    gap: spacing[1],
    marginBottom: spacing[2],
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
  sectionLabel: {
    color: colors.sidebarMutedForeground,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  statusPill: {
    alignSelf: "flex-start",
    overflow: "hidden",
    borderRadius: radius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    backgroundColor: colors.accent,
  },
  statusPillSuccess: {
    backgroundColor: colors.successSubtle,
  },
  statusPillInfo: {
    backgroundColor: colors.infoSubtle,
  },
  statusPillWarning: {
    backgroundColor: colors.warningSubtle,
  },
  statusPillText: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  statusPillTextSuccess: {
    color: colors.success,
  },
  statusPillTextInfo: {
    color: colors.info,
  },
  statusPillTextWarning: {
    color: colors.warning,
  },
  empty: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[8],
    alignItems: "center",
    gap: 6,
  },
  emptyTitle: {
    color: colors.fg,
    fontSize: 15,
    fontWeight: "600",
  },
  emptyBody: {
    color: colors.faint,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    maxWidth: 280,
  },
});
