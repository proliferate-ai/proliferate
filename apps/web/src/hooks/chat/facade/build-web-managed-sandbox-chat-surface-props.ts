import type { Session } from "@anyharness/sdk";
import { desktopWorkspaceDeepLink, type CloudWorkspaceDetail } from "@proliferate/cloud-sdk";
import type { ChatTranscriptState } from "@proliferate/product-domain/chats/transcript/chat-transcript-state";
import type { SessionViewState } from "@proliferate/product-domain/sessions/activity";
import type {
  CloudChatComposerFooterControlView,
} from "@proliferate/product-ui/chat/CloudChatComposer";
import type {
  CloudChatHeaderNoticeView,
  CloudChatHeaderView,
  CloudChatSurfaceProps,
} from "@proliferate/product-ui/chat/CloudChatSurface";
import type { NavigateFunction } from "react-router-dom";

import { routes } from "../../../config/routes";
import {
  sessionOptionLabel,
  sessionStatusLabel,
} from "../../../lib/domain/chat/anyharness-launch-options";

export function buildWebManagedSandboxChatSurfaceProps(input: {
  workspace: CloudWorkspaceDetail;
  session: Session | null;
  sessions: readonly Session[];
  transcriptState: ChatTranscriptState | null;
  transcriptPlanActions: CloudChatSurfaceProps["transcriptPlanActions"];
  transcriptLoading: boolean;
  transcriptStatus: string | null;
  sessionViewState: SessionViewState;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmitPrompt: () => void;
  composerControls: CloudChatSurfaceProps["composer"]["controls"];
  promptSubmitting: boolean;
  runtimeReady: boolean;
  runtimeMessage: string | null;
  onCopyComposerFooterValue: (value: string, label: string) => Promise<boolean>;
  onOpenNewSession: () => void;
  navigate: NavigateFunction;
}): CloudChatSurfaceProps {
  const repoLabel = `${input.workspace.repo.owner}/${input.workspace.repo.name}`;
  const defaultBranchName = input.workspace.repo.baseBranch ?? "main";
  const branchName = input.workspace.repo.branch ?? defaultBranchName;
  const workspaceDisplayName = input.workspace.displayName?.trim() ?? "";
  const workspaceTitle = workspaceDisplayName || branchName || repoLabel;
  const isUnclaimed = input.workspace.visibility === "shared_unclaimed";
  const canSubmit = Boolean(
    input.draft.trim()
      && input.runtimeReady
      && !input.promptSubmitting
      && !isUnclaimed,
  );
  const activeSessionLabel = input.session
    ? sessionOptionLabel(input.session)
    : "New session";
  const status = input.session
    ? statusForSessionViewState(input.sessionViewState)
    : input.runtimeReady
      ? { label: "Ready", tone: "success" as const }
      : { label: "Connecting", tone: "info" as const, live: true };
  const headerNotice: CloudChatHeaderNoticeView | null = isUnclaimed
    ? {
      title: "Unclaimed shared workspace.",
      description: "Claim this workspace before sending prompts or changing session settings.",
      tone: "warning",
    }
    : input.runtimeMessage
      ? {
        title: input.runtimeReady ? "Cloud runtime ready." : "Cloud runtime unavailable.",
        description: input.runtimeMessage,
        tone: input.runtimeReady ? "info" : "warning",
      }
      : null;
  const header: CloudChatHeaderView = {
    workspaceLabel: workspaceTitle,
    status,
    sessionSwitcher: {
      workspaceLabel: workspaceTitle,
      activeSessionId: input.session?.id ?? null,
      activeSessionLabel,
      sessions: input.sessions.map((session) => ({
        id: session.id,
        label: sessionOptionLabel(session),
        detail: relativeSessionTime(session.updatedAt ?? session.createdAt),
        statusLabel: sessionStatusLabel(session),
      })),
      newSessionLabel: "New session",
      onSelectSession: (sessionId) => input.navigate(routes.chat(input.workspace.id, sessionId)),
      onNewSession: input.onOpenNewSession,
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
  const composerFooterControls: CloudChatComposerFooterControlView[] = [
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

  return {
    header,
    transcriptRows: [],
    transcriptState: input.transcriptState,
    transcriptPlanActions: input.transcriptPlanActions,
    transcriptStatus: input.transcriptStatus,
    transcriptLoading: input.transcriptLoading,
    emptyTitle: input.session
      ? "No transcript yet"
      : `Start the first session in ${workspaceTitle}`,
    emptyDescription: input.session
      ? undefined
      : `Send a message below to start a session in ${workspaceTitle}.`,
    commandMessage: input.runtimeMessage,
    composer: {
      value: input.draft,
      onChange: input.onDraftChange,
      onSubmit: input.onSubmitPrompt,
      controls: input.composerControls,
      footerControls: composerFooterControls,
      disabled: !input.runtimeReady || isUnclaimed,
      canSubmit,
      isSubmitting: input.promptSubmitting,
      placeholder: isUnclaimed
        ? "Claim this shared workspace to reply"
        : input.runtimeReady
          ? "Describe a task"
          : "Connecting to cloud runtime",
    },
    telemetryBlocked: true,
  };
}

function statusForSessionViewState(state: SessionViewState): CloudChatHeaderView["status"] {
  switch (state) {
    case "working":
      return { label: "Working", tone: "info", live: true };
    case "needs_input":
      return { label: "Needs input", tone: "warning" };
    case "errored":
      return { label: "Error", tone: "destructive" };
    case "closed":
      return { label: "Closed", tone: "neutral" };
    case "idle":
    default:
      return { label: "Ready", tone: "success" };
  }
}

function relativeSessionTime(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) {
    return "Just now";
  }
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
}
