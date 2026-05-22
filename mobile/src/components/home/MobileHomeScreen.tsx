import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  useCloudRepoConfigs,
  useCreateCloudWorkspace,
} from "@proliferate/cloud-sdk-react";

import {
  MobileScreen,
  MobileScreenHeader,
  MobileSectionLabel,
  MobileStack,
} from "../primitives/MobileLayout";
import { MobileIcon } from "../primitives/MobileIcon";
import { MobileTextInput } from "../primitives/MobileTextInput";
import type {
  MobileCloudChat,
  MobilePendingPrompt,
} from "../../navigation/navigation-model";
import { savePendingMobilePrompt } from "../../lib/access/cloud/pending-mobile-prompt-store";
import { colors, radius, spacing } from "../../styles/tokens";

const DEFAULT_MODEL_ID = "gpt-5.4";

interface RepoOption {
  id: string;
  gitOwner: string;
  gitRepoName: string;
  label: string;
  description: string;
}

interface ModelOption {
  id: string;
  label: string;
  description: string;
}

const MODEL_OPTIONS: ModelOption[] = [
  { id: "gpt-5.4", label: "GPT-5.4", description: "Balanced cloud work" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", description: "Fast lighter tasks" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", description: "Coding-heavy work" },
];

interface MobileHomeScreenProps {
  onOpenChat: (chat: MobileCloudChat) => void;
}

export function MobileHomeScreen({ onOpenChat }: MobileHomeScreenProps) {
  const submitInFlightRef = useRef(false);
  const [draft, setDraft] = useState("");
  const [repoId, setRepoId] = useState("");
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const repoConfigs = useCloudRepoConfigs();
  const createWorkspace = useCreateCloudWorkspace();
  const repoOptions = useMemo(
    () => buildRepoOptions(repoConfigs.data?.configs ?? []),
    [repoConfigs.data?.configs],
  );
  const selectedRepo = repoOptions.find((repo) => repo.id === repoId) ?? repoOptions[0] ?? null;
  const selectedModel = MODEL_OPTIONS.find((model) => model.id === modelId) ?? MODEL_OPTIONS[0];

  useEffect(() => {
    if (!selectedRepo && repoOptions[0]) {
      setRepoId(repoOptions[0].id);
    }
  }, [repoOptions, selectedRepo]);

  async function submitPrompt() {
    const text = draft.trim();
    if (!text || !selectedRepo || submitInFlightRef.current) {
      return;
    }

    submitInFlightRef.current = true;
    setSubmitError(null);
    const pendingPrompt: MobilePendingPrompt = {
      id: `mobile-home:${Date.now().toString(36)}`,
      text,
      modelId,
      modeId: null,
      createdAt: Date.now(),
    };

    try {
      const workspace = await createWorkspace.mutateAsync({
        gitProvider: "github",
        gitOwner: selectedRepo.gitOwner,
        gitRepoName: selectedRepo.gitRepoName,
        branchName: buildBranchName(text),
        displayName: buildWorkspaceDisplayName(text),
        ownerScope: "personal",
      });
      await savePendingMobilePrompt(workspace.id, pendingPrompt);
      setDraft("");
      onOpenChat({
        workspaceId: workspace.id,
        workspaceName: workspace.displayName ?? workspace.repo.name,
        repoLabel: `${workspace.repo.owner}/${workspace.repo.name}`,
        branchLabel: workspace.repo.branch ?? workspace.repo.baseBranch ?? "main",
        targetId: workspace.targetId ?? null,
        workspaceRuntimeId: workspace.anyharnessWorkspaceId ?? null,
        sessionId: null,
        title: workspace.displayName ?? workspace.repo.name,
        status: workspace.workspaceStatus ?? workspace.status,
        visibility: workspace.visibility,
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not create workspace.");
    } finally {
      submitInFlightRef.current = false;
    }
  }

  const submitting = createWorkspace.isPending || submitInFlightRef.current;
  const canSubmit = Boolean(draft.trim()) && Boolean(selectedRepo) && !submitting;

  return (
    <MobileScreen>
      <MobileStack gap={spacing[5]}>
        <MobileScreenHeader
          eyebrow="New chat"
          title="What should we run?"
          description="Choose a repository, then send the first prompt into a cloud workspace."
        />

        <View>
          <MobileSectionLabel>Repository</MobileSectionLabel>
          <View style={styles.optionGroup}>
            {repoConfigs.isLoading ? (
              <Text style={styles.loadingText}>Loading configured repositories...</Text>
            ) : repoOptions.length === 0 ? (
              <Text style={styles.loadingText}>
                No configured cloud repositories are available for mobile.
              </Text>
            ) : (
              repoOptions.map((repo) => (
                <OptionRow
                  key={repo.id}
                  title={repo.label}
                  description={repo.description}
                  icon="git-branch"
                  selected={repo.id === selectedRepo?.id}
                  onPress={() => setRepoId(repo.id)}
                />
              ))
            )}
          </View>
        </View>

        <View>
          <MobileSectionLabel>Model</MobileSectionLabel>
          <View style={styles.optionGroup}>
            {MODEL_OPTIONS.map((model) => (
              <OptionRow
                key={model.id}
                title={model.label}
                description={model.description}
                icon="cloud"
                selected={model.id === selectedModel.id}
                onPress={() => setModelId(model.id)}
              />
            ))}
          </View>
        </View>

        <View>
          <MobileSectionLabel>Prompt</MobileSectionLabel>
          <View style={styles.composer}>
            <MobileTextInput
              multiline
              value={draft}
              onChangeText={setDraft}
              placeholder="Ask Proliferate to work in this repo..."
              style={styles.composerInput}
            />
            <View style={styles.composerFooter}>
              <View style={styles.context}>
                <MobileIcon name="cloud" size={13} color={colors.faint} />
                <Text style={styles.contextText} numberOfLines={1}>
                  {selectedRepo?.label ?? "Select a repository"} - {selectedModel.label}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Start cloud chat"
                disabled={!canSubmit}
                onPress={() => void submitPrompt()}
                style={({ pressed }) => [
                  styles.send,
                  !canSubmit && styles.sendDisabled,
                  pressed && styles.sendPressed,
                ]}
              >
                <MobileIcon
                  name="send"
                  size={16}
                  color={canSubmit ? colors.background : colors.faint}
                />
              </Pressable>
            </View>
          </View>
          {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
        </View>
      </MobileStack>
    </MobileScreen>
  );
}

function OptionRow({
  title,
  description,
  icon,
  selected,
  onPress,
}: {
  title: string;
  description: string;
  icon: "cloud" | "git-branch";
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionRow,
        selected && styles.optionRowActive,
        pressed && styles.optionRowPressed,
      ]}
    >
      <View style={[styles.optionIcon, selected && styles.optionIconActive]}>
        <MobileIcon
          name={icon}
          size={18}
          color={selected ? colors.fg : colors.mutedForeground}
        />
      </View>
      <View style={styles.optionText}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionDescription}>{description}</Text>
      </View>
      <View style={styles.radio}>{selected ? <View style={styles.radioDot} /> : null}</View>
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
      description: "Configured cloud repo",
    }));
}

