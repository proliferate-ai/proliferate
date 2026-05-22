import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type {
  CloudCommandStatus,
  CloudSessionEvent,
  CloudSessionProjection,
  CloudTranscriptItem,
} from "@proliferate/cloud-sdk";
import {
  useClaimCloudWorkspace,
  useCloudClient,
  useCloudSessionEvents,
  useCloudTranscriptSnapshot,
  useCloudWorkspaceSnapshot,
  useCommandStatus,
  useEnqueueCloudCommand,
  useSessionLive,
  useWorkspaceLive,
} from "@proliferate/cloud-sdk-react";
import {
  buildCloudChatComposerControls,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  getLiveConfigControlValue,
  pendingConfigChangeKey,
  readSessionLiveConfig,
  type CloudChatComposerControlView,
  type PendingConfigChange,
} from "@proliferate/product-model/chats/cloud/composer-controls";
import {
  buildCloudTranscriptView,
  type CloudChatTranscriptRowView,
} from "@proliferate/product-model/chats/cloud/transcript-view";

import { MobileIcon } from "../primitives/MobileIcon";
import { MobileStatusDot } from "../primitives/MobileStatusDot";
import { MobileTextInput } from "../primitives/MobileTextInput";
import { MobileTopBar, MobileTopBarIconButton } from "../primitives/MobileTopBar";
import type {
  MobileCloudChat,
  MobilePendingPrompt,
} from "../../navigation/navigation-model";
import {
  clearPendingMobilePrompt,
  loadPendingMobilePrompt,
  savePendingMobilePrompt,
} from "../../lib/access/cloud/pending-mobile-prompt-store";
import {
  dispatchPendingMobilePrompt,
  type SendPromptPayload,
  type StartSessionPayload,
} from "../../lib/access/cloud/pending-mobile-prompt-dispatch";
import { colors, radius, spacing } from "../../styles/tokens";

interface MobileChatScreenProps {
  chat: MobileCloudChat;
  onBack: () => void;
}

type OptimisticPromptStatus = "sending" | "queued" | "failed";

type OptimisticPrompt = {
  id: string;
  sessionId: string;
  text: string;
  baseTranscriptSeq: number;
  status: OptimisticPromptStatus;
};

type UpdateSessionConfigPayload = {
  configId: string;
  value: string;
};

const EMPTY_TRANSCRIPT_ITEMS: CloudTranscriptItem[] = [];
const EMPTY_SESSION_EVENTS: CloudSessionEvent[] = [];

