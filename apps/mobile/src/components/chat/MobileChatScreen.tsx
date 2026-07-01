import { useState } from "react";
import * as Clipboard from "expo-clipboard";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import {
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
  DEFAULT_DIRECT_PROMPT_MODEL_ID,
  type CloudLaunchComposerSelection,
  type PendingConfigChange,
} from "@proliferate/product-domain/chats/cloud/composer-controls";
import {
  cloudCommandReadiness,
} from "@proliferate/product-domain/workspaces/cloud-work-inventory";

import { useVisualViewportKeyboardInset } from "../../hooks/ui/keyboard/use-visual-viewport-keyboard-inset";
import { useMobileChatData } from "../../hooks/chat/derived/use-mobile-chat-data";
import { useMobileChatLifecycle } from "../../hooks/chat/lifecycle/use-mobile-chat-lifecycle";
import { useMobileChatActions } from "../../hooks/chat/workflows/use-mobile-chat-actions";
import { useMobileChatPermissionSheet } from "../../hooks/chat/ui/use-mobile-chat-permission-sheet";
import { MobileWorkspaceActionSheet } from "./MobileWorkspaceActionSheet";
import type {
  MobileCloudChat,
  MobilePendingPrompt,
} from "../../navigation/navigation-model";
import type { OptimisticPrompt } from "../../lib/domain/chat/mobile-chat-transcript";
import {
  mobileStatus,
  summarizeRuntimeContext,
} from "../../lib/domain/chat/mobile-chat-presentation";
import {
  isAssistantLoadingRow,
  isPromptProgressStatus,
  loadingStatusText,
} from "../../lib/domain/chat/mobile-chat-row-presentation";
import { colors } from "../../styles/tokens";
import { MobileChatClaimBanner } from "./screen/MobileChatClaimBanner";
import { MobileChatComposer } from "./screen/MobileChatComposer";
import { MobileChatHeader } from "./screen/MobileChatHeader";
import { MobileChatToolDetailSheet } from "./screen/MobileChatToolDetailSheet";
import { MobileChatTranscript } from "./screen/MobileChatTranscript";

interface MobileChatScreenProps {
  chat: MobileCloudChat;
  ownerUserId: string | null;
  productToken: string | null;
  onBack: () => void;
  onInitialPendingPromptConsumed?: () => void;
  onSessionSelected?: (sessionId: string) => void;
}

