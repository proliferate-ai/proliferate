import type {
  CloudCommandResponse,
  CloudPendingInteraction,
  CloudSessionProjection,
  CloudWorkspaceDetail,
} from "@proliferate/cloud-sdk";
import { desktopWorkspaceDeepLink } from "@proliferate/cloud-sdk";
import type { NavigateFunction } from "react-router-dom";
import type {
  CloudChatSurfaceProps,
  CloudChatHeaderNoticeView,
  CloudChatHeaderView,
} from "@proliferate/product-ui/chat/CloudChatSurface";
import type {
  CloudChatComposerFooterControlView,
} from "@proliferate/product-ui/chat/CloudChatComposer";
import type {
  CloudChatTranscriptRowView,
  CloudTranscriptStateSource,
} from "@proliferate/product-domain/chats/cloud/transcript-view";
import {
  cloudCommandReadiness,
  recentWorkCommandability,
} from "@proliferate/product-domain/workspaces/cloud-work-inventory";

import { routes } from "../../../config/routes";
import {
  buildCloudChatHeaderDiagnosticsText,
  buildCloudChatHeaderStatus,
  cloudChatSessionStatusLabel,
} from "../../../lib/domain/chat/cloud-chat-header-presentation";
import { shouldShowInitialCloudTranscriptLoading } from "../../../lib/domain/chat/cloud-chat-loading-presentation";
import {
  commandStatusMessageForNotice,
  friendlyCommandStatusMessage,
  isPromptProgressStatus,
  isWorkspacePreparationStatus,
  workspaceCommandabilityLabel,
  workspaceNoticeForStatus,
} from "../../../lib/domain/chat/cloud-chat-command-presentation";
import {
  relativeSessionTime,
  sessionOptionLabel,
} from "../../../lib/domain/chat/cloud-chat-session-model";
import {
  isAssistantLoadingRow,
  loadingStatusText,
} from "../../../lib/domain/chat/cloud-chat-transcript-row-presentation";
import {
  webCloudSessionDraftIdFromOptionId,
  webCloudSessionDraftOptionId,
  webCloudSessionDraftSearch,
  type WebCloudSessionDraft,
} from "../../../stores/cloud/web-cloud-chat-state-store";

