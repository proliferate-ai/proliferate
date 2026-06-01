import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useMobileHomeLaunchModel } from "../../hooks/home/derived/use-mobile-home-launch-model";
import { useMobileHomeLaunchActions } from "../../hooks/home/workflows/use-mobile-home-launch-actions";
import { useVisualViewportKeyboardInset } from "../../hooks/ui/keyboard/use-visual-viewport-keyboard-inset";
import { useMobileWorkInventory } from "../../hooks/work/derived/use-mobile-work-inventory";
import { summarizeMobileHomeLaunchConfig } from "../../lib/domain/home/mobile-home-config-summary";
import type { MobileCloudChat } from "../../navigation/navigation-model";
import { MobileIcon } from "../primitives/MobileIcon";
import { MobileTextInput } from "../primitives/MobileTextInput";
import { MobilePopover } from "../primitives/popover/MobilePopover";
import { MobilePopoverDivider } from "../primitives/popover/MobilePopoverDivider";
import { MobilePopoverGroup } from "../primitives/popover/MobilePopoverGroup";
import { MobilePopoverOption } from "../primitives/popover/MobilePopoverOption";
import { MobilePopoverRow } from "../primitives/popover/MobilePopoverRow";
import { MobileWorkspaceCard } from "../work/MobileWorkspaceCard";
import { colors, radius, spacing } from "../../styles/tokens";
import { MobileBranchPickerSheet } from "./MobileBranchPickerSheet";
import { MobileHomeConfigSheet } from "./screen/MobileHomeConfigSheet";

interface MobileHomeScreenProps {
  ownerUserId: string | null;
  onOpenChat: (chat: MobileCloudChat) => void;
  onOpenDrawer: () => void;
  onConfigureRepos: () => void;
}

type HomeSheet = "repo" | "branch" | "config" | null;

