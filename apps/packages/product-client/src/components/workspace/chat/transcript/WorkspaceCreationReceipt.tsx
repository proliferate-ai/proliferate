import { useCallback, useId, useState } from "react";
import { useRerunSetupMutation } from "@anyharness/sdk-react";
import { Button } from "#product/primitives/Button";
import { IconButton } from "#product/primitives/IconButton";
import { Spinner } from "#product/primitives/Spinner";
import { ArrowUpRight, ChevronDown, Copy, Fork } from "#product/primitives/icons/core";
import { WORKSPACE_CREATION_RECEIPT_LABELS } from "#product/copy/workspaces/workspace-arrival-copy";
import {
  presentWorkspaceCreationReceipt,
  workspaceCreationReceiptCopyText,
  type WorkspaceCreationReceiptPresentation,
} from "#product/lib/domain/workspaces/creation/creation-receipt";
import {
  useWorkspaceCreationReceiptState,
  type WorkspaceCreationReceiptState,
} from "#product/hooks/workspaces/derived/use-workspace-creation-receipt";
import { usePendingWorkspaceEntryActions } from "#product/hooks/workspaces/workflows/use-pending-workspace-entry-actions";
import { useWorkspaceShellActions } from "#product/hooks/workspaces/workflows/use-workspace-shell-actions";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useWorkspaceCollectionsInvalidation } from "#product/hooks/workspaces/cache/use-workspace-collections-invalidation";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { isWorkspaceArchivedRefusal } from "#product/lib/domain/workspaces/archived/workspace-archived-refusal";

const LINE_TONE_CLASS = {
  default: "",
  destructive: "text-destructive",
  faint: "text-faint",
} as const;

export interface WorkspaceCreationReceiptViewProps {
  presentation: WorkspaceCreationReceiptPresentation;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** "See terminal" renders only when a setup terminal exists. */
  showSeeTerminal?: boolean;
  onSeeTerminal?: () => void;
  onRerun?: () => void;
  onRetryCreation?: () => void;
  onBackFromCreation?: () => void;
}

/**
 * Workspace-creation transcript receipt — a quiet collapsible tool-call-style
 * line ("Worktree created") with an expandable log block. Pure view; the
 * connected wrapper below (and playground fixtures) supply the presentation.
 *
 * Placement: it renders as one of the first turn's tool calls — folded
 * inside that turn's completed-history "Worked for Ns" disclosure (hidden
 * until expanded) once the turn completes, or inline before the turn's first
 * non-user-message content while it streams. Before any turn exists (the
 * worktree is still being created, the user's prompt queued), it instead
 * renders in the pending prompt row's frontier slot, replacing the
 * "Thinking"/outbox status there — see `TranscriptPendingPromptRow`'s
 * `workspaceReceipt` prop. See `transcript-row-model.ts`'s
 * `applyWorkspaceReceiptHost` for the turn-hosting placement rule.
 */