export function buildWebCloudChatSurfaceProps(input: {
  workspace: CloudWorkspaceDetail;
  session: CloudSessionProjection | null;
  sessions: readonly CloudSessionProjection[];
  pendingSessionDraft: WebCloudSessionDraft | null;
  pendingInteractions: readonly CloudPendingInteraction[];
  workspaceStatus: string | null;
  isUnclaimed: boolean;
  canStartNewSession: boolean;
  workspaceHarnessAvailability: { message?: string | null };
  visiblePendingHomePromptStatus: string | null;
  pendingPromptCommandId: string | null;
  commandStatus: CloudCommandResponse | undefined;
  sessionLiveConnected: boolean;
  transcriptSource: CloudTranscriptStateSource;
  sessionEventsLoading: boolean;
  transcriptSnapshotLoading: boolean;
  visibleTranscriptRows: readonly CloudChatTranscriptRowView[];
  sharedTranscriptState: CloudChatSurfaceProps["transcriptState"];
  transcriptPlanActions: CloudChatSurfaceProps["transcriptPlanActions"];
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmitPrompt: () => void;
  composerControls: CloudChatSurfaceProps["composer"]["controls"];
  directPromptDispatching: boolean;
  promptCommandPending: boolean;
  claimWorkspacePending: boolean;
  onClaimWorkspace: () => void;
  onCopyComposerFooterValue: (value: string, label: string) => Promise<boolean>;
  onOpenNewSessionDraft: () => void;
  navigate: NavigateFunction;
}): CloudChatSurfaceProps {
  const workspaceCommandability = recentWorkCommandability(input.workspace);
  const commandReadiness = cloudCommandReadiness(input.workspace);
  const workspaceCommandReady = input.workspaceStatus === "ready"
    && Boolean(input.workspace.targetId)
    && Boolean(input.workspace.anyharnessWorkspaceId)
    && commandReadiness.commandable;
  const promptSubmitting = input.promptCommandPending || input.directPromptDispatching;
  const canSubmit = Boolean(
    input.draft.trim()
      && !promptSubmitting
      && !input.isUnclaimed
      && workspaceCommandReady
      && (input.session || input.canStartNewSession),
  );
  const repoLabel = `${input.workspace.repo.owner}/${input.workspace.repo.name}`;
  const defaultBranchName = input.workspace.repo.baseBranch ?? "main";
  const branchName = input.workspace.repo.branch ?? defaultBranchName;
  const workspaceDisplayName = input.workspace.displayName?.trim() ?? "";
  const workspaceTitle = workspaceDisplayName || branchName || repoLabel;
  const activeSessionLabel = input.session
    ? sessionOptionLabel(input.session)
    : "New session";
  const commandStatusMessage = input.commandStatus?.commandId === input.pendingPromptCommandId
    ? null
    : commandStatusMessageForNotice(input.commandStatus);
  const commandabilityLabel = workspaceCommandabilityLabel(workspaceCommandability);
  const commandMessage =
    input.visiblePendingHomePromptStatus ??
    commandStatusMessage ??
    (!input.session && workspaceCommandReady && !input.canStartNewSession
      ? input.workspaceHarnessAvailability.message
      : null) ??
    (!workspaceCommandReady
      ? friendlyCommandStatusMessage(commandReadiness.message)
        ?? commandReadiness.message
        ?? commandabilityLabel
      : null);
  const commandMessageShownInTranscript = input.visibleTranscriptRows.some((row) =>
    isAssistantLoadingRow(row) && Boolean(loadingStatusText(row))
  );
  const footerCommandMessage =
    commandMessageShownInTranscript || isPromptProgressStatus(commandMessage)
      ? null
      : commandMessage;
  const workspaceStatusNotice = !input.isUnclaimed
    ? workspaceNoticeForStatus({
      workspace: input.workspace,
      workspaceStatus: input.workspaceStatus,
      message: commandMessage,
      workspaceCommandReady,
    })
    : null;
  const headerDiagnosticsText = buildCloudChatHeaderDiagnosticsText({
    workspace: input.workspace,
    session: input.session,
    commandReadiness,
    commandabilityLabel,
    commandStatus: input.commandStatus,
    sessionLiveConnected: input.sessionLiveConnected,
    transcriptSource: input.transcriptSource,
  });
  const headerNotice: CloudChatHeaderNoticeView | null = input.isUnclaimed
    ? {
      title: "Unclaimed shared workspace.",
      description: "Claim this workspace before sending prompts or changing session settings.",
      tone: "warning",
      action: {
        label: "Claim",
        kind: "claim",
        loading: input.claimWorkspacePending,
        onClick: input.onClaimWorkspace,
      },
    }
    : workspaceStatusNotice
      ? {
        ...workspaceStatusNotice,
        diagnostics: {
          text: headerDiagnosticsText,
          onCopy: () => void input.onCopyComposerFooterValue(headerDiagnosticsText, "Workspace diagnostics"),
        },
      }
      : null;
  const header: CloudChatHeaderView = {
    workspaceLabel: workspaceTitle,
    status: buildCloudChatHeaderStatus({
      workspace: input.workspace,
      session: input.session,
      pendingInteractions: input.pendingInteractions,
      workspaceCommandReady,
      commandReadiness,
      workspacePreparationMessage: isWorkspacePreparationStatus(commandMessage),
      promptSubmitting,
    }),
    sessionSwitcher: {
      workspaceLabel: workspaceTitle,
      activeSessionId: input.session?.sessionId
        ?? (input.pendingSessionDraft ? webCloudSessionDraftOptionId(input.pendingSessionDraft.id) : null),
      activeSessionLabel,
      sessions: [
        ...(input.pendingSessionDraft
          ? [{
            id: webCloudSessionDraftOptionId(input.pendingSessionDraft.id),
            label: "New session",
            detail: input.pendingSessionDraft.selection.agentKind,
            statusLabel: "Draft",
          }]
          : []),
        ...input.sessions.map((candidate) => ({
          id: candidate.sessionId,
          label: sessionOptionLabel(candidate),
          detail: relativeSessionTime(candidate.lastEventAt ?? candidate.startedAt ?? null),
          statusLabel: cloudChatSessionStatusLabel(candidate),
        })),
      ],
      newSessionLabel: "New session",
      onSelectSession: (sessionId: string) => {
        const draftId = webCloudSessionDraftIdFromOptionId(sessionId);
        if (draftId) {
          input.navigate(`${routes.workspace(input.workspace.id)}${webCloudSessionDraftSearch(draftId)}`);
          return;
        }
        input.navigate(routes.chat(input.workspace.id, sessionId));
      },
      onNewSession: input.onOpenNewSessionDraft,
    },
    notice: headerNotice,
    desktopAction: {
      label: "Open in Desktop",
      kind: "desktop",
      onClick: () => {
        window.location.href = desktopWorkspaceDeepLink(input.workspace.id);
      },
    },
  };
  const claimFooterControl: CloudChatComposerFooterControlView | null = input.isUnclaimed
    ? {
      id: "claim",
      label: "Claim workspace",
      detail: "Shared",
      icon: "users",
      active: true,
      pending: input.claimWorkspacePending,
      title: "Claim this shared workspace",
      onClick: input.onClaimWorkspace,
    }
    : null;
  const composerFooterControls: CloudChatComposerFooterControlView[] = [
    ...(claimFooterControl ? [claimFooterControl] : []),
    {
      id: "copy-branch",
      label: branchName,
      detail: "Branch",
      icon: "branch",
      feedback: "copied",
      feedbackKey: branchName,
      title: "Copy branch name",
      onClick: () => input.onCopyComposerFooterValue(branchName, "Branch name"),
    },
    {
      id: "copy-repo",
      label: repoLabel,
      detail: "Repo",
      icon: "repo",
      feedback: "copied",
      feedbackKey: repoLabel,
      title: "Copy repository name",
      onClick: () => input.onCopyComposerFooterValue(repoLabel, "Repository"),
    },
  ];
  const emptyTitle = !input.session
    ? `Start the first session in ${workspaceTitle}`
    : "No transcript yet";

  return {
    header,
    transcriptRows: input.visibleTranscriptRows,
    transcriptState: input.sharedTranscriptState,
    transcriptStatus: commandMessage,
    transcriptLoading: shouldShowInitialCloudTranscriptLoading({
      hasSession: Boolean(input.session),
      sessionEventsLoading: input.sessionEventsLoading,
      transcriptSnapshotLoading: input.transcriptSnapshotLoading,
      transcriptSource: input.transcriptSource,
      visibleTranscriptRowCount: input.visibleTranscriptRows.length,
      hasSharedTranscriptState: Boolean(input.sharedTranscriptState),
    }),
    transcriptPlanActions: input.transcriptPlanActions,
    emptyTitle,
    emptyDescription: !input.session
      ? `Send a message below to start the first session in ${workspaceTitle}.`
      : undefined,
    commandMessage: workspaceStatusNotice ? null : footerCommandMessage,
    composer: {
      value: input.draft,
      onChange: input.onDraftChange,
      onSubmit: input.onSubmitPrompt,
      controls: input.composerControls,
      footerControls: composerFooterControls,
      disabled: !workspaceCommandReady || input.isUnclaimed || (!input.session && !input.canStartNewSession),
      canSubmit,
      isSubmitting: promptSubmitting,
      placeholder: input.isUnclaimed
        ? "Claim this shared workspace to reply"
        : input.session
          ? "Describe a task"
          : workspaceCommandReady
            ? input.canStartNewSession
              ? "Describe a task"
              : "No cloud agents ready"
            : workspaceCommandability === "stale"
              ? "Desktop or remote runtime is offline"
              : "Waiting for workspace",
    },
  };
}
