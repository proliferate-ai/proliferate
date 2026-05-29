import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { CloudChatComposerControlView } from "@proliferate/product-domain/chats/cloud/composer-controls";

import { useMobileHomeLaunchModel } from "../../hooks/home/derived/use-mobile-home-launch-model";
import { useMobileHomeLaunchActions } from "../../hooks/home/workflows/use-mobile-home-launch-actions";
import { useMobileWorkInventory } from "../../hooks/work/derived/use-mobile-work-inventory";
import type { MobileCloudChat } from "../../navigation/navigation-model";
import { MobileIcon, type MobileIconName } from "../primitives/MobileIcon";
import { MobileTextInput } from "../primitives/MobileTextInput";
import { MobilePopover } from "../primitives/popover/MobilePopover";
import { MobilePopoverDisclosure } from "../primitives/popover/MobilePopoverDisclosure";
import { MobilePopoverDivider } from "../primitives/popover/MobilePopoverDivider";
import { MobilePopoverGroup } from "../primitives/popover/MobilePopoverGroup";
import { MobilePopoverOption } from "../primitives/popover/MobilePopoverOption";
import { MobilePopoverRow } from "../primitives/popover/MobilePopoverRow";
import { MobileWorkspaceCard } from "../work/MobileWorkspaceCard";
import { colors, radius, spacing } from "../../styles/tokens";
import { MobileBranchPickerSheet } from "./MobileBranchPickerSheet";

interface MobileHomeScreenProps {
  ownerUserId: string | null;
  onOpenChat: (chat: MobileCloudChat) => void;
  onOpenDrawer: () => void;
  onConfigureRepos: () => void;
}

type HomeSheet = "repo" | "branch" | "runtime" | "config" | null;

export function MobileHomeScreen({
  ownerUserId,
  onOpenChat,
  onOpenDrawer,
  onConfigureRepos,
}: MobileHomeScreenProps) {
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
  const primaryModelControl =
    launchModel.launchComposerControls.find((control) => control.key === "model")
    ?? launchModel.launchComposerControls[launchModel.launchComposerControls.length - 1]
    ?? null;
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change model"
          onPress={() => setSheet("config")}
          style={({ pressed }) => [styles.modelSelector, pressed && styles.pressed]}
        >
          <Text style={styles.modelSelectorText} numberOfLines={1}>
            {controlValueLabel(primaryModelControl) ?? "Model"}
          </Text>
          <MobileIcon name="chevron-down" size={14} color={colors.faint} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open chat settings"
          onPress={() => setSheet("config")}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <MobileIcon name="controls" size={19} color={colors.fg} />
        </Pressable>
      </View>

      <Text style={styles.newChatLabel}>New chat</Text>

      <View style={styles.runtimeRow}>
        <View style={styles.runtimeRowLine} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose runtime"
          onPress={() => setSheet("runtime")}
          style={({ pressed }) => [styles.runtimeSelector, pressed && styles.pressed]}
        >
          <MobileIcon
            name={launchModel.selectedRuntime?.icon ?? "cloud"}
            size={15}
            color={colors.fg}
          />
          <Text style={styles.runtimeSelectorText} numberOfLines={1}>
            {launchModel.selectedRuntime?.label ?? "Choose runtime"}
          </Text>
          <View
            style={[
              styles.runtimeDot,
              launchModel.selectedRuntime?.kind === "target" && !launchModel.selectedRuntime.online && styles.runtimeDotOffline,
            ]}
          />
        </Pressable>
        <View style={styles.runtimeRowLine} />
      </View>
      {runtimeBlocker ? (
        <View style={styles.runtimeBlocker}>
          <MobileIcon name="lock" size={13} color={colors.destructive} />
          <Text style={styles.runtimeBlockerText}>{runtimeBlocker}</Text>
        </View>
      ) : null}

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

      <View style={styles.composer}>
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

      <MobilePopover
        visible={sheet === "runtime"}
        onClose={closeSheet}
        anchor="top-center"
        insetTop={138}
      >
        <MobilePopoverGroup>
          {launchModel.runtimeOptions.map((runtime) => {
            const offlineTarget = runtime.kind === "target" && !runtime.online;
            return (
              <MobilePopoverOption
                key={runtime.id}
                title={runtime.label}
                subtitle={offlineTarget ? `${runtime.description ?? ""} · Offline`.trim() : runtime.description ?? undefined}
                selected={runtime.id === launchModel.selectedRuntime?.id}
                disabled={offlineTarget}
                onSelect={() => {
                  launchModel.setRuntimeId(runtime.id);
                  closeSheet();
                }}
              />
            );
          })}
        </MobilePopoverGroup>
      </MobilePopover>

      <MobilePopover
        visible={sheet === "config"}
        onClose={closeSheet}
        anchor="top-right"
        insetTop={58}
      >
        <MobilePopoverGroup>
          {launchModel.launchComposerControls.map((control) => (
            <MobilePopoverDisclosure
              key={control.id}
              id={`control:${control.id}`}
              icon={controlIcon(control)}
              title={topLevelControlTitle(control)}
              value={controlValueLabel(control) ?? "Choose"}
              disabled={control.disabled}
            >
              {control.groups.flatMap((group) =>
                group.options.map((option) => (
                  <MobilePopoverOption
                    key={`${group.id}:${option.id}`}
                    title={normalizeModelLabel(option.label)}
                    subtitle={option.description ?? undefined}
                    selected={Boolean(option.selected)}
                    disabled={option.disabled}
                    onSelect={() => {
                      control.onSelect?.(option.id);
                      closeSheet();
                    }}
                  />
                )),
              )}
            </MobilePopoverDisclosure>
          ))}
        </MobilePopoverGroup>
      </MobilePopover>
    </KeyboardAvoidingView>
  );
}

