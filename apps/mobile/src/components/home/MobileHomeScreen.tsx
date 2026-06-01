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
import { colors, radius, spacing } from "../../styles/tokens";
import { MobileBranchPickerSheet } from "./MobileBranchPickerSheet";
import { MobileHomeComposer } from "./screen/MobileHomeComposer";
import { MobileHomeConfigSheet } from "./screen/MobileHomeConfigSheet";
import { MobileHomeRecentSection } from "./screen/MobileHomeRecentSection";
import { MobileHomeRepoPopover } from "./screen/MobileHomeRepoPopover";

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

      <MobileHomeRecentSection items={recentItems} onOpenChat={onOpenChat} />

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

      <MobileHomeComposer
        draft={draft}
        keyboardInset={keyboardInset}
        repoLabel={launchModel.selectedRepo?.label ?? "Choose a GitHub repo"}
        branchLabel={launchModel.selectedBaseBranch ?? (launchModel.repoBranches.isLoading ? "Loading" : "Branch")}
        branchDisabled={!launchModel.selectedRepo}
        configLabel={launchConfigSummary.label}
        configPending={launchConfigSummary.pending}
        canSubmit={canSubmit}
        onDraftChange={setDraft}
        onOpenRepo={() => setSheet("repo")}
        onOpenBranch={() => setSheet("branch")}
        onOpenConfig={() => setSheet("config")}
        onSubmit={() => {
          void launchActions.submit(draft);
        }}
      />

      <MobileHomeRepoPopover
        visible={sheet === "repo"}
        loading={launchModel.repoConfigs.isLoading}
        repoOptions={launchModel.repoOptions}
        selectedRepoId={launchModel.selectedRepo?.id ?? null}
        onSelectRepo={launchModel.setRepoId}
        onConfigureRepos={onConfigureRepos}
        onClose={closeSheet}
      />

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
  spacer: {
    flex: 1,
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
