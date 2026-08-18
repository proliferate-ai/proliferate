// Pure presentation resolvers for TranscriptTurnRow: which completion chrome
// a turn row shows (footer, frontier-status box, diff panel, end resource,
// stopped notice). Kept out of the component so the anchor-invariant rules
// stay unit-testable without mounting the row.

export function shouldRenderAssistantEndResource({
  rowIsLastTurnRow,
  visualTurnCompleted,
  hasResource,
}: {
  rowIsLastTurnRow: boolean;
  visualTurnCompleted: boolean;
  hasResource: boolean;
}): boolean {
  return rowIsLastTurnRow && visualTurnCompleted && hasResource;
}

export function resolveTurnAssistantFooterMode({
  rowIsLastTurnRow,
  turnCompleted,
  hasAssistantCopyContent,
  assistantRevealComplete,
}: {
  rowIsLastTurnRow: boolean;
  turnCompleted: boolean;
  hasAssistantCopyContent: boolean;
  assistantRevealComplete: boolean;
}): "none" | "reserved" | "copy" {
  if (!rowIsLastTurnRow) {
    return "none";
  }
  if (turnCompleted && hasAssistantCopyContent && assistantRevealComplete) {
    return "copy";
  }
  return "reserved";
}

/**
 * The frontier-status box stays mounted at fixed height ("reserved") for the
 * whole live turn even while its content is hidden: "Thinking" yields to tool
 * shimmers and returns between commands, and mounting/unmounting the box
 * moved the transcript bottom by the slot + column gap every time. During an
 * assistant prose reveal the streaming answer owns the frontier, so the box
 * hides entirely — same single settle as before.
 *
 * The empty reserve is keyed on genuine stream liveness (`turnIsActivelyStreaming`,
 * from the session view state), NOT on the turn-completion stamp. The runtime
 * drops the completion tail for injected background-work wake turns (defect D3),
 * so `isLatestTurnInProgress` (`isLatestTurn && !turn.completedAt`) stays true
 * forever in the live view and would otherwise leave a dead ~44-56px reserve
 * band between the settled wake prose and its timestamp footer. Mirrors the
 * round-4 footer fix: an idle session with a dropped-tail latest turn resolves
 * "hidden". A genuine trailing status still wins ("status") whenever present, so
 * a permission pause (needs_input) that carries an interaction indicator is
 * unaffected; a needs_input turn with no trailing status resolves "hidden"
 * rather than a dead reserve, staying coherent with the footer, which treats
 * the same non-"working" turn as settled/copyable.
 */
export function resolveTurnFrontierStatusMode({
  hasTrailingStatus,
  rowIsLastTurnRow,
  isLatestTurnInProgress,
  turnIsActivelyStreaming,
  assistantRevealComplete,
}: {
  hasTrailingStatus: boolean;
  rowIsLastTurnRow: boolean;
  isLatestTurnInProgress: boolean;
  turnIsActivelyStreaming: boolean;
  assistantRevealComplete: boolean;
}): "status" | "reserved" | "hidden" {
  if (!assistantRevealComplete) {
    return "hidden";
  }
  if (hasTrailingStatus) {
    return "status";
  }
  return rowIsLastTurnRow && isLatestTurnInProgress && turnIsActivelyStreaming
    ? "reserved"
    : "hidden";
}

export function shouldRenderStandaloneStoppedNotice(
  stoppedNotice: string | null,
  hasCompletedHistoryDisclosure: boolean,
): boolean {
  return stoppedNotice !== null && !hasCompletedHistoryDisclosure;
}

export function resolveTranscriptTurnDiffPanelKind({
  rowIsLastTurnRow,
  turnCompleted,
  turnId,
  latestCompletedTurnId,
  hasFileBadges,
}: {
  rowIsLastTurnRow: boolean;
  turnCompleted: boolean;
  turnId: string;
  latestCompletedTurnId: string | null;
  hasFileBadges: boolean;
}): "current" | "transcript" | null {
  if (!rowIsLastTurnRow || !turnCompleted || !hasFileBadges) {
    return null;
  }
  return turnId === latestCompletedTurnId ? "current" : "transcript";
}
