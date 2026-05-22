import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type {
  AutomationResponse,
  CloudAgentRunConfig,
} from "@proliferate/cloud-sdk";
import {
  useAutomations,
  useCloudAgentRunConfigs,
  useCloudRepoConfigs,
  useCreateAutomation,
  usePauseAutomation,
  useResumeAutomation,
} from "@proliferate/cloud-sdk-react";

import { MobileIcon } from "../primitives/MobileIcon";
import { MobileListRow } from "../primitives/MobileListRow";
import {
  MobileEmptyState,
  MobileScreen,
  MobileSectionLabel,
} from "../primitives/MobileLayout";
import { MobileStatusDot } from "../primitives/MobileStatusDot";
import { MobileTextInput } from "../primitives/MobileTextInput";
import { colors, radius, spacing } from "../../styles/tokens";

type Cadence = "daily" | "weekly";

interface RepoOption {
  id: string;
  gitOwner: string;
  gitRepoName: string;
  label: string;
}

export function MobileAutomationsScreen() {
  const [showNew, setShowNew] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [togglingAutomationId, setTogglingAutomationId] = useState<string | null>(null);
  const automations = useAutomations({ ownerScope: "personal" });
  const pauseAutomation = usePauseAutomation({ ownerScope: "personal" });
  const resumeAutomation = useResumeAutomation({ ownerScope: "personal" });

  async function toggleAutomation(automation: AutomationResponse) {
    if (togglingAutomationId) {
      return;
    }
    setToggleError(null);
    setTogglingAutomationId(automation.id);
    try {
      if (automation.enabled) {
        await pauseAutomation.mutateAsync(automation.id);
      } else {
        await resumeAutomation.mutateAsync(automation.id);
      }
    } catch (error) {
      setToggleError(
        error instanceof Error
          ? error.message
          : "Automation status could not be changed.",
      );
    } finally {
      setTogglingAutomationId(null);
    }
  }

  return (
    <MobileScreen contentStyle={styles.screenContent}>
      <View style={styles.header}>
        <Text style={styles.headerText}>Cloud automations for personal workspaces.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create automation"
          onPress={() => setShowNew(true)}
          style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}
        >
          <MobileIcon name="plus" size={15} color={colors.background} />
          <Text style={styles.newButtonText}>New</Text>
        </Pressable>
      </View>

      {automations.isLoading ? (
        <MobileEmptyState title="Loading automations" body="Fetching scheduled cloud work." />
      ) : automations.error ? (
        <MobileEmptyState
          title="Could not load automations"
          body="Refresh later or sign in again."
        />
      ) : (automations.data?.automations ?? []).length === 0 ? (
        <MobileEmptyState
          title="No automations yet"
          body="Create a personal cloud automation from mobile."
        />
      ) : (
        <View style={styles.list}>
          {toggleError ? <Text style={styles.listErrorText}>{toggleError}</Text> : null}
          {(automations.data?.automations ?? []).map((automation) => (
            <AutomationRow
              key={automation.id}
              automation={automation}
              busy={togglingAutomationId === automation.id}
              onToggle={() => void toggleAutomation(automation)}
            />
          ))}
        </View>
      )}

      <Text style={styles.footnote}>
        Desktop still runs automation kinds that need local compute, browser, or computer use.
      </Text>

      <NewAutomationSheet
        visible={showNew}
        onClose={() => setShowNew(false)}
      />
    </MobileScreen>
  );
}

function AutomationRow({
  automation,
  busy,
  onToggle,
}: {
  automation: AutomationResponse;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <MobileListRow
      leading={<MobileStatusDot status={automation.enabled ? "running" : "paused"} size={8} />}
      title={automation.title}
      subtitle={`${automation.schedule.summary} - ${automation.gitOwner}/${automation.gitRepoName}`}
      trailing={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={automation.enabled ? "Pause automation" : "Resume automation"}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={onToggle}
          style={({ pressed }) => [
            styles.statusPill,
            !automation.enabled && styles.statusPillPaused,
            busy && styles.statusPillDisabled,
            pressed && styles.pressed,
          ]}
        >
          <MobileIcon name="calendar-clock" size={12} color={automation.enabled ? colors.success : colors.faint} />
          <Text style={[styles.statusText, !automation.enabled && styles.statusTextPaused]}>
            {automation.enabled ? "On" : "Paused"}
          </Text>
        </Pressable>
      }
    />
  );
}

function NewAutomationSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [repoId, setRepoId] = useState("");
  const [configId, setConfigId] = useState("");
  const [cadence, setCadence] = useState<Cadence>("daily");
  const [error, setError] = useState<string | null>(null);
  const repoConfigs = useCloudRepoConfigs(visible);
  const agentConfigs = useCloudAgentRunConfigs(
    { usableIn: "personal_sandboxes", status: "active" },
    visible,
  );
  const createAutomation = useCreateAutomation({ ownerScope: "personal" });
  const repoOptions = useMemo(
    () => buildRepoOptions(repoConfigs.data?.configs ?? []),
    [repoConfigs.data?.configs],
  );
  const runConfigs = useMemo(
    () => (agentConfigs.data?.configs ?? []).filter((config) =>
      config.status === "active" && config.usableInPersonalSandboxes
    ),
    [agentConfigs.data?.configs],
  );
  const selectedRepo = repoOptions.find((repo) => repo.id === repoId) ?? repoOptions[0] ?? null;
  const selectedConfig = runConfigs.find((config) => config.id === configId) ?? runConfigs[0] ?? null;

  useEffect(() => {
    if (visible && !repoId && repoOptions[0]) {
      setRepoId(repoOptions[0].id);
    }
  }, [repoId, repoOptions, visible]);

  useEffect(() => {
    if (visible && !configId && runConfigs[0]) {
      setConfigId(runConfigs[0].id);
    }
  }, [configId, runConfigs, visible]);

  async function submit() {
    const cleanTitle = title.trim() || prompt.trim().slice(0, 48) || "Mobile automation";
    const cleanPrompt = prompt.trim();
    if (!selectedRepo || !selectedConfig || !cleanPrompt) {
      setError("Choose a repository, agent config, and prompt.");
      return;
    }
    setError(null);
    try {
      await createAutomation.mutateAsync({
        title: cleanTitle,
        prompt: cleanPrompt,
        ownerScope: "personal",
        gitOwner: selectedRepo.gitOwner,
        gitRepoName: selectedRepo.gitRepoName,
        targetMode: "personal_cloud",
        cloudAgentRunConfigId: selectedConfig.id,
        schedule: {
          rrule: cadence === "daily" ? "FREQ=DAILY;INTERVAL=1" : "FREQ=WEEKLY;INTERVAL=1",
          timezone: currentTimezone(),
        },
      });
      setTitle("");
      setPrompt("");
      setCadence("daily");
      setError(null);
      onClose();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Automation could not be created.");
    }
  }

  const canCreate = Boolean(prompt.trim() && selectedRepo && selectedConfig && !createAutomation.isPending);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetLayer}>
        <Pressable style={styles.sheetScrim} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetTitle}>New automation</Text>
              <Text style={styles.sheetSubtitle}>Runs in a personal cloud workspace.</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
              <MobileIcon name="close" size={16} color={colors.faint} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            <View>
              <MobileSectionLabel>Repository</MobileSectionLabel>
              <OptionGroup>
                {repoConfigs.isLoading ? (
                  <Text style={styles.loadingText}>Loading repositories...</Text>
                ) : repoOptions.length === 0 ? (
                  <Text style={styles.loadingText}>No configured personal repositories.</Text>
                ) : (
                  repoOptions.map((repo) => (
                    <OptionButton
                      key={repo.id}
                      label={repo.label}
                      selected={repo.id === selectedRepo?.id}
                      onPress={() => setRepoId(repo.id)}
                    />
                  ))
                )}
              </OptionGroup>
            </View>

            <View>
              <MobileSectionLabel>Agent config</MobileSectionLabel>
              <OptionGroup>
                {agentConfigs.isLoading ? (
                  <Text style={styles.loadingText}>Loading agent configs...</Text>
                ) : runConfigs.length === 0 ? (
                  <Text style={styles.loadingText}>No personal cloud agent configs are available.</Text>
                ) : (
                  runConfigs.map((config) => (
                    <OptionButton
                      key={config.id}
                      label={agentConfigLabel(config)}
                      selected={config.id === selectedConfig?.id}
                      onPress={() => setConfigId(config.id)}
                    />
                  ))
                )}
              </OptionGroup>
            </View>

            <View>
              <MobileSectionLabel>Cadence</MobileSectionLabel>
              <OptionGroup>
                <OptionButton label="Daily" selected={cadence === "daily"} onPress={() => setCadence("daily")} />
                <OptionButton label="Weekly" selected={cadence === "weekly"} onPress={() => setCadence("weekly")} />
              </OptionGroup>
            </View>

            <View>
              <MobileSectionLabel>Title</MobileSectionLabel>
              <MobileTextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Daily dependency triage"
              />
            </View>

            <View>
              <MobileSectionLabel>Prompt</MobileSectionLabel>
              <MobileTextInput
                multiline
                value={prompt}
                onChangeText={setPrompt}
                placeholder="Describe the recurring work..."
              />
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create automation"
              accessibilityState={{ disabled: !canCreate }}
              disabled={!canCreate}
              onPress={() => void submit()}
              style={({ pressed }) => [
                styles.createButton,
                !canCreate && styles.createButtonDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.createButtonText}>
                {createAutomation.isPending ? "Creating..." : "Create automation"}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function OptionGroup({ children }: { children: ReactNode }) {
  return <View style={styles.optionGroup}>{children}</View>;
}

function OptionButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionButton,
        selected && styles.optionButtonSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.optionButtonText} numberOfLines={1}>{label}</Text>
      {selected ? <MobileIcon name="check" size={14} color={colors.success} /> : null}
    </Pressable>
  );
}