function controlIcon(control: CloudChatComposerControlView | null): MobileIconName {
  switch (control?.icon) {
    case "brain":
      return "brain";
    case "sparkles":
      return "sparkles";
    case "openai":
      return "openai";
    case "claude":
      return "claude";
    case "gemini":
      return "gemini";
    case "opencodeBuild":
    case "bot":
      return "sparkles";
    case "settings":
      return "settings";
    default:
      return "cloud";
  }
}

function topLevelControlTitle(control: CloudChatComposerControlView): string {
  if (control.key === "model") {
    return "Model";
  }
  if (control.key === "mode") {
    return "Mode";
  }
  return control.label;
}

function controlValueLabel(control: CloudChatComposerControlView | null): string | null {
  if (!control) {
    return null;
  }
  const selected = selectedOptionLabel(control);
  const detail = control.detail;
  const value = detail && detail !== control.label && detail.toLowerCase() !== "mode"
    ? normalizeModelLabel(detail)
    : selected;
  if (!value) {
    return null;
  }
  return control.pendingState ? `Updating ${value}` : value;
}

function selectedOptionLabel(control: CloudChatComposerControlView): string | null {
  for (const group of control.groups) {
    const selected = group.options.find((option) => option.selected);
    if (selected) {
      return normalizeModelLabel(selected.label);
    }
  }
  return null;
}

function normalizeModelLabel(label: string): string {
  return label
    .replace(/^Claude\s*·\s*/i, "")
    .replace(/^Claude\s+(?=Sonnet|Haiku|Opus)/i, "")
    .replace(/^OpenAI\s*·\s*/i, "")
    .replace(/^Gemini\s*·\s*/i, "")
    .replace(/^Codex\s*·\s*/i, "");
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
  modelSelector: {
    maxWidth: "56%",
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.full,
    paddingHorizontal: spacing[2],
  },
  modelSelectorText: {
    minWidth: 0,
    color: colors.fg,
    fontSize: 15.5,
    fontWeight: "600",
  },
  newChatLabel: {
    alignSelf: "center",
    color: colors.faint,
    fontSize: 12,
    fontWeight: "500",
    marginTop: spacing[6],
    marginBottom: spacing[2],
  },
  runtimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[5],
  },
  runtimeRowLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  runtimeSelector: {
    minHeight: 34,
    maxWidth: "72%",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing[3],
  },
  runtimeSelectorText: {
    minWidth: 0,
    color: colors.fg,
    fontSize: 13,
    fontWeight: "600",
  },
  runtimeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  runtimeDotOffline: {
    backgroundColor: colors.destructive,
  },
  runtimeBlocker: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    alignSelf: "center",
    maxWidth: 340,
    marginTop: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: colors.destructiveSubtle,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  runtimeBlockerText: {
    flex: 1,
    color: colors.destructive,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
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
    gap: spacing[2],
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[3],
    overflow: "hidden",
  },
  repoPillWide: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  branchPill: {
    width: 148,
    maxWidth: "42%",
    flexShrink: 0,
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
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
