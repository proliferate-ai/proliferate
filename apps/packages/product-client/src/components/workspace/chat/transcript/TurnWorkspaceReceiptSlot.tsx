import type { ReactNode } from "react";
import type { TranscriptState, TurnRecord } from "@anyharness/sdk";
import {
  ToolCallSummary,
} from "#product/components/workspace/chat/tool-calls/ToolCallSummary";
import {
  formatCollapsedSummary,
} from "#product/components/workspace/chat/transcript/TranscriptToolGroupUtils";
import { getTurnDisplayBlockKey } from "#product/components/workspace/chat/transcript/ScopedTranscriptBlocks";
import {
  CompletedHistorySequence,
  resolveCompletedHistoryDisclosureLabel,
  useCompletedHistoryTransition,
} from "#product/components/workspace/chat/transcript/TranscriptTurnChrome";
import type {
  CompletedHistorySummary,
  TurnPresentation,
} from "#product/domain/chats/transcript/transcript-presentation";

/**
 * Where and how a hosted workspace-creation receipt renders within a turn
 * row. TurnItemSequence hosts at most one receipt per turn; it folds inside
 * the turn's real completed-history disclosure when one exists, otherwise it
 * renders at a computed position of its own (see `resolveLeadingNonUserMessageBlockKey`)
 * — bare while streaming, or wrapped in a synthetic "Worked for Ns"
 * disclosure once the turn completes (see `hostsSynthesizedReceiptDisclosure`).
 * This module owns that bookkeeping so TurnItemSequence only has to consult
 * the result.
 */

/**
 * Finds the block key of the first display block that is not a user-message
 * item — the position where an inline workspace-creation receipt should
 * render (immediately before it). Returns null when every block so far is a
 * user message (or there are no blocks yet), meaning the receipt should
 * render after all of them instead.
 */
export function resolveLeadingNonUserMessageBlockKey(
  presentation: TurnPresentation,
  transcript: TranscriptState,
): string | null {
  for (const block of presentation.displayBlocks) {
    if (block.kind === "item" && transcript.itemsById[block.itemId]?.kind === "user_message") {
      continue;
    }
    return getTurnDisplayBlockKey(block);
  }
  return null;
}

/**
 * Whether a workspace-creation receipt must be hosted inside a synthetic
 * "Worked for Ns" disclosure rather than rendered as a bare inline line. This
 * happens exactly when: the row hosts a receipt, the turn has no history of
 * its own to host the real completed-history disclosure, and the turn is
 * completed (so its "Worked for" duration is final). Exported so callers
 * that separately decide whether a real completed-history disclosure exists
 * for this turn (e.g. to avoid double-rendering a "Worked for"/stopped-notice
 * line) can account for the synthetic one too.
 */
export function hostsSynthesizedReceiptDisclosure({
  hasWorkspaceReceipt,
  completedHistorySummary,
  turnCompletedAt,
}: {
  hasWorkspaceReceipt: boolean;
  completedHistorySummary: CompletedHistorySummary | null;
  turnCompletedAt: string | null | undefined;
}): boolean {
  return hasWorkspaceReceipt && completedHistorySummary === null && !!turnCompletedAt;
}

/**
 * Computes the hosted workspace-creation receipt's render position and
 * content for a turn row. Must be called unconditionally by the hosting
 * component on every render (it calls `useCompletedHistoryTransition`
 * internally), matching TurnItemSequence's prior inline behavior.
 */
export function useTurnWorkspaceReceiptSlot({
  workspaceReceipt,
  presentation,
  transcript,
  turn,
  completedHistoryLabel,
  tailAssistantProseRootId,
}: {
  workspaceReceipt: ReactNode;
  presentation: TurnPresentation;
  transcript: TranscriptState;
  turn: Pick<TurnRecord, "startedAt" | "completedAt">;
  completedHistoryLabel?: string | null;
  tailAssistantProseRootId: string | null;
}): {
  inlineWorkspaceReceiptBlockKey: string | null;
  renderInlineWorkspaceReceiptAtEnd: boolean;
  workspaceReceiptSlot: ReactNode;
} {
  const hostsCompletedHistoryDisclosure = !!presentation.completedHistorySummary;
  const showInlineWorkspaceReceipt = !!workspaceReceipt && !hostsCompletedHistoryDisclosure;
  const inlineWorkspaceReceiptBlockKey = showInlineWorkspaceReceipt
    ? resolveLeadingNonUserMessageBlockKey(presentation, transcript)
    : null;
  const renderInlineWorkspaceReceiptAtEnd = showInlineWorkspaceReceipt
    && inlineWorkspaceReceiptBlockKey === null;
  // The receipt IS a tool call: a completed turn with no other history of its
  // own (no completedHistorySummary — e.g. prose-only) must still present as
  // a "Worked for Ns" disclosure, not a bare inline line. Streaming turns
  // (no completedAt yet) keep the plain inline rendering above; they get no
  // synthetic disclosure since the "Worked for" duration isn't final yet.
  const shouldSynthesizeReceiptDisclosure = hostsSynthesizedReceiptDisclosure({
    hasWorkspaceReceipt: showInlineWorkspaceReceipt,
    completedHistorySummary: presentation.completedHistorySummary,
    turnCompletedAt: turn.completedAt,
  });
  const animateReceiptDisclosure = useCompletedHistoryTransition(shouldSynthesizeReceiptDisclosure);
  const workspaceReceiptSlot = shouldSynthesizeReceiptDisclosure
    ? (
      <ToolCallSummary
        label={resolveCompletedHistoryDisclosureLabel(turn, completedHistoryLabel)}
        summary={formatCollapsedSummary({ messages: 0, toolCalls: 1, subagents: 0 })}
        showWorkDivider={tailAssistantProseRootId !== null}
        animateCompletion={animateReceiptDisclosure}
        borderless
        renderChildren={() => (
          <CompletedHistorySequence>{workspaceReceipt}</CompletedHistorySequence>
        )}
      />
    )
    : workspaceReceipt;

  return {
    inlineWorkspaceReceiptBlockKey,
    renderInlineWorkspaceReceiptAtEnd,
    workspaceReceiptSlot,
  };
}
