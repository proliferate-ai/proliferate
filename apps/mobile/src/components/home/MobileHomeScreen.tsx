import { useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  cloudComposerControlGroupLabel,
  cloudComposerControlTitle,
  formatCloudComposerControlValueLabel,
  normalizeCloudComposerModelLabel,
  summarizeCloudComposerBadgeControls,
  type CloudChatComposerControlOptionView,
  type CloudChatComposerControlView,
} from "@proliferate/product-domain/chats/cloud/composer-controls";

import { useMobileHomeLaunchModel } from "../../hooks/home/derived/use-mobile-home-launch-model";
import { useMobileHomeLaunchActions } from "../../hooks/home/workflows/use-mobile-home-launch-actions";
import { useMobileWorkInventory } from "../../hooks/work/derived/use-mobile-work-inventory";
import type { MobileRuntimeOption } from "../../lib/domain/home/mobile-home-launch";
import type { MobileCloudChat } from "../../navigation/navigation-model";
import { MobileIcon, type MobileIconName } from "../primitives/MobileIcon";
import { MobileTextInput } from "../primitives/MobileTextInput";
import { MobilePopover } from "../primitives/popover/MobilePopover";
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

type HomeSheet = "repo" | "branch" | "config" | null;

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
  const launchConfigSummary = summarizeLaunchConfig(
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

      <HomeConfigSheet
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

function HomeConfigSheet({
  visible,
  controls,
  runtimeOptions,
  selectedRuntimeId,
  onRuntimeSelect,
  onClose,
}: {
  visible: boolean;
  controls: readonly CloudChatComposerControlView[];
  runtimeOptions: readonly MobileRuntimeOption[];
  selectedRuntimeId: string | null;
  onRuntimeSelect: (runtimeId: string) => void;
  onClose: () => void;
}) {
  const [detailControlId, setDetailControlId] = useState<string | null>(null);
  const detailControl = controls.find((control) => control.id === detailControlId) ?? null;

  function close() {
    setDetailControlId(null);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.sheetLayer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close chat settings"
          style={styles.sheetScrim}
          onPress={close}
        />
        <View style={styles.sheet}>
          <View style={styles.sheetGrabber} />
          {detailControl ? (
            <View style={styles.detail}>
              <View style={styles.detailHeader}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back to settings"
                  onPress={() => setDetailControlId(null)}
                  style={({ pressed }) => [styles.detailBack, pressed && styles.pressed]}
                >
                  <MobileIcon name="chevron-left" size={18} color={colors.fg} />
                </Pressable>
                <Text style={styles.detailTitle}>{cloudComposerControlTitle(detailControl)}</Text>
              </View>
              <ScrollView
                style={styles.sheetScroll}
                contentContainerStyle={styles.detailContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {detailControl.groups.map((group) => {
                  const label = cloudComposerControlGroupLabel(detailControl, group);
                  return (
                    <View key={group.id} style={styles.optionGroup}>
                      {label ? <Text style={styles.optionGroupTitle}>{label}</Text> : null}
                      {group.options.map((option) => (
                        <HomeOptionRow
                          key={option.id}
                          option={option}
                          onPress={() => {
                            detailControl.onSelect?.(option.id);
                            setDetailControlId(null);
                          }}
                        />
                      ))}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          ) : (
            <ScrollView
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <HomeSheetSection title="Configuration">
                {controls.map((control) => (
                  <HomeSheetRow
                    key={control.id}
                    icon={controlIcon(control)}
                    title={cloudComposerControlTitle(control)}
                    value={formatCloudComposerControlValueLabel(control) ?? "Choose"}
                    disabled={control.disabled}
                    onPress={() => setDetailControlId(control.id)}
                  />
                ))}
              </HomeSheetSection>
              <HomeSheetSection title="Runtime">
                {runtimeOptions.map((runtime) => {
                  const offline = runtime.kind === "target" && !runtime.online;
                  return (
                    <HomeSheetRow
                      key={runtime.id}
                      icon={runtime.icon}
                      title={runtime.label}
                      subtitle={offline ? `${runtime.description} · Offline` : runtime.description}
                      selected={runtime.id === selectedRuntimeId}
                      disabled={offline}
                      chevron={false}
                      onPress={() => {
                        onRuntimeSelect(runtime.id);
                      }}
                    />
                  );
                })}
              </HomeSheetSection>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function HomeSheetSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.sheetSection}>
      <Text style={styles.sheetSectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function HomeSheetRow({
  icon,
  title,
  subtitle,
  value,
  selected,
  disabled,
  chevron = true,
  onPress,
}: {
  icon: MobileIconName;
  title: string;
  subtitle?: string | null;
  value?: string | null;
  selected?: boolean;
  disabled?: boolean;
  chevron?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sheetRow,
        selected && styles.sheetRowSelected,
        disabled && styles.disabledPill,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      <View style={styles.sheetRowIcon}>
        <MobileIcon name={icon} size={16} color={disabled ? colors.faint : colors.fg} />
      </View>
      <View style={styles.sheetRowText}>
        <Text style={[styles.sheetRowTitle, disabled && styles.sheetRowTitleDisabled]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.sheetRowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={styles.sheetRowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {selected ? <MobileIcon name="check" size={15} color={colors.fg} /> : null}
      {chevron ? <MobileIcon name="chevron-right" size={14} color={colors.faint} /> : null}
    </Pressable>
  );
}

function HomeOptionRow({
  option,
  onPress,
}: {
  option: CloudChatComposerControlOptionView;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(option.selected), disabled: option.disabled }}
      disabled={option.disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionRow,
        option.selected && styles.sheetRowSelected,
        option.disabled && styles.disabledPill,
        pressed && !option.disabled ? styles.pressed : null,
      ]}
    >
      <View style={styles.optionCheck}>
        {option.selected ? <MobileIcon name="check" size={15} color={colors.fg} /> : null}
      </View>
      <View style={styles.sheetRowText}>
        <Text style={[styles.optionTitle, option.disabled && styles.sheetRowTitleDisabled]} numberOfLines={1}>
          {normalizeCloudComposerModelLabel(option.label)}
        </Text>
        {option.description ? (
          <Text style={styles.sheetRowSubtitle} numberOfLines={2}>
            {option.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function summarizeLaunchConfig(
  controls: readonly CloudChatComposerControlView[],
  runtimeLabel: string,
): { label: string; pending: boolean } {
  const badge = summarizeCloudComposerBadgeControls(controls);
  return {
    label: joinUniqueLabels([badge.label, runtimeLabel]) || "Chat settings",
    pending: badge.pending,
  };
}

function joinUniqueLabels(labels: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const label of labels) {
    const trimmed = label?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(trimmed);
  }
  return parts.join(" · ");
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
    color: colors.faint,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: "600",
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
  sheetLayer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    maxHeight: "78%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderHeavy,
    backgroundColor: colors.popover,
    paddingTop: spacing[2],
    paddingBottom: spacing[4],
  },
  sheetGrabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderHeavy,
    marginBottom: spacing[2],
  },
  sheetScroll: {
    minHeight: 0,
  },
  sheetContent: {
    paddingBottom: spacing[2],
  },
  sheetSection: {
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetSectionTitle: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingHorizontal: spacing[2],
    paddingBottom: spacing[2],
  },
  sheetRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
  },
  sheetRowSelected: {
    backgroundColor: colors.accent,
  },
  sheetRowIcon: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetRowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sheetRowTitle: {
    color: colors.fg,
    fontSize: 13.5,
    fontWeight: "600",
  },
  sheetRowTitleDisabled: {
    color: colors.faint,
  },
  sheetRowSubtitle: {
    color: colors.faint,
    fontSize: 11.5,
    lineHeight: 15,
  },
  sheetRowValue: {
    maxWidth: "42%",
    color: colors.mutedForeground,
    fontSize: 12.5,
    fontWeight: "500",
  },
  detail: {
    minHeight: 260,
  },
  detailHeader: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  detailBack: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  detailTitle: {
    color: colors.fg,
    fontSize: 15.5,
    fontWeight: "700",
  },
  detailContent: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    gap: spacing[3],
  },
  optionGroup: {
    gap: spacing[1],
  },
  optionGroupTitle: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingHorizontal: spacing[2],
    paddingBottom: spacing[1],
  },
  optionRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
  },
  optionCheck: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  optionTitle: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "600",
  },
});
