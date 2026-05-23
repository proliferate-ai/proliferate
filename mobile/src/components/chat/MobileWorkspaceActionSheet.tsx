import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "../../styles/tokens";
import { MobileIcon } from "../primitives/MobileIcon";

interface MobileWorkspaceActionSheetProps {
  visible: boolean;
  branchLabel: string;
  visibilityLabel: string;
  liveLabel: string;
  transcriptLabel: string;
  unclaimed: boolean;
  claimPending: boolean;
  onClaim: () => boolean | Promise<boolean>;
  onNewSession: () => void;
  onOpenSessions: () => void;
  onShareBranch: () => void;
  onClose: () => void;
}

export function MobileWorkspaceActionSheet({
  visible,
  branchLabel,
  visibilityLabel,
  liveLabel,
  transcriptLabel,
  unclaimed,
  claimPending,
  onClaim,
  onNewSession,
  onOpenSessions,
  onShareBranch,
  onClose,
}: MobileWorkspaceActionSheetProps) {
  function run(action: () => void) {
    action();
    onClose();
  }

  async function runClaim() {
    const claimed = await onClaim();
    if (claimed) {
      onClose();
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.layer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close workspace actions"
          style={styles.scrim}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Workspace</Text>
            {unclaimed ? (
              <View style={styles.lockedPill}>
                <MobileIcon name="lock" size={11} color={colors.warning} />
                <Text style={styles.lockedText}>Read-only</Text>
              </View>
            ) : null}
          </View>

          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetScrollContent}>
            <View style={styles.summary}>
              <SummaryChip label={branchLabel} icon="git-branch" />
              <SummaryChip label={visibilityLabel} icon={unclaimed ? "lock" : "cloud"} />
              <SummaryChip label={liveLabel} icon="cloud" />
              <SummaryChip label={transcriptLabel} icon="sessions" />
            </View>

            {unclaimed ? (
              <ActionRow
                icon="hand"
                title={claimPending ? "Claiming workspace" : "Claim workspace"}
                subtitle="Unlock replies, new sessions, and git actions."
                disabled={claimPending}
                onPress={() => {
                  void runClaim();
                }}
              />
            ) : null}
            <ActionRow
              icon="sessions"
              title="Sessions"
              subtitle="Switch sessions or create a new one."
              onPress={() => run(onOpenSessions)}
            />
            <ActionRow
              icon="plus"
              title="New session"
              subtitle={unclaimed ? "Claim this workspace before starting a session." : "Start a fresh session in this workspace."}
              disabled={unclaimed}
              onPress={() => run(onNewSession)}
            />
            <ActionRow
              icon="git-branch"
              title="Copy branch name"
              subtitle={branchLabel}
              onPress={() => run(onShareBranch)}
            />
            <ActionRow
              icon="external"
              title="Git actions"
              subtitle={unclaimed ? "Claim this workspace before git actions." : "PR and diff actions are not available on mobile yet."}
              disabled
              onPress={onClose}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function SummaryChip({
  label,
  icon,
}: {
  label: string;
  icon: "git-branch" | "lock" | "cloud" | "sessions";
}) {
  return (
    <View style={styles.summaryChip}>
      <MobileIcon name={icon} size={12} color={colors.faint} />
      <Text style={styles.summaryChipText} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function ActionRow({
  icon,
  title,
  subtitle,
  disabled,
  onPress,
}: {
  icon: "hand" | "sessions" | "plus" | "git-branch" | "external";
  title: string;
  subtitle: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        disabled && styles.actionDisabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.actionIcon}>
        <MobileIcon name={icon} size={17} color={disabled ? colors.faint : colors.fg} />
      </View>
      <View style={styles.actionText}>
        <Text style={[styles.actionTitle, disabled && styles.actionTitleDisabled]}>{title}</Text>
        <Text style={styles.actionSubtitle}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  layer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlayStrong,
  },
  sheet: {
    maxHeight: "82%",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[6],
    gap: spacing[3],
  },
  sheetScroll: {
    minHeight: 0,
  },
  sheetScrollContent: {
    gap: spacing[3],
    paddingBottom: spacing[1],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: colors.fg,
    fontSize: 18,
    fontWeight: "700",
  },
  lockedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.full,
    backgroundColor: colors.warningSubtle,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
  },
  lockedText: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: "700",
  },
  summary: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
    paddingBottom: spacing[1],
  },
  summaryChip: {
    maxWidth: "48%",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
  },
  summaryChipText: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "600",
  },
  action: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  actionDisabled: {
    opacity: 0.52,
  },
  actionIcon: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  actionText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  actionTitle: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "700",
  },
  actionTitleDisabled: {
    color: colors.faint,
  },
  actionSubtitle: {
    color: colors.faint,
    fontSize: 12,
    lineHeight: 16,
  },
  pressed: {
    opacity: 0.7,
  },
});