export function MobileHomeScreen({
  ownerUserId,
  onOpenChat,
  onOpenDrawer,
  onConfigureRepos,
}: MobileHomeScreenProps) {
  const keyboardInset = useVisualViewportKeyboardInset();
  const [draft, setDraft] = useState("");
  const [sheet, setSheet] = useState<HomeSheet>(null);
  const launchModel = useMobileHomeLaunchModel();
  const recentInventory = useMobileWorkInventory();
  const recentItems = recentInventory.recentItems.slice(0, 2);
  const launchActions = useMobileHomeLaunchActions({
    ownerUserId,
    catalog: launchModel.agentCatalog.data,
    launchableAgentKinds: launchModel.launchableAgentKinds,
    selectedRepo: launchModel.selectedRepo,
    selectedBaseBranch: launchModel.selectedBaseBranch,
    selectedRuntime: launchModel.selectedRuntime,
    selection: launchModel.resolvedLaunchSelection,
    onOpenChat,
    onSubmitted: () => setDraft(""),
  });
  const launchConfigSummary = summarizeMobileHomeLaunchConfig(
    launchModel.launchComposerControls,
    launchModel.selectedRuntime?.label ?? "Runtime",
  );
  const canStartCloudHarness = launchModel.launchableAgentKinds.length > 0;
  const canSubmit = Boolean(draft.trim())
    && Boolean(launchModel.selectedRepo)
    && Boolean(launchModel.selectedRuntime)
    && canStartCloudHarness
    && !launchActions.submitting
    && (launchModel.selectedRuntime?.kind !== "target" || launchModel.selectedRuntime.online);
  const runtimeBlocker = launchModel.selectedRuntime?.kind === "target" && !launchModel.selectedRuntime.online
    ? `${launchModel.selectedRuntime.label} is offline. Open Desktop or choose Cloud sandbox to start this chat.`
    : null;

  function closeSheet() {
    setSheet(null);
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.select({ ios: "padding", default: undefined })}
      keyboardVerticalOffset={0}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open navigation"
          onPress={onOpenDrawer}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <MobileIcon name="menu" size={20} color={colors.fg} />
        </Pressable>
        <Text style={styles.headerTitle}>New chat</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open chat settings"
          onPress={() => setSheet("config")}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <MobileIcon name="controls" size={19} color={colors.fg} />
        </Pressable>
      </View>

      {recentItems.length > 0 ? (
        <View style={styles.recentSection}>
          <View style={styles.recentHeader}>
            <Text style={styles.recentTitle}>Recent</Text>
          </View>
          <View style={styles.recentCards}>
            {recentItems.map((item) => (
              <MobileWorkspaceCard
                key={item.view.id}
                item={item}
                compact
                onPress={() => onOpenChat(item.chat)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.spacer} />

      {launchActions.status || launchActions.error || (!canStartCloudHarness && launchModel.harnessAvailability.message) ? (
        <Text style={[styles.launchNote, launchActions.error && styles.launchError]}>
          {launchActions.error ?? launchActions.status ?? launchModel.harnessAvailability.message}
        </Text>
      ) : null}
      {runtimeBlocker ? (
        <Text style={[styles.launchNote, styles.launchError]}>
          {runtimeBlocker}
        </Text>
      ) : null}

      <View style={[styles.composer, keyboardInset > 0 && { marginBottom: keyboardInset }]}>
        <View style={styles.composerCluster}>
          <View style={styles.selectorRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose repository"
              onPress={() => setSheet("repo")}
              style={({ pressed }) => [styles.repoPill, styles.repoPillWide, pressed && styles.pressed]}
            >
              <MobileIcon name="git-branch" size={15} color={colors.fg} />
              <Text style={styles.repoPillText} numberOfLines={1}>
                {launchModel.selectedRepo?.label ?? "Choose a GitHub repo"}
              </Text>
              <MobileIcon name="chevron-right" size={14} color={colors.faint} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose branch"
              disabled={!launchModel.selectedRepo}
              onPress={() => setSheet("branch")}
              style={({ pressed }) => [
                styles.repoPill,
                styles.branchPill,
                !launchModel.selectedRepo && styles.disabledPill,
                pressed && styles.pressed,
              ]}
            >
              <MobileIcon name="git-branch" size={15} color={colors.fg} />
              <Text style={styles.repoPillText} numberOfLines={1}>
                {launchModel.selectedBaseBranch ?? (launchModel.repoBranches.isLoading ? "Loading" : "Branch")}
              </Text>
              <MobileIcon name="chevron-right" size={14} color={colors.faint} />
            </Pressable>
          </View>

          <View style={styles.composerCard}>
            <MobileTextInput
              autoFocus
              multiline
              value={draft}
              onChangeText={setDraft}
              placeholder="Describe a task"
              style={styles.composerInput}
            />
            <View style={styles.composerFooter}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open chat settings"
                onPress={() => setSheet("config")}
                style={({ pressed }) => [
                  styles.configLink,
                  launchConfigSummary.pending && styles.configLinkPending,
                  pressed && styles.configLinkPressed,
                ]}
              >
                <Text style={styles.configLinkText} numberOfLines={1}>
                  {launchConfigSummary.label}
                </Text>
                <MobileIcon name="chevron-down" size={10} color={colors.faint} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send"
                accessibilityState={{ disabled: !canSubmit }}
                disabled={!canSubmit}
                onPress={() => {
                  void launchActions.submit(draft);
                }}
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

      <MobilePopover
        visible={sheet === "repo"}
        onClose={closeSheet}
        anchor="bottom-left"
        insetSide={20}
        insetBottom={140}
        width={300}
      >
        <MobilePopoverGroup>
          {launchModel.repoConfigs.isLoading ? (
            <MobilePopoverRow id="loading" icon="git-branch" title="Loading repositories..." disabled />
          ) : launchModel.repoOptions.length === 0 ? (
            <MobilePopoverRow id="empty" icon="git-branch" title="No configured repositories" disabled />
          ) : (
            launchModel.repoOptions.map((repo) => (
              <MobilePopoverOption
                key={repo.id}
                title={repo.label}
                subtitle={repo.description ?? undefined}
                selected={repo.id === launchModel.selectedRepo?.id}
                onSelect={() => {
                  launchModel.setRepoId(repo.id);
                  closeSheet();
                }}
              />
            ))
          )}
          <MobilePopoverDivider />
          <MobilePopoverRow
            id="configure-repos"
            icon="settings"
            title="Configure on GitHub"
            subtitle="Add or manage repos in Settings"
            onPress={() => {
              closeSheet();
              onConfigureRepos();
            }}
          />
        </MobilePopoverGroup>
      </MobilePopover>

      <MobileBranchPickerSheet
        visible={sheet === "branch"}
        onClose={closeSheet}
        loading={launchModel.repoBranches.isLoading}
        branches={launchModel.branchOptions}
        selectedBranch={launchModel.selectedBaseBranch}
        repoLabel={launchModel.selectedRepo?.label}
        onSelect={launchModel.setBaseBranch}
      />

      <MobileHomeConfigSheet
        visible={sheet === "config"}
        onClose={closeSheet}
        controls={launchModel.launchComposerControls}
        runtimeOptions={launchModel.runtimeOptions}
        selectedRuntimeId={launchModel.selectedRuntime?.id ?? null}
        onRuntimeSelect={launchModel.setRuntimeId}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    minHeight: Platform.OS === "web" ? 48 : 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[3],
  },
  headerButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  headerTitle: {
    color: colors.fg,
    fontSize: 15.5,
    fontWeight: "700",
  },
  recentSection: {
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    marginTop: spacing[6],
  },
  recentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  recentTitle: {
    color: colors.faint,
    fontSize: 12.5,
    fontWeight: "600",
  },
  recentCards: {
    gap: spacing[2],
  },
  spacer: {
    flex: 1,
  },
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
  launchNote: {
    minHeight: 18,
    color: colors.faint,
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: spacing[2],
    textAlign: "center",
  },
  launchError: {
    color: colors.destructive,
  },
  pressed: {
    opacity: 0.7,
  },
});
