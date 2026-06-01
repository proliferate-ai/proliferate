import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "../../../styles/tokens";
import { MobileIcon } from "../../primitives/MobileIcon";
import { MobileTextInput } from "../../primitives/MobileTextInput";

export function MobileHomeComposer({
  draft,
  keyboardInset,
  repoLabel,
  branchLabel,
  branchDisabled,
  configLabel,
  configPending,
  canSubmit,
  onDraftChange,
  onOpenRepo,
  onOpenBranch,
  onOpenConfig,
  onSubmit,
}: {
  draft: string;
  keyboardInset: number;
  repoLabel: string;
  branchLabel: string;
  branchDisabled: boolean;
  configLabel: string;
  configPending: boolean;
  canSubmit: boolean;
  onDraftChange: (value: string) => void;
  onOpenRepo: () => void;
  onOpenBranch: () => void;
  onOpenConfig: () => void;
  onSubmit: () => void;
}) {
  return (
    <View style={[styles.composer, keyboardInset > 0 && { marginBottom: keyboardInset }]}>
      <View style={styles.composerCluster}>
        <View style={styles.selectorRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose repository"
            onPress={onOpenRepo}
            style={({ pressed }) => [styles.repoPill, styles.repoPillWide, pressed && styles.pressed]}
          >
            <MobileIcon name="git-branch" size={15} color={colors.fg} />
            <Text style={styles.repoPillText} numberOfLines={1}>
              {repoLabel}
            </Text>
            <MobileIcon name="chevron-right" size={14} color={colors.faint} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose branch"
            disabled={branchDisabled}
            onPress={onOpenBranch}
            style={({ pressed }) => [
              styles.repoPill,
              styles.branchPill,
              branchDisabled && styles.disabledPill,
              pressed && styles.pressed,
            ]}
          >
            <MobileIcon name="git-branch" size={15} color={colors.fg} />
            <Text style={styles.repoPillText} numberOfLines={1}>
              {branchLabel}
            </Text>
            <MobileIcon name="chevron-right" size={14} color={colors.faint} />
          </Pressable>
        </View>

        <View style={styles.composerCard}>
          <MobileTextInput
            autoFocus
            multiline
            value={draft}
            onChangeText={onDraftChange}
            placeholder="Describe a task"
            style={styles.composerInput}
          />
          <View style={styles.composerFooter}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open chat settings"
              onPress={onOpenConfig}
              style={({ pressed }) => [
                styles.configLink,
                configPending && styles.configLinkPending,
                pressed && styles.configLinkPressed,
              ]}
            >
              <Text style={styles.configLinkText} numberOfLines={1}>
                {configLabel}
              </Text>
              <MobileIcon name="chevron-down" size={10} color={colors.faint} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              accessibilityState={{ disabled: !canSubmit }}
              disabled={!canSubmit}
              onPress={onSubmit}
              style={({ pressed }) => [
                styles.send,
                !canSubmit && styles.sendDisabled,
                pressed && styles.sendPressed,
              ]}
            >
              <MobileIcon name="send" size={18} color={canSubmit ? colors.background : colors.faint} />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  composer: {
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[3],
    backgroundColor: colors.background,
  },
  composerCluster: {
    gap: spacing[3],
  },
  selectorRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[1],
  },
  repoPill: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[2],
    overflow: "hidden",
  },
  repoPillWide: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "68%",
  },
  branchPill: {
    minWidth: 92,
    maxWidth: "36%",
    flexShrink: 1,
  },
  disabledPill: {
    opacity: 0.55,
  },
  repoPillText: {
    flexShrink: 1,
    minWidth: 0,
    color: colors.fg,
    fontSize: 13,
    fontWeight: "600",
  },
  composerCard: {
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    gap: spacing[2],
  },
  composerInput: {
    minHeight: 23,
    maxHeight: 200,
    borderWidth: 0,
    backgroundColor: "transparent",
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    color: colors.fg,
    fontSize: 17,
    lineHeight: 23,
  },
  composerFooter: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  configLink: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "82%",
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.md,
    paddingHorizontal: 2,
  },
  configLinkPending: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing[2],
  },
  configLinkPressed: {
    opacity: 0.82,
  },
  configLinkText: {
    flexShrink: 1,
    minWidth: 0,
    color: colors.mutedForeground,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "400",
    includeFontPadding: false,
  },
  send: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.fg,
  },
  sendDisabled: {
    backgroundColor: colors.accent,
  },
  sendPressed: {
    opacity: 0.85,
  },
  pressed: {
    opacity: 0.7,
  },
});