export function MobileChatScreen({ chat, onBack }: MobileChatScreenProps) {
  const client = useCloudClient();
  const [draft, setDraft] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(chat.sessionId);
  const [draftModelId, setDraftModelId] = useState(DEFAULT_DIRECT_PROMPT_MODEL_ID);
  const [latestCommandId, setLatestCommandId] = useState<string | null>(null);
  const [latestConfigCommandId, setLatestConfigCommandId] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<MobilePendingPrompt | null>(null);
  const [pendingPromptStatus, setPendingPromptStatus] = useState<string | null>(null);
  const [directPromptDispatching, setDirectPromptDispatching] = useState(false);
  const [optimisticPrompts, setOptimisticPrompts] = useState<OptimisticPrompt[]>([]);
  const [pendingConfigChanges, setPendingConfigChanges] = useState<
    Record<string, PendingConfigChange>
  >({});
  const [activeControl, setActiveControl] = useState<CloudChatComposerControlView | null>(null);
  const [claimedLocally, setClaimedLocally] = useState(false);
  const pendingDispatchRunRef = useRef<{ key: string; active: boolean } | null>(null);
  const pendingConfigMutationIdRef = useRef(0);

  const workspaceQuery = useCloudWorkspaceSnapshot(chat.workspaceId, true);
  const workspaceLive = useWorkspaceLive(chat.workspaceId, { enabled: true });
  const snapshot = workspaceLive.snapshot ?? workspaceQuery.data;
  const workspace = snapshot?.workspace ?? null;
  const sessions = useMemo(
    () => [...(snapshot?.sessions ?? [])].sort(compareSessions),
    [snapshot?.sessions],
  );
  const session =
    sessions.find((candidate) => candidate.sessionId === selectedSessionId)
    ?? sessions.find((candidate) => candidate.sessionId === chat.sessionId)
    ?? sessions[0]
    ?? null;
  const targetId = session?.targetId ?? workspace?.targetId ?? chat.targetId;
  const workspaceRuntimeId = session?.workspaceId ?? workspace?.anyharnessWorkspaceId ?? chat.workspaceRuntimeId;
  const workspaceStatus = workspace ? effectiveWorkspaceStatus(workspace) : chat.status;
  const sessionLive = useSessionLive(session?.sessionId ?? null, {
    targetId,
    enabled: Boolean(session && targetId),
  });
  const transcriptQuery = useCloudTranscriptSnapshot(
    targetId,
    session?.sessionId ?? null,
    Boolean(session && targetId),
  );
  const sessionEventsQuery = useCloudSessionEvents(
    targetId,
    session?.sessionId ?? null,
    Boolean(session && targetId),
  );
  const transcriptItems =
    sessionLive.snapshot?.transcriptItems
    ?? transcriptQuery.data?.transcriptItems
    ?? EMPTY_TRANSCRIPT_ITEMS;
  const sessionEvents = sessionEventsQuery.data?.events ?? EMPTY_SESSION_EVENTS;
  const transcriptView = useMemo(
    () => buildCloudTranscriptView({
      sessionId: session?.sessionId ?? null,
      events: sessionEvents,
      fallbackItems: transcriptItems,
    }),
    [session?.sessionId, sessionEvents, transcriptItems],
  );
  const enqueuePrompt = useEnqueueCloudCommand<SendPromptPayload>();
  const enqueueStartSession = useEnqueueCloudCommand<StartSessionPayload>();
  const enqueueConfig = useEnqueueCloudCommand<UpdateSessionConfigPayload>();
  const claimWorkspace = useClaimCloudWorkspace();
  const commandStatus = useCommandStatus(latestCommandId);
  const configCommandStatus = useCommandStatus(latestConfigCommandId);
  const liveConfig = readSessionLiveConfig(session);
  const composerControls = buildCloudChatComposerControls({
    session,
    liveConfig,
    pendingConfigChanges,
    launchModelId: draftModelId,
    onLaunchModelSelect: setDraftModelId,
    onSessionConfigSelect: (rawConfigId, value) => {
      void submitSessionConfig(rawConfigId, value);
    },
  });
  const visibleTranscriptRows = useMemo(
    () => [
      ...transcriptView.rows,
      ...buildPendingPromptRows(pendingPrompt, session?.sessionId ?? null),
      ...buildOptimisticPromptRows({
        prompts: optimisticPrompts,
        sessionId: session?.sessionId ?? null,
        transcriptItems,
        transcriptRows: transcriptView.rows,
      }),
    ],
    [optimisticPrompts, pendingPrompt, session?.sessionId, transcriptItems, transcriptView.rows],
  );

  useEffect(() => {
    setSelectedSessionId(chat.sessionId);
    setDraft("");
    setPendingPromptStatus(null);
    setOptimisticPrompts([]);
    setPendingConfigChanges({});
    setLatestConfigCommandId(null);
    setClaimedLocally(false);
  }, [chat.workspaceId, chat.sessionId]);

  useEffect(() => {
    let active = true;
    void loadPendingMobilePrompt(chat.workspaceId).then((stored) => {
      if (active) {
        setPendingPrompt(stored);
      }
    });
    return () => {
      active = false;
    };
  }, [chat.workspaceId]);

  useEffect(() => {
    if (!workspace || workspaceStatus === "ready" || workspaceStatus === "error") {
      return;
    }
    const interval = setInterval(() => {
      void workspaceQuery.refetch();
    }, 2500);
    return () => {
      clearInterval(interval);
    };
  }, [workspace, workspaceStatus, workspaceQuery.refetch]);

  useEffect(() => {
    if (!session || !sessionLive.lastPatchAt) {
      return;
    }
    void transcriptQuery.refetch();
    void sessionEventsQuery.refetch();
  }, [
    session?.sessionId,
    sessionEventsQuery.refetch,
    sessionLive.lastPatchAt,
    transcriptQuery.refetch,
  ]);

  useEffect(() => {
    if (!session) {
      return;
    }
    setOptimisticPrompts((current) =>
      current.filter((prompt) =>
        prompt.sessionId !== session.sessionId
        || prompt.status === "failed"
        || !transcriptHasAgentProgressAfterPrompt(prompt, transcriptItems, transcriptView.rows)
      )
    );
  }, [session?.sessionId, transcriptItems, transcriptView.rows]);

  useEffect(() => {
    if (!session || !liveConfig) {
      return;
    }
    setPendingConfigChanges((current) => {
      let changed = false;
      const next = { ...current };
      for (const [key, pendingChange] of Object.entries(current)) {
        if (pendingChange.sessionId !== session.sessionId) {
          continue;
        }
        if (getLiveConfigControlValue(liveConfig, pendingChange.rawConfigId) === pendingChange.value) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [liveConfig, session?.sessionId]);

  useEffect(() => {
    const command = configCommandStatus.data;
    if (!command || !isRejectedCommandStatus(command.status)) {
      return;
    }
    if (
      !Object.values(pendingConfigChanges).some((change) =>
        change.commandId === command.commandId
      )
    ) {
      return;
    }
    setPendingConfigChanges((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([_key, change]) =>
          change.commandId !== command.commandId
        ),
      )
    );
    setPendingPromptStatus(command.errorMessage || sessionConfigCommandFailureMessage(command.status));
  }, [
    configCommandStatus.data?.commandId,
    configCommandStatus.data?.errorMessage,
    configCommandStatus.data?.status,
    pendingConfigChanges,
  ]);

  useEffect(() => {
    if (!pendingPrompt || !workspace) {
      return;
    }
    if (workspaceStatus === "error" || workspaceStatus === "archived") {
      setPendingPromptStatus("Workspace creation failed before the prompt could be sent.");
      return;
    }
    if (workspaceStatus !== "ready") {
      setPendingPromptStatus("Workspace is provisioning; the prompt will send when ready.");
      return;
    }
    if (!workspace.targetId || !workspace.anyharnessWorkspaceId) {
      setPendingPromptStatus(
        workspace.actionBlockReason || "Managed target configuration is still materializing.",
      );
      return;
    }

    const runKey = `${workspace.id}:${pendingPrompt.id}`;
    const currentRun = pendingDispatchRunRef.current;
    if (currentRun?.key === runKey && currentRun.active) {
      return;
    }

    const run = { key: runKey, active: true };
    pendingDispatchRunRef.current = run;
    const isCurrentRun = () => pendingDispatchRunRef.current === run && run.active;
    setPendingPromptStatus("Starting a session for the queued prompt.");

    void dispatchPendingMobilePrompt({
      client,
      workspace,
      pendingPrompt,
      modelId: pendingPrompt.modelId,
      enqueueStartSession: enqueueStartSession.mutateAsync,
      enqueuePrompt: enqueuePrompt.mutateAsync,
      setLatestCommandId: (commandId) => {
        if (isCurrentRun()) {
          setLatestCommandId(commandId);
        }
      },
      onStatus: (status) => {
        if (isCurrentRun()) {
          setPendingPromptStatus(status);
        }
      },
      shouldContinue: isCurrentRun,
    })
      .then((sessionId) => {
        if (!isCurrentRun()) {
          return;
        }
        setSelectedSessionId(sessionId);
        setOptimisticPrompts((current) => [
          ...current,
          {
            id: `${pendingPrompt.id}:optimistic`,
            sessionId,
            text: pendingPrompt.text,
            baseTranscriptSeq: 0,
            status: "queued",
          },
        ]);
        setPendingPrompt(null);
        setPendingPromptStatus(null);
        void clearPendingMobilePrompt(workspace.id);
        void workspaceQuery.refetch();
      })
      .catch((error: unknown) => {
        if (!isCurrentRun()) {
          return;
        }
        setPendingPromptStatus(
          error instanceof Error ? error.message : "Queued prompt could not be sent.",
        );
      })
      .finally(() => {
        if (pendingDispatchRunRef.current === run) {
          pendingDispatchRunRef.current = null;
        }
      });

    return () => {
      run.active = false;
    };
  }, [
    client,
    enqueuePrompt.mutateAsync,
    enqueueStartSession.mutateAsync,
    pendingPrompt,
    workspace?.actionBlockReason,
    workspace?.anyharnessWorkspaceId,
    workspace?.id,
    workspace?.targetId,
    workspaceStatus,
    workspaceQuery.refetch,
  ]);

  async function submitPrompt() {
    const text = draft.trim();
    if (!text || !workspace) {
      return;
    }
    if (!session) {
      if (directPromptDispatching) {
        return;
      }
      const prompt: MobilePendingPrompt = {
        id: `mobile-chat:${workspace.id}:${Date.now().toString(36)}`,
        text,
        modelId: draftModelId,
        modeId: null,
        createdAt: Date.now(),
      };
      setDirectPromptDispatching(true);
      setDraft("");
      setPendingPrompt(prompt);
      setPendingPromptStatus("Starting a session for this prompt.");
      await savePendingMobilePrompt(workspace.id, prompt);
      setDirectPromptDispatching(false);
      return;
    }

    const optimisticPrompt: OptimisticPrompt = {
      id: `mobile:${workspace.id}:${session.sessionId}:${Date.now()}`,
      sessionId: session.sessionId,
      text,
      baseTranscriptSeq: latestTranscriptItemSeq(transcriptItems),
      status: "sending",
    };
    setOptimisticPrompts((current) => [...current, optimisticPrompt]);
    setDraft("");
    setPendingPromptStatus(null);
    try {
      const command = await enqueuePrompt.mutateAsync({
        idempotencyKey: optimisticPrompt.id,
        targetId: session.targetId,
        workspaceId: session.workspaceId,
        cloudWorkspaceId: workspace.id,
        sessionId: session.sessionId,
        kind: "send_prompt",
        source: "mobile",
        payload: { text },
      });
      setLatestCommandId(command.commandId);
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id ? { ...prompt, status: "queued" } : prompt
        )
      );
      void transcriptQuery.refetch();
      void sessionEventsQuery.refetch();
    } catch (error) {
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.id === optimisticPrompt.id ? { ...prompt, status: "failed" } : prompt
        )
      );
      setPendingPromptStatus(error instanceof Error ? error.message : "Prompt could not be sent.");
    }
  }

  async function submitSessionConfig(rawConfigId: string, value: string) {
    if (!workspace || !session) {
      return;
    }
    const mutationId = pendingConfigMutationIdRef.current + 1;
    pendingConfigMutationIdRef.current = mutationId;
    const changeKey = pendingConfigChangeKey(session.sessionId, rawConfigId);
    setPendingConfigChanges((current) => ({
      ...current,
      [changeKey]: {
        sessionId: session.sessionId,
        rawConfigId,
        value,
        status: "sending",
        mutationId,
      },
    }));
    try {
      const command = await enqueueConfig.mutateAsync({
        idempotencyKey: `mobile:${workspace.id}:${session.sessionId}:config:${rawConfigId}:${value}:${mutationId}`,
        targetId: session.targetId,
        workspaceId: session.workspaceId,
        cloudWorkspaceId: workspace.id,
        sessionId: session.sessionId,
        kind: "update_session_config",
        source: "mobile",
        observedEventSeq: session.lastEventSeq ?? null,
        payload: { configId: rawConfigId, value },
      });
      setLatestCommandId(command.commandId);
      setLatestConfigCommandId(command.commandId);
      setPendingConfigChanges((current) => {
        const existing = current[changeKey];
        if (!existing || existing.mutationId !== mutationId) {
          return current;
        }
        return {
          ...current,
          [changeKey]: { ...existing, commandId: command.commandId, status: "queued" },
        };
      });
    } catch (error) {
      setPendingConfigChanges((current) => {
        const { [changeKey]: _removed, ...rest } = current;
        return rest;
      });
      setPendingPromptStatus(
        error instanceof Error ? error.message : "Session configuration could not be updated.",
      );
    }
  }

  async function claimChat() {
    if (!workspace) {
      return;
    }
    await claimWorkspace.mutateAsync({ workspaceId: workspace.id });
    setClaimedLocally(true);
    void workspaceQuery.refetch();
  }

  const isUnclaimed = workspace?.visibility === "shared_unclaimed" && !claimedLocally;
  const workspaceCommandReady =
    workspaceStatus === "ready" && Boolean(workspace?.targetId) && Boolean(workspace?.anyharnessWorkspaceId);
  const promptSubmitting = enqueuePrompt.isPending || directPromptDispatching;
  const canSubmit = Boolean(
    draft.trim()
      && !isUnclaimed
      && !promptSubmitting
      && (session ? true : workspaceCommandReady),
  );
  const title = session?.title ?? workspace?.displayName ?? chat.title;
  const subtitle = `${workspace?.displayName ?? chat.workspaceName} - ${workspace?.repo.owner ?? chat.repoLabel}`;
  const branchLabel = workspace?.repo.branch ?? workspace?.repo.baseBranch ?? chat.branchLabel;
  const commandMessage =
    pendingPromptStatus ??
    commandStatus.data?.errorMessage ??
    (commandStatus.data?.status ? `Command ${commandStatus.data.status}` : null);
  const emptyTitle = !session
    ? "No active session yet."
    : sessionEventsQuery.isLoading && transcriptView.source === "empty"
      ? "Loading transcript"
      : "Waiting for the first projected transcript event.";
  const composerPlaceholder = isUnclaimed
    ? "Claim this workspace to reply"
    : session
      ? "Message this session"
      : workspaceCommandReady
        ? "Start a session with a message"
        : "Waiting for workspace";

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.select({ ios: "padding", default: undefined })}
      keyboardVerticalOffset={80}
    >
      <View style={styles.headerWrapper}>
        <MobileTopBar
          title={title}
          subtitle={subtitle}
          leading={{ kind: "back", onPress: onBack }}
          trailing={
            <View style={styles.headerStatus}>
              <MobileStatusDot status={mobileStatus(session?.status ?? workspaceStatus)} />
              <MobileTopBarIconButton name="more" accessibilityLabel="Chat menu" />
            </View>
          }
        />
      </View>

      <View style={styles.identityBar}>
        <IdentityChip label={branchLabel} icon="git-branch" onPress={() => void shareBranch(branchLabel)} />
        <IdentityChip label={workspace?.visibility ?? chat.visibility} />
        <IdentityChip label={sessionLive.isConnected ? "Live" : "Snapshot"} />
        <IdentityChip label={transcriptView.source === "events" ? "Events" : transcriptView.source} />
      </View>

      {isUnclaimed ? (
        <View style={styles.claimBanner}>
          <View style={styles.claimText}>
            <Text style={styles.claimTitle}>Unclaimed shared chat</Text>
            <Text style={styles.claimBody}>Claim this work before sending prompts from mobile.</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Claim shared chat"
            accessibilityState={{ disabled: claimWorkspace.isPending }}
            disabled={claimWorkspace.isPending}
            onPress={() => void claimChat()}
            style={({ pressed }) => [
              styles.claimButton,
              claimWorkspace.isPending && styles.claimButtonDisabled,
              pressed && styles.claimButtonPressed,
            ]}
          >
            <Text style={styles.claimButtonText}>
              {claimWorkspace.isPending ? "Claiming" : "Claim"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        data={visibleTranscriptRows}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MessageRow row={item} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{emptyTitle}</Text>
            <Text style={styles.emptyBody}>
              {!session ? "Send a prompt below to start the first projected session." : "Transcript projection will appear here."}
            </Text>
          </View>
        }
        ListFooterComponent={
          commandMessage ? (
            <View style={styles.controlNote}>
              <Text style={styles.controlNoteText}>{commandMessage}</Text>
            </View>
          ) : null
        }
      />

      <View style={styles.composer}>
        {composerControls.length > 0 ? (
          <View style={styles.controlRow}>
            {composerControls.map((control) => (
              <Pressable
                key={control.id}
                accessibilityRole="button"
                accessibilityState={{ disabled: control.disabled }}
                disabled={control.disabled}
                onPress={() => setActiveControl(control)}
                style={({ pressed }) => [
                  styles.controlButton,
                  control.pendingState && styles.controlButtonPending,
                  control.disabled && styles.controlButtonDisabled,
                  pressed && styles.controlButtonPressed,
                ]}
              >
                <Text style={styles.controlButtonText} numberOfLines={1}>
                  {control.detail ?? control.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={styles.inputRow}>
          <MobileTextInput
            multiline
            value={draft}
            onChangeText={setDraft}
            placeholder={composerPlaceholder}
            style={styles.composerInput}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSubmit }}
            disabled={!canSubmit}
            onPress={() => void submitPrompt()}
            style={({ pressed }) => [
              styles.send,
              !canSubmit && styles.sendDisabled,
              pressed && styles.sendPressed,
            ]}
          >
            <MobileIcon name="send" size={16} color={canSubmit ? colors.background : colors.faint} />
          </Pressable>
        </View>
      </View>

      <ControlSheet control={activeControl} onClose={() => setActiveControl(null)} />
    </KeyboardAvoidingView>
  );
}

function ControlSheet({
  control,
  onClose,
}: {
  control: CloudChatComposerControlView | null;
  onClose: () => void;
}) {
  return (
    <Modal visible={Boolean(control)} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetLayer}>
        <Pressable style={styles.sheetScrim} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{control?.label}</Text>
          {control?.groups.map((group) => (
            <View key={group.id} style={styles.sheetGroup}>
              {group.label ? <Text style={styles.sheetGroupLabel}>{group.label}</Text> : null}
              {group.options.map((option) => (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: option.selected, disabled: option.disabled }}
                  disabled={option.disabled}
                  onPress={() => {
                    control.onSelect?.(option.id);
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.sheetOption,
                    option.selected && styles.sheetOptionSelected,
                    option.disabled && styles.sheetOptionDisabled,
                    pressed && styles.sheetOptionPressed,
                  ]}
                >
                  <View style={styles.sheetOptionText}>
                    <Text style={styles.sheetOptionLabel}>{option.label}</Text>
                    {option.description ? (
                      <Text style={styles.sheetOptionDescription}>{option.description}</Text>
                    ) : null}
                  </View>
                  {option.selected ? <MobileIcon name="check" size={16} color={colors.success} /> : null}
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
}

function IdentityChip({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon?: "git-branch";
  onPress?: () => void;
}) {
  const content = (
    <>
      {icon ? <MobileIcon name={icon} size={12} color={colors.faint} /> : null}
      <Text style={styles.identityText} numberOfLines={1}>{label}</Text>
    </>
  );
  if (!onPress) {
    return <View style={styles.identityChip}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.identityChip, pressed && styles.controlButtonPressed]}
    >
      {content}
    </Pressable>
  );
}

function MessageRow({ row }: { row: CloudChatTranscriptRowView }) {
  const isAssistant = row.kind === "assistant";
  const isSystem = row.kind === "system" || row.kind === "tool" || row.kind === "tool_group";
  const isUser = row.kind === "user";
  return (
    <View
      style={[
        styles.message,
        isAssistant && styles.messageAssistant,
        isSystem && styles.messageSystem,
        isUser && styles.messageUser,
      ]}
    >
      <View style={styles.messageHeader}>
        <Text style={styles.messageRole}>{messageLabel(row)}</Text>
        {row.status ? <Text style={styles.messageStatus}>{row.status}</Text> : null}
      </View>
      {row.title ? <Text style={styles.messageTitle}>{row.title}</Text> : null}
      {row.body ? <Text style={styles.messageBody}>{row.body}</Text> : null}
      {row.detail ? <Text style={styles.messageDetail}>{row.detail}</Text> : null}
      {row.streaming ? <Text style={styles.streamingText}>Working...</Text> : null}
    </View>
  );
}

function messageLabel(row: CloudChatTranscriptRowView): string {
  switch (row.kind) {
    case "assistant":
      return "assistant";
    case "user":
      return "you";
    case "thought":
      return "reasoning";
    case "tool":
    case "tool_group":
      return "tool";
    case "error":
      return "error";
    case "system":
    default:
      return "system";
  }
}

function buildPendingPromptRows(
  pendingPrompt: MobilePendingPrompt | null,
  sessionId: string | null,
): CloudChatTranscriptRowView[] {
  if (!pendingPrompt || sessionId) {
    return [];
  }
  return [
    {
      id: `${pendingPrompt.id}:pending-user`,
      kind: "user",
      body: pendingPrompt.text,
      status: "Queued",
      streaming: true,
    },
    {
      id: `${pendingPrompt.id}:pending-assistant`,
      kind: "assistant",
      body: "Preparing workspace and session...",
      streaming: true,
    },
  ];
}

function buildOptimisticPromptRows(input: {
  prompts: readonly OptimisticPrompt[];
  sessionId: string | null;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
}): CloudChatTranscriptRowView[] {
  if (!input.sessionId) {
    return [];
  }
  const rows: CloudChatTranscriptRowView[] = [];
  for (const prompt of input.prompts) {
    if (prompt.sessionId !== input.sessionId) {
      continue;
    }
    const promptVisible = transcriptHasUserPrompt(
      prompt,
      input.transcriptItems,
      input.transcriptRows,
    );
    const agentStarted = transcriptHasAgentProgressAfterPrompt(
      prompt,
      input.transcriptItems,
      input.transcriptRows,
    );
    if (!promptVisible) {
      rows.push({
        id: `${prompt.id}:user`,
        kind: "user",
        body: prompt.text,
        status: optimisticPromptStatusLabel(prompt.status),
        streaming: prompt.status !== "failed",
      });
    }
    if (prompt.status !== "failed" && !agentStarted) {
      rows.push({
        id: `${prompt.id}:assistant-waiting`,
        kind: "assistant",
        body: prompt.status === "sending" ? "Sending message..." : "Waiting for response...",
        streaming: true,
      });
    }
  }
  return rows;
}

function optimisticPromptStatusLabel(status: OptimisticPromptStatus): string {
  switch (status) {
    case "failed":
      return "Failed";
    case "queued":
      return "Queued";
    case "sending":
    default:
      return "Sending";
  }
}

function transcriptHasUserPrompt(
  prompt: OptimisticPrompt,
  transcriptItems: readonly CloudTranscriptItem[],
  transcriptRows: readonly CloudChatTranscriptRowView[],
): boolean {
  return transcriptItems.some((item) => isPromptItemForOptimisticPrompt(item, prompt))
    || (
      transcriptItems.length === 0
      && transcriptRows.some((row) => row.kind === "user" && textMatches(row.body, prompt.text))
    );
}

function transcriptHasAgentProgressAfterPrompt(
  prompt: OptimisticPrompt,
  transcriptItems: readonly CloudTranscriptItem[],
  transcriptRows: readonly CloudChatTranscriptRowView[],
): boolean {
  const promptItem = [...transcriptItems]
    .filter((item) => isPromptItemForOptimisticPrompt(item, prompt))
    .sort((left, right) => right.lastSeq - left.lastSeq)[0];
  if (promptItem) {
    return transcriptItems.some((item) =>
      item.firstSeq > promptItem.lastSeq && !isPromptTranscriptKind(item.kind)
    );
  }
  if (transcriptItems.length > 0) {
    return false;
  }
  const promptRowIndex = transcriptRows.findIndex((row) =>
    row.kind === "user" && textMatches(row.body, prompt.text)
  );
  if (promptRowIndex === -1) {
    return false;
  }
  return transcriptRows.slice(promptRowIndex + 1).some((row) => row.kind !== "user");
}

function isPromptItemForOptimisticPrompt(
  item: CloudTranscriptItem,
  prompt: OptimisticPrompt,
): boolean {
  return item.firstSeq > prompt.baseTranscriptSeq
    && isPromptTranscriptKind(item.kind)
    && textMatches(item.text, prompt.text);
}

function isPromptTranscriptKind(kind: string | null | undefined): boolean {
  return kind === "user_message" || kind === "prompt";
}

function textMatches(value: string | null | undefined, expected: string): boolean {
  return normalizePromptText(value) === normalizePromptText(expected);
}

function normalizePromptText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function latestTranscriptItemSeq(items: readonly CloudTranscriptItem[]): number {
  return items.reduce((maxSeq, item) => Math.max(maxSeq, item.lastSeq), 0);
}

function compareSessions(left: CloudSessionProjection, right: CloudSessionProjection): number {
  return (right.lastEventSeq ?? 0) - (left.lastEventSeq ?? 0);
}

function effectiveWorkspaceStatus(
  workspace: { status?: string | null; workspaceStatus?: string | null },
): string {
  return workspace.workspaceStatus ?? workspace.status ?? "unknown";
}

function mobileStatus(status: string | null | undefined): "running" | "idle" | "paused" | "failed" | "done" {
  if (status === "running") {
    return "running";
  }
  if (status === "failed" || status === "error") {
    return "failed";
  }
  if (status === "paused") {
    return "paused";
  }
  if (status === "ended" || status === "done" || status === "completed") {
    return "done";
  }
  return "idle";
}

function isRejectedCommandStatus(status: CloudCommandStatus): boolean {
  return status === "rejected"
    || status === "expired"
    || status === "superseded"
    || status === "failed_delivery";
}

function sessionConfigCommandFailureMessage(status: CloudCommandStatus): string {
  switch (status) {
    case "expired":
      return "Session configuration update expired before it was applied.";
    case "superseded":
      return "Session configuration update was superseded.";
    case "failed_delivery":
      return "Session configuration update could not be delivered.";
    case "rejected":
    default:
      return "Session configuration update was rejected.";
  }
}

async function shareBranch(branchLabel: string): Promise<void> {
  await Share.share({ message: branchLabel });
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerWrapper: {
    backgroundColor: colors.background,
  },
  headerStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingRight: spacing[1],
  },
  identityBar: {
    flexDirection: "row",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  identityChip: {
    maxWidth: 150,
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: spacing[2],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  identityText: {
    color: colors.faint,
    fontSize: 11.5,
    fontWeight: "500",
  },
  list: {
    flex: 1,
  },
  content: {
    padding: spacing[4],
    paddingBottom: spacing[5],
    gap: spacing[3],
  },
  claimBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.successSubtle,
    backgroundColor: colors.successSubtle,
  },
  claimText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  claimTitle: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "600",
  },
  claimBody: {
    color: colors.mutedForeground,
    fontSize: 12.5,
    lineHeight: 17,
  },
  claimButton: {
    borderRadius: radius.md,
    backgroundColor: colors.success,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  claimButtonPressed: {
    opacity: 0.82,
  },
  claimButtonDisabled: {
    opacity: 0.56,
  },
  claimButtonText: {
    color: colors.background,
    fontSize: 12,
    fontWeight: "700",
  },
  controlNote: {
    marginTop: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  controlNoteText: {
    color: colors.faint,
    fontSize: 12,
    fontStyle: "italic",
  },
  empty: {
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    borderStyle: "dashed",
  },
  emptyTitle: {
    color: colors.fg,
    fontSize: 15,
    fontWeight: "600",
  },
  emptyBody: {
    marginTop: 4,
    color: colors.faint,
    fontSize: 13,
    lineHeight: 18,
  },
  message: {
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
  },
  messageAssistant: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  messageSystem: {
    backgroundColor: "transparent",
    borderColor: colors.borderLight,
    borderStyle: "dashed",
  },
  messageUser: {
    marginLeft: spacing[5],
  },
  messageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
    marginBottom: 6,
  },
  messageRole: {
    color: colors.faint,
    fontSize: 10.5,
    fontWeight: "600",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  messageStatus: {
    color: colors.faint,
    fontSize: 10.5,
  },
  messageTitle: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 5,
  },
  messageBody: {
    color: colors.fg,
    fontSize: 14.5,
    lineHeight: 21,
  },
  messageDetail: {
    marginTop: 6,
    color: colors.faint,
    fontSize: 12,
    lineHeight: 17,
  },
  streamingText: {
    marginTop: 8,
    color: colors.faint,
    fontSize: 12,
    fontStyle: "italic",
  },
  composer: {
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
    backgroundColor: colors.background,
  },
  controlRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  controlButton: {
    minHeight: 30,
    maxWidth: 140,
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[2],
  },
  controlButtonPending: {
    borderColor: colors.info,
  },
  controlButtonDisabled: {
    opacity: 0.5,
  },
  controlButtonPressed: {
    opacity: 0.8,
  },
  controlButtonText: {
    color: colors.mutedForeground,
    fontSize: 12,
    fontWeight: "600",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing[2],
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 22,
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
  sheetLayer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlayStrong,
  },
  sheet: {
    maxHeight: "72%",
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing[4],
    gap: spacing[3],
  },
  sheetTitle: {
    color: colors.fg,
    fontSize: 16,
    fontWeight: "700",
  },
  sheetGroup: {
    gap: spacing[1],
  },
  sheetGroupLabel: {
    color: colors.faint,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  sheetOption: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  sheetOptionSelected: {
    backgroundColor: colors.accent,
  },
  sheetOptionDisabled: {
    opacity: 0.5,
  },
  sheetOptionPressed: {
    backgroundColor: colors.card,
  },
  sheetOptionText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sheetOptionLabel: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "600",
  },
  sheetOptionDescription: {
    color: colors.faint,
    fontSize: 12,
    lineHeight: 17,
  },
});
