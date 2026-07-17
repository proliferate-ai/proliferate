import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import type { MobileRepoReadinessBlocker as MobileRepoReadinessBlockerView } from "../../../lib/domain/repos/mobile-repo-readiness-blocker";
import { MobileIcon } from "../../primitives/MobileIcon";
import { colors, radius, spacing } from "../../../styles/tokens";

/**
 * Native presentation of the shared repository-readiness blocker: an icon,
 * title, description, and (when repairable here) a single CTA. Operator and
 * human-access states render explanation with no button. No tokens or private
 * keys are ever shown — only the server-issued browser handoff.
 */
export function MobileRepoReadinessBlocker({
  blocker,
  onAction,
}: {
  blocker: MobileRepoReadinessBlockerView;
  onAction: () => void;
}) {
  const showCta = blocker.actionKind !== "none" && blocker.actionLabel !== null;
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.iconTile}>
          {blocker.pending ? (
            <ActivityIndicator color={colors.faint} />
          ) : (
            <MobileIcon name="shield" size={16} color={colors.faint} />
          )}
        </View>
        <View style={styles.textBlock}>
          <Text style={styles.title}>{blocker.title}</Text>
          <Text style={styles.description}>{blocker.description}</Text>
        </View>
      </View>
      {showCta ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={blocker.actionLabel ?? undefined}
          accessibilityState={{ disabled: blocker.pending }}
          disabled={blocker.pending}
          onPress={onAction}
          style={({ pressed }) => [
            styles.cta,
            blocker.pending && styles.ctaDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.ctaText}>{blocker.actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
  },
  iconTile: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  title: {
    color: colors.fg,
    fontSize: 14.5,
    fontWeight: "600",
  },
  description: {
    color: colors.faint,
    fontSize: 13,
    lineHeight: 18,
  },
  cta: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: colors.fg,
    paddingHorizontal: spacing[4],
  },
  ctaDisabled: {
    opacity: 0.62,
  },
  ctaText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.8,
  },
});