function buildRepoOptions(
  configs: readonly {
    gitOwner: string;
    gitRepoName: string;
    configured: boolean;
  }[],
): RepoOption[] {
  return configs
    .filter((config) => config.configured)
    .map((config) => ({
      id: `${config.gitOwner}/${config.gitRepoName}`,
      gitOwner: config.gitOwner,
      gitRepoName: config.gitRepoName,
      label: `${config.gitOwner}/${config.gitRepoName}`,
    }));
}

function agentConfigLabel(config: CloudAgentRunConfig): string {
  const model = config.resolved?.modelId ?? config.modelId;
  return `${config.name} - ${config.agentKind}${model ? ` / ${model}` : ""}`;
}

function currentTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  headerText: {
    flex: 1,
    color: colors.faint,
    fontSize: 12.5,
    lineHeight: 17,
  },
  newButton: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.fg,
  },
  newButtonText: {
    color: colors.background,
    fontSize: 13,
    fontWeight: "600",
  },
  list: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
  },
  listErrorText: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    color: colors.destructive,
    fontSize: 12.5,
    lineHeight: 17,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  statusPill: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    borderRadius: radius.full,
    backgroundColor: colors.successSubtle,
  },
  statusPillPaused: {
    backgroundColor: colors.accent,
  },
  statusPillDisabled: {
    opacity: 0.55,
  },
  statusText: {
    color: colors.success,
    fontSize: 11.5,
    fontWeight: "600",
  },
  statusTextPaused: {
    color: colors.faint,
  },
  footnote: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[5],
    color: colors.faint,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
  sheetLayer: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: colors.overlayStrong,
  },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  sheetTitle: {
    color: colors.fg,
    fontSize: 17,
    fontWeight: "700",
  },
  sheetSubtitle: {
    marginTop: 2,
    color: colors.faint,
    fontSize: 12,
  },
  closeButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  sheetContent: {
    gap: spacing[4],
    padding: spacing[4],
    paddingBottom: spacing[6],
  },
  optionGroup: {
    marginTop: spacing[2],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  optionButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  optionButtonSelected: {
    backgroundColor: colors.accent,
  },
  optionButtonText: {
    flex: 1,
    color: colors.fg,
    fontSize: 13.5,
    fontWeight: "500",
  },
  loadingText: {
    padding: spacing[3],
    color: colors.faint,
    fontSize: 12.5,
    lineHeight: 17,
  },
  errorText: {
    color: colors.destructive,
    fontSize: 12.5,
    lineHeight: 17,
  },
  createButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.fg,
  },
  createButtonDisabled: {
    backgroundColor: colors.accent,
  },
  createButtonText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.78,
  },
});