function buildBranchName(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    || "mobile-chat";
  return `proliferate/${slug}-${Date.now().toString(36).slice(-6)}`;
}

function buildWorkspaceDisplayName(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= 42) {
    return normalized || "Mobile chat";
  }
  return `${normalized.slice(0, 39).trimEnd()}...`;
}

const styles = StyleSheet.create({
  optionGroup: {
    marginTop: spacing[2],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  optionRowActive: {
    backgroundColor: colors.accent,
  },
  optionRowPressed: {
    opacity: 0.85,
  },
  optionIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  optionIconActive: {
    backgroundColor: colors.sidebar,
    borderColor: colors.borderHeavy,
  },
  optionText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  optionTitle: {
    color: colors.fg,
    fontSize: 14.5,
    fontWeight: "600",
  },
  optionDescription: {
    color: colors.faint,
    fontSize: 12.5,
    lineHeight: 17,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.4,
    borderColor: colors.borderHeavy,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.fg,
  },
  loadingText: {
    padding: spacing[3],
    color: colors.faint,
    fontSize: 13,
    lineHeight: 18,
  },
  composer: {
    marginTop: spacing[2],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    gap: spacing[2],
  },
  composerInput: {
    minHeight: 112,
    backgroundColor: "transparent",
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingTop: 0,
    fontSize: 15,
    lineHeight: 22,
  },
  composerFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  context: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  contextText: {
    color: colors.faint,
    fontSize: 12,
  },
  send: {
    width: 36,
    height: 36,
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
  errorText: {
    marginTop: spacing[2],
    color: colors.destructive,
    fontSize: 12.5,
    lineHeight: 17,
  },
});
