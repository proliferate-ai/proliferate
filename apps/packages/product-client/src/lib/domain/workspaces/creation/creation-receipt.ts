import type { SetupScriptStatus } from "@anyharness/sdk";
import { WORKSPACE_CREATION_RECEIPT_LABELS } from "#product/copy/workspaces/workspace-arrival-copy";

/**
 * Workspace-creation transcript receipt — presentation model.
 *
 * The receipt is a quiet collapsible transcript line ("Worktree created")
 * with an expandable log block. It is composed client-side from server truth
 * only: the pending creation entry while the workspace is being made, then
 * the workspace record plus the setup-status query once it exists. Nothing
 * about the receipt is stored; reloads re-derive the same state.
 */

export type WorkspaceCreationReceiptNoun = "worktree" | "workspace";

/**
 * Whether a pending workspace entry carries a creation receipt. Cloud and
 * cowork provisioning keep their composer panel; the receipt owns only
 * local/worktree creations.
 */
export function isReceiptPendingEntry<T extends { source: string }>(
  entry: T | null,
): entry is T {
  return !!entry
    && (entry.source === "local-created" || entry.source === "worktree-created");
}

/**
 * The receipt belongs to the workspace's first session only — the session
 * that came into being with the creation. Later sessions in the same
 * workspace must not replay it. "First" is derived from server truth
 * (earliest `createdAt`, ties broken by id for stability), so reloads agree.
 */
export function resolveFirstWorkspaceSessionId(
  sessions: readonly { id: string; createdAt: string }[] | undefined,
): string | null {
  if (!sessions || sessions.length === 0) {
    return null;
  }
  let first = sessions[0];
  for (const candidate of sessions.slice(1)) {
    if (
      candidate.createdAt < first.createdAt
      || (candidate.createdAt === first.createdAt && candidate.id < first.id)
    ) {
      first = candidate;
    }
  }
  return first.id;
}

export interface WorkspaceCreationReceiptSetupSource {
  /** Trimmed setup command; null when no setup script is involved. */
  command: string | null;
  /** Latest execution status; null when setup never ran. */
  status: SetupScriptStatus | null;
  /** `summarizeSetupFailure(...)` output when status is "failed". */
  failureSummary: string | null;
  terminalId: string | null;
}

export type WorkspaceCreationReceiptSource =
  | {
    phase: "creating";
    noun: WorkspaceCreationReceiptNoun;
    workspacePath: string | null;
    setupCommand: string | null;
  }
  | {
    phase: "creation-failed";
    noun: WorkspaceCreationReceiptNoun;
    workspacePath: string | null;
    errorMessage: string | null;
  }
  | {
    phase: "created";
    noun: WorkspaceCreationReceiptNoun;
    workspacePath: string;
    materializedWorkspaceId: string;
    setup: WorkspaceCreationReceiptSetupSource;
  };

export interface WorkspaceCreationReceiptLogLine {
  text: string;
  tone: "default" | "destructive" | "faint";
}

export interface WorkspaceCreationReceiptPresentation {
  /** The receipt sentence. Failure is carried by the words, never by color. */
  line: string;
  /** Trailing muted label while setup is in flight ("Setup running"). */
  busyLabel: string | null;
  showSpinner: boolean;
  logLines: readonly WorkspaceCreationReceiptLogLine[];
  /** Failure states open their log by default; success stays collapsed. */
  defaultExpanded: boolean;
  showRerun: boolean;
  rerunDisabled: boolean;
  rerunLabel: string;
  /** Creation-failed receipts surface the pending-entry Back/Retry actions. */
  showCreationRetry: boolean;
}

export function workspaceCreationReceiptCopyText(
  logLines: readonly WorkspaceCreationReceiptLogLine[],
): string {
  return logLines.map((line) => line.text).join("\n");
}

/** "Setup failed with exit code 2: <detail>" → "Setup failed with exit code 2". */
function stripFailureDetail(failureSummary: string): string {
  const colonIndex = failureSummary.indexOf(":");
  return colonIndex === -1 ? failureSummary : failureSummary.slice(0, colonIndex);
}

