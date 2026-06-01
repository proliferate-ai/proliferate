import { Pressable, StyleSheet, Text, View } from "react-native";

import { formatSessionCount, type MobileStatusValue } from "../../../lib/domain/chat/mobile-chat-presentation";
import { MobileIcon } from "../../primitives/MobileIcon";
import { MobileStatusDot } from "../../primitives/MobileStatusDot";
import { MobileTopBar, MobileTopBarIconButton } from "../../primitives/MobileTopBar";
import { colors, radius, spacing } from "../../../styles/tokens";

interface MobileChatHeaderProps {
  title: string;
  subtitle: string;
  status: MobileStatusValue;
  sessionsCount: number;
  unclaimed: boolean;
  onBack: () => void;
  onOpenSessions: () => void;
  onOpenActions: () => void;
}

export function MobileChatHeader({
  title,
  subtitle,
  status,
  sessionsCount,
  unclaimed,
  onBack,
  onOpenSessions,
  onOpenActions,
}: MobileChatHeaderProps) {
  return (
    <View style={styles.headerWrapper}>
      <MobileTopBar
        title={title}
        subtitle={subtitle}
        leading={{ kind: "back", onPress: onBack }}
        trailing={
          <View style={styles.headerActions}>
            <MobileStatusDot status={status} />
            {sessionsCount > 0 ? (
              <View style={styles.sessionActionGroup}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Switch sessions. ${formatSessionCount(sessionsCount)}.`}
                  disabled={unclaimed}
                  onPress={onOpenSessions}
                  style={({ pressed }) => [
                    styles.sessionCountButton,
                    unclaimed && styles.sessionCountButtonDisabled,
                    pressed && !unclaimed && styles.headerButtonPressed,
                  ]}
                >
                  <MobileIcon name="sessions" size={14} color={colors.faint} />
                  <Text style={styles.sessionCountText}>{sessionsCount}</Text>
                </Pressable>
                <View style={styles.sessionActionDivider} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Workspace actions"
                  onPress={onOpenActions}
                  style={({ pressed }) => [styles.sessionDotsButton, pressed && styles.headerButtonPressed]}
                >
                  <MobileIcon name="more" size={18} color={colors.fg} />
                </Pressable>
              </View>
            ) : (
              <MobileTopBarIconButton
                name="more"
                accessibilityLabel="Workspace actions"
                onPress={onOpenActions}
              />
            )}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrapper: {
    backgroundColor: colors.background,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingRight: spacing[1],
  },
  sessionActionGroup: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.accent,
  },
  sessionCountButton: {
    height: 32,
    minWidth: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: spacing[2],
  },
  sessionCountButtonDisabled: {
    opacity: 0.48,
  },
  sessionCountText: {
    color: colors.fg,
    fontSize: 12,
    fontWeight: "700",
  },
  sessionActionDivider: {
    width: StyleSheet.hairlineWidth,
    height: 18,
    backgroundColor: colors.border,
  },
  sessionDotsButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerButtonPressed: {
    opacity: 0.68,
  },
});