export function MobileChatScreen({
  chat,
  ownerUserId,
  productToken,
  onBack,
  onInitialPendingPromptConsumed,
  onSessionSelected,
}: MobileChatScreenProps) {
  const keyboardInset = useVisualViewportKeyboardInset();
  const [draft, setDraft] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(chat.sessionId);
  const [launchSelection, setLaunchSelection] = useState<CloudLaunchComposerSelection>({
    agentKind: DEFAULT_DIRECT_PROMPT_AGENT_KIND,
    modelId: DEFAULT_DIRECT_PROMPT_MODEL_ID,
    modeId: null,
    controlValues: {},
  });
  const [newSessionMode, setNewSessionMode] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<MobilePendingPrompt | null>(null);
  const [pendingPromptStatus, setPendingPromptStatus] = useState<string | null>(null);
  const [pendingPromptFailed, setPendingPromptFailed] = useState(false);
  const [optimisticPrompts, setOptimisticPrompts] = useState<OptimisticPrompt[]>([]);
  const [pendingConfigChanges, setPendingConfigChanges] = useState<
    Record<string, PendingConfigChange>
  >({});
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [actionSheetInitialExpandedId, setActionSheetInitialExpandedId] = useState<string | null>(null);
  const [claimedLocally, setClaimedLocally] = useState(false);

  const {
    workspaceQuery,
    workspace,
    sessions,
    session,
    sessionChoiceRequired,
    activeSessionId,
    targetId,
    workspaceStatus,
    sessionLive,
    transcriptQuery,
    sessionEventsQuery,
    transcriptItems,
    pendingInteractions,
    pendingPermissionByRequestId,
    transcriptView,
    hasActiveOptimisticPrompt,
    pendingPromptDurable,
    visibleTranscriptRows,
  } = useMobileChatData({
    chat,
    productToken,
    selectedSessionId,
    newSessionMode,
    pendingPrompt,
    pendingPromptFailed,
    pendingPromptStatus,
    optimisticPrompts,
  });
  const {
    toolDetailRow,
    toolDetailPermission,
    permissionResolveError,
    resolvingPermissionKey,
    setToolDetailRow,
    setPermissionResolveError,
    setResolvingPermissionKey,
    openToolDetailRow,
    closeToolDetailSheet,
    resetPermissionSheet,
  } = useMobileChatPermissionSheet({
    pendingPermissionByRequestId,
    visibleTranscriptRows,
  });
  const runtimeContext = summarizeRuntimeContext(workspace, workspaceStatus);
  const {
    workspaceHarnessAvailability,
    canStartNewSession,
    liveConfig,
    composerControls,
    composerControlSummary,
    client,
    invalidateWorkspaceLists,
    pendingDispatchRunRef,
    claimPending,
    promptSubmitting,
    submitPrompt,
    resolvePermissionInteraction,
    claimChat,
    startNewSession,
    selectSession,
  } = useMobileChatActions({
    ownerUserId,
    productToken,
    workspace,
    session,
    draft,
    pendingPrompt,
    pendingPromptFailed,
    hasActiveOptimisticPrompt,
    launchSelection,
    runtimeLabel: runtimeContext.label,
    transcriptItems,
    transcriptRows: transcriptView.rows,
    isUnclaimed: workspace?.visibility === "shared_unclaimed" && !claimedLocally,
    pendingConfigChanges,
    setDraft,
    setLaunchSelection,
    setPendingPrompt,
    setPendingPromptStatus,
    setPendingPromptFailed,
    setOptimisticPrompts,
    setPendingConfigChanges,
    setSelectedSessionId,
    setNewSessionMode,
    setClaimedLocally,
    setPermissionResolveError,
    setResolvingPermissionKey,
    setToolDetailRow,
    onSessionSelected,
    closeWorkspaceActionSheet,
    workspaceRefetch: workspaceQuery.refetch,
    transcriptRefetch: transcriptQuery.refetch,
    sessionEventsRefetch: sessionEventsQuery.refetch,
  });
  useMobileChatLifecycle({
    chat,
    ownerUserId,
    onInitialPendingPromptConsumed,
    onSessionSelected,
    client,
    productToken,
    invalidateWorkspaceLists,
    workspace,
    workspaceStatus,
    workspaceRefetch: workspaceQuery.refetch,
    session,
    targetId,
    sessionLiveLastPatchAt: sessionLive.lastPatchAt,
    transcriptRefetch: transcriptQuery.refetch,
    sessionEventsRefetch: sessionEventsQuery.refetch,
    transcriptItems,
    transcriptRows: transcriptView.rows,
    pendingInteractions,
    pendingPrompt,
    pendingPromptFailed,
    pendingPromptDurable,
    hasActiveOptimisticPrompt,
    optimisticPrompts,
    liveConfig,
    pendingConfigChanges,
    pendingDispatchRunRef,
    setDraft,
    setSelectedSessionId,
    setNewSessionMode,
    setPendingPrompt,
    setPendingPromptStatus,
    setPendingPromptFailed,
    setOptimisticPrompts,
    setPendingConfigChanges,
    setClaimedLocally,
    resetPermissionSheet,
  });
  function openWorkspaceActionSheet(expandedId: string | null = null) {
    setActionSheetInitialExpandedId(expandedId);
    setActionSheetOpen(true);
  }

  function closeWorkspaceActionSheet() {
    setActionSheetOpen(false);
    setActionSheetInitialExpandedId(null);
  }

  const isUnclaimed = workspace?.visibility === "shared_unclaimed" && !claimedLocally;
  const commandReadiness = workspace ? cloudCommandReadiness(workspace) : null;
  const workspaceCommandReady =
    workspaceStatus === "ready"
    && Boolean(workspace?.anyharnessWorkspaceId)
    && commandReadiness?.commandable === true;
  const canSubmit = Boolean(
    draft.trim()
      && !isUnclaimed
      && !promptSubmitting
      && !sessionChoiceRequired
      && (session ? true : canStartNewSession)
      && workspaceCommandReady,
  );
  const title = newSessionMode
    ? "New session"
    : session?.title ?? workspace?.displayName ?? chat.title;
  const subtitle = workspace?.repo
    ? `${workspace.repo.owner}/${workspace.repo.name}`
    : chat.repoLabel;
  const branchLabel = workspace?.repo.branch ?? workspace?.repo.baseBranch ?? chat.branchLabel;
  const commandMessage =
    pendingPromptStatus ??
    (!session && !canStartNewSession ? workspaceHarnessAvailability.message : null) ??
    (!workspaceCommandReady && workspaceStatus === "ready" ? commandReadiness?.message ?? null : null);
  const commandMessageShownInTranscript = visibleTranscriptRows.some((row) =>
    isAssistantLoadingRow(row) && Boolean(loadingStatusText(row))
  );
  const footerCommandMessage =
    commandMessageShownInTranscript || isPromptProgressStatus(commandMessage)
      ? null
      : commandMessage;
  const emptyTitle = !session
    ? sessionChoiceRequired ? "Choose a session" : newSessionMode ? "New session" : "No active session yet."
    : sessionEventsQuery.isLoading && transcriptView.source === "empty"
      ? "Loading transcript"
      : "Waiting for the first projected transcript event.";
  const composerPlaceholder = isUnclaimed
    ? "Claim this workspace to reply"
    : sessionChoiceRequired
      ? "Choose a session or start a new one"
    : session
      ? "Message this session"
      : !canStartNewSession
        ? "Choose an available cloud agent"
      : workspaceCommandReady
        ? "Start a session with a message"
        : "Waiting for workspace";
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.select({ ios: "padding", default: undefined })}
      keyboardVerticalOffset={0}
    >
      <MobileChatHeader
        title={title}
        subtitle={subtitle}
        status={mobileStatus(session?.status ?? workspaceStatus)}
        sessionsCount={sessions.length}
        unclaimed={isUnclaimed}
        onBack={onBack}
        onOpenSessions={() => openWorkspaceActionSheet("sessions")}
        onOpenActions={() => openWorkspaceActionSheet()}
      />

      {isUnclaimed ? (
        <MobileChatClaimBanner
          claimPending={claimPending}
          onClaim={() => void claimChat()}
        />
      ) : null}

      <MobileChatTranscript
        rows={visibleTranscriptRows}
        emptyTitle={emptyTitle}
        emptyBody={
          !session
            ? sessionChoiceRequired
              ? "Open the workspace menu to switch sessions or start a new one."
              : "Send a prompt below to start a projected session."
            : "Transcript projection will appear here."
        }
        footerMessage={footerCommandMessage}
        onToolPress={openToolDetailRow}
      />

      <MobileChatComposer
        draft={draft}
        placeholder={composerPlaceholder}
        controlLabel={composerControlSummary.label}
        controlPending={composerControlSummary.pending}
        canSubmit={canSubmit}
        keyboardInset={keyboardInset}
        onChangeDraft={setDraft}
        onOpenSettings={() => openWorkspaceActionSheet()}
        onSubmit={() => void submitPrompt()}
      />

      <MobileWorkspaceActionSheet
        visible={actionSheetOpen}
        initialExpandedId={actionSheetInitialExpandedId}
        branchLabel={branchLabel}
        runtimeLabel={runtimeContext.label}
        runtimeDetail={runtimeContext.detail}
        runtimeIcon={runtimeContext.icon}
        unclaimed={isUnclaimed}
        claimPending={claimPending}
        promptSubmitting={promptSubmitting}
        sessions={sessions}
        activeSessionId={session?.sessionId ?? null}
        newSessionMode={newSessionMode}
        composerControls={composerControls}
        onClaim={claimChat}
        onNewSession={startNewSession}
        onSelectSession={selectSession}
        onCopyBranch={() => void copyBranchToClipboard(branchLabel)}
        onClose={closeWorkspaceActionSheet}
      />
      <MobileChatToolDetailSheet
        row={toolDetailRow}
        pendingPermission={toolDetailPermission}
        resolvingPermissionKey={resolvingPermissionKey}
        permissionResolveError={permissionResolveError}
        onResolvePermission={(interaction, option) => {
          void resolvePermissionInteraction(interaction, option);
        }}
        onClose={closeToolDetailSheet}
      />
    </KeyboardAvoidingView>
  );
}

async function copyBranchToClipboard(branchLabel: string): Promise<void> {
  await Clipboard.setStringAsync(branchLabel);
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