export function presentWorkspaceCreationReceipt(
  source: WorkspaceCreationReceiptSource,
  options: {
    /**
     * Failure summary of the run that a rerun replaced, captured by the
     * component when the user triggers "Rerun setup". Renders as the dimmed
     * "(previous run)" log line and switches the success sentence to
     * "…, setup completed".
     */
    previousFailureSummary?: string | null;
  } = {},
): WorkspaceCreationReceiptPresentation {
  const labels = WORKSPACE_CREATION_RECEIPT_LABELS;
  const previousFailureSummary = options.previousFailureSummary ?? null;

  if (source.phase === "creating") {
    const logLines: WorkspaceCreationReceiptLogLine[] = [];
    if (source.workspacePath) {
      logLines.push({
        text: `${labels.preparingLogPrefix[source.noun]} ${source.workspacePath}`,
        tone: "default",
      });
    }
    if (source.setupCommand) {
      logLines.push({ text: `$ ${source.setupCommand}`, tone: "default" });
    }
    return {
      line: labels.creating[source.noun],
      busyLabel: null,
      showSpinner: true,
      logLines,
      defaultExpanded: false,
      showRerun: false,
      rerunDisabled: false,
      rerunLabel: labels.rerunSetup,
      showCreationRetry: false,
    };
  }

  if (source.phase === "creation-failed") {
    const logLines: WorkspaceCreationReceiptLogLine[] = [];
    if (source.workspacePath) {
      logLines.push({
        text: `${labels.preparingLogPrefix[source.noun]} ${source.workspacePath}`,
        tone: "default",
      });
    }
    logLines.push({
      text: source.errorMessage?.trim() || labels.creationFailedFallbackDetail,
      tone: "destructive",
    });
    return {
      line: labels.creationFailed[source.noun],
      busyLabel: null,
      showSpinner: false,
      logLines,
      defaultExpanded: true,
      showRerun: false,
      rerunDisabled: false,
      rerunLabel: labels.rerunSetup,
      showCreationRetry: true,
    };
  }

  const { setup, noun } = source;
  const createdLine = labels.created[noun];
  const pathLine: WorkspaceCreationReceiptLogLine = {
    text: `${labels.createdLogPrefix[noun]} ${source.workspacePath}`,
    tone: "default",
  };
  const commandLine: WorkspaceCreationReceiptLogLine | null = setup.command
    ? { text: `$ ${setup.command}`, tone: "default" }
    : null;
  const previousRunLine: WorkspaceCreationReceiptLogLine | null = previousFailureSummary
    ? {
      text: `${stripFailureDetail(previousFailureSummary)} ${labels.previousRunSuffix}`,
      tone: "faint",
    }
    : null;

  if (setup.status === "failed") {
    return {
      line: labels.createdSetupFailed[noun],
      busyLabel: null,
      showSpinner: false,
      logLines: [
        pathLine,
        ...(commandLine ? [commandLine] : []),
        {
          text: setup.failureSummary ?? labels.setupFailedFallbackDetail,
          tone: "destructive" as const,
        },
      ],
      defaultExpanded: true,
      showRerun: true,
      rerunDisabled: false,
      rerunLabel: labels.rerunSetup,
      showCreationRetry: false,
    };
  }

  if (setup.status === "queued" || setup.status === "running") {
    const isQueued = setup.status === "queued";
    const progressLine: WorkspaceCreationReceiptLogLine = previousRunLine && !isQueued
      ? { text: `$ ${setup.command ?? ""} ${labels.rerunLogSuffix}`.trim(), tone: "default" }
      : {
        text: isQueued ? labels.setupQueuedLog : labels.setupRunningLog,
        tone: "default",
      };
    return {
      line: createdLine,
      busyLabel: isQueued ? labels.setupQueuedStatus : labels.setupRunningStatus,
      showSpinner: true,
      logLines: [
        pathLine,
        ...(commandLine ? [commandLine] : []),
        ...(previousRunLine ? [previousRunLine] : []),
        progressLine,
      ],
      defaultExpanded: previousRunLine !== null,
      showRerun: previousRunLine !== null,
      rerunDisabled: true,
      rerunLabel: labels.rerunningLabel,
      showCreationRetry: false,
    };
  }

  if (setup.status === "succeeded") {
    if (previousRunLine) {
      return {
        line: labels.createdSetupCompleted[noun],
        busyLabel: null,
        showSpinner: false,
        logLines: [
          pathLine,
          ...(commandLine ? [commandLine] : []),
          previousRunLine,
          {
            text: `$ ${setup.command ?? ""} ${labels.rerunLogSuffix}`.trim(),
            tone: "default" as const,
          },
          { text: labels.setupSucceededLog, tone: "default" as const },
        ],
        defaultExpanded: false,
        showRerun: false,
        rerunDisabled: false,
        rerunLabel: labels.rerunSetup,
        showCreationRetry: false,
      };
    }
    return {
      line: createdLine,
      busyLabel: null,
      showSpinner: false,
      logLines: [
        pathLine,
        {
          text: setup.command
            ? `${labels.setupSucceededLog} · ${setup.command}`
            : labels.setupSucceededLog,
          tone: "default" as const,
        },
      ],
      defaultExpanded: false,
      showRerun: false,
      rerunDisabled: false,
      rerunLabel: labels.rerunSetup,
      showCreationRetry: false,
    };
  }

  // No setup run recorded — either no setup script, or status not yet known.
  return {
    line: createdLine,
    busyLabel: null,
    showSpinner: false,
    logLines: [pathLine, ...(commandLine ? [commandLine] : [])],
    defaultExpanded: false,
    showRerun: false,
    rerunDisabled: false,
    rerunLabel: labels.rerunSetup,
    showCreationRetry: false,
  };
}