export function WorkspaceCreationReceiptView({
  presentation,
  expanded,
  onToggleExpanded,
  showSeeTerminal = false,
  onSeeTerminal,
  onRerun,
  onRetryCreation,
  onBackFromCreation,
}: WorkspaceCreationReceiptViewProps) {
  const labels = WORKSPACE_CREATION_RECEIPT_LABELS;
  const logId = useId();
  const hasLog = presentation.logLines.length > 0;
  const showActions = expanded
    && (presentation.showRerun || presentation.showCreationRetry || showSeeTerminal);

  const handleCopy = useCallback(() => {
    navigator.clipboard
      ?.writeText(workspaceCreationReceiptCopyText(presentation.logLines))
      .catch(() => {
        // Clipboard permission denied — nothing actionable to surface here.
      });
  }, [presentation.logLines]);

  return (
    <div data-workspace-creation-receipt className="min-w-0 py-1 text-chat">
      <Button
        variant="ghost"
        size="sm"
        type="button"
        data-chat-transcript-ignore
        disabled={!hasLog}
        onClick={hasLog ? onToggleExpanded : undefined}
        aria-expanded={hasLog ? expanded : undefined}
        aria-controls={hasLog ? logId : undefined}
        className="group/receipt h-auto max-w-full justify-start gap-1.5 rounded-none bg-transparent p-0 text-left text-chat font-normal text-muted-foreground/60 hover:bg-transparent hover:text-foreground focus-visible:ring-0 focus-visible:underline disabled:cursor-default disabled:opacity-100"
      >
        {/* The spinner owns the leading icon slot while work is in flight.
            Trailing the label instead means the indicator jumps to a new x
            every time the phase changes the text ("Creating worktree" →
            "Worktree created · Setup running"). Settled, the fork mark is a
            worktree-only signal (PRO-251): a plain workspace receipt shows
            no glyph rather than borrowing the worktree one. */}
        {presentation.showSpinner ? (
          <Spinner className="icon-compact shrink-0 text-muted-foreground" />
        ) : presentation.noun === "worktree" ? (
          <Fork aria-hidden="true" className="icon-compact shrink-0 text-faint" />
        ) : null}
        <span className="min-w-0 truncate">{presentation.line}</span>
        {presentation.busyLabel && (
          <span className="shrink-0 text-faint">· {presentation.busyLabel}</span>
        )}
        {hasLog && (
          <ChevronDown
            aria-hidden="true"
            className={`icon-compact shrink-0 transition-transform duration-hover ${expanded ? "" : "-rotate-90"}`}
          />
        )}
      </Button>

      {expanded && hasLog && (
        // Recorded exclusion (DESIGN_SYSTEM.md § UI-conformance review,
        // check 1): the setup log is an unfilled frame — a hairline around
        // transcript ground, so the log reads as part of the column rather than
        // as a raised card. `Card`'s two surfaces both paint a fill, and there
        // is no borderless-with-edge spelling. Needs a ruling on `Card`.
        <div
          id={logId}
          data-chat-transcript-ignore
          className="group/receipt-log relative mt-1.5 max-w-full rounded-lg border border-border"
        >
          <div className="flex flex-col gap-0.5 overflow-x-auto px-3.5 py-3 font-mono text-readable-code text-muted-foreground">
            {presentation.logLines.map((line, index) => (
              <span key={index} className={`w-max whitespace-pre ${LINE_TONE_CLASS[line.tone]}`}>
                {line.text}
              </span>
            ))}
          </div>
          <div className="pointer-events-none absolute right-1 top-1 opacity-0 transition-opacity duration-hover group-hover/receipt-log:pointer-events-auto group-hover/receipt-log:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
            <IconButton title={labels.copyLogTitle} size="sm" onClick={handleCopy}>
              <Copy className="icon-paired" />
            </IconButton>
          </div>
        </div>
      )}

      {showActions && (
        <div data-chat-transcript-ignore className="mt-2 flex items-center gap-2">
          {presentation.showCreationRetry ? (
            <>
              <Button variant="secondary" size="sm" type="button" onClick={onBackFromCreation}>
                {labels.backFromCreation}
              </Button>
              <Button size="sm" type="button" onClick={onRetryCreation}>
                {labels.retryCreation}
              </Button>
            </>
          ) : (
            <>
              {showSeeTerminal && (
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  className="whitespace-nowrap"
                  onClick={onSeeTerminal}
                >
                  {labels.seeTerminal}
                  <ArrowUpRight className="icon-compact" />
                </Button>
              )}
              {presentation.showRerun && (
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled={presentation.rerunDisabled}
                  onClick={onRerun}
                >
                  {presentation.rerunLabel}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectedWorkspaceCreationReceipt({ state }: { state: WorkspaceCreationReceiptState }) {
  const { source } = state;
  const shellActions = useWorkspaceShellActions();
  const rerunSetup = useRerunSetupMutation();
  const { handleRetry, handleBack } = usePendingWorkspaceEntryActions();
  const runtimeUrl = useHarnessConnectionStore((store) => store.runtimeUrl);
  const invalidateWorkspaceCollections = useWorkspaceCollectionsInvalidation(runtimeUrl);

  // Failure summary of the run a rerun replaced — renders as the dimmed
  // "(previous run)" log line. Component-local: reruns are an in-session
  // gesture, and reloads legitimately re-derive from server state alone.
  const [previousFailureSummary, setPreviousFailureSummary] = useState<string | null>(null);
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);

  const basePresentation = presentWorkspaceCreationReceipt(source, { previousFailureSummary });
  // The rerun mutation has no optimistic update — until the refetched setup
  // status lands, the source still reads "failed". Pin the disabled
  // "Rerunning…" state to the mutation itself so the button can't double-fire
  // during that window.
  const presentation = rerunSetup.isPending
    ? {
      ...basePresentation,
      showRerun: true,
      rerunDisabled: true,
      rerunLabel: WORKSPACE_CREATION_RECEIPT_LABELS.rerunningLabel,
    }
    : basePresentation;
  const expanded = expandedOverride ?? presentation.defaultExpanded;

  const setup = source.phase === "created" ? source.setup : null;
  const materializedWorkspaceId = source.phase === "created"
    ? source.materializedWorkspaceId
    : null;

  const handleRerun = useCallback(() => {
    if (!materializedWorkspaceId || rerunSetup.isPending) {
      return;
    }
    setPreviousFailureSummary(setup?.failureSummary ?? null);
    // The receipt replaces the dismissible setup-failure panel; clear any
    // dismissal recorded against this workspace so legacy state can't
    // linger once the rerun resolves.
    useWorkspaceUiStore.getState().clearSetupFailureDismissal(state.receiptKey);
    void rerunSetup.mutateAsync(materializedWorkspaceId).catch((error: unknown) => {
      // WORKSPACE_ARCHIVED (§3.11): the server is correct, only the client
      // was stale — refresh the listing and raise no failure toast. Every
      // other rerun failure is already surfaced through the mutation's own
      // error state.
      if (isWorkspaceArchivedRefusal(error)) {
        void invalidateWorkspaceCollections();
      }
    });
  }, [
    invalidateWorkspaceCollections,
    materializedWorkspaceId,
    rerunSetup,
    setup?.failureSummary,
    state.receiptKey,
  ]);

  const handleSeeTerminal = useCallback(() => {
    if (setup?.terminalId) {
      shellActions?.openTerminalPanel(setup.terminalId);
    }
  }, [setup?.terminalId, shellActions]);

  const handleRetryCreation = useCallback(() => {
    if (state.pendingEntry) {
      void handleRetry(state.pendingEntry);
    }
  }, [handleRetry, state.pendingEntry]);

  const handleBackFromCreation = useCallback(() => {
    if (state.pendingEntry) {
      void handleBack(state.pendingEntry);
    }
  }, [handleBack, state.pendingEntry]);

  return (
    <WorkspaceCreationReceiptView
      presentation={presentation}
      expanded={expanded}
      onToggleExpanded={() => setExpandedOverride(!expanded)}
      showSeeTerminal={!!setup?.terminalId}
      onSeeTerminal={handleSeeTerminal}
      onRerun={handleRerun}
      onRetryCreation={handleRetryCreation}
      onBackFromCreation={handleBackFromCreation}
    />
  );
}

/**
 * Connected workspace-creation receipt. Derives everything from the current
 * selection (pending entry, workspace record, setup-status query); renders
 * nothing when the selection carries no receipt. Keyed by receipt identity so
 * rerun/expansion state resets across creations.
 */
export function WorkspaceCreationReceipt({
  pendingOnly = false,
}: {
  /**
   * Pre-message canvas mounts set this: before a transcript exists the
   * receipt may only surface in-flight creation progress and failures.
   * The settled "created" receipt belongs to the transcript flow — it
   * renders inside the first turn's work group, never pinned above the
   * canvas.
   */
  pendingOnly?: boolean;
} = {}) {
  const state = useWorkspaceCreationReceiptState();
  if (!state) {
    return null;
  }
  if (pendingOnly && !state.pendingEntry) {
    return null;
  }
  return <ConnectedWorkspaceCreationReceipt key={state.receiptKey} state={state} />;
}
