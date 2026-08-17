import type { TurnDisplayBlock } from "#product/domain/chats/transcript/transcript-presentation";
import type { TranscriptRenderableRow } from "#product/hooks/chat/ui/transcript-row-list-model";

// Composition-derived virtualizer estimates (Chat Scroll rung 5, PRO-187).
//
// The virtualizer's `estimateSize` fallback used to be one flat number
// (360px) for every non-special-cased row, regardless of whether the row
// held a single short message or a sprawling collapsed tool ledger. That
// flat guess is what produces the worst "estimate bounce": a real measured
// height that differs from the estimate by hundreds of pixels forces a large
// corrective scrollTop jump the instant the row mounts and TanStack measures
// it for real.
//
// This module buckets a row's estimate from its COMPOSITION — item count and
// item kinds on the row's rendered display blocks — not from actual prose
// text length. The virtual-row abstraction the measurement model sees
// (`TranscriptRenderableRow` / `TurnDisplayBlock`) carries item IDENTITIES,
// not item CONTENT (no `text` field), so a literal character-count bucket
// would require threading full `TranscriptState` through the measurement
// model — a materially larger change out of this rung's scope. Bucketing on
// block/item counts is the honest coarse proxy available at this layer; see
// the per-bucket rationale below. None of this changes actual rendered
// height, only the virtualizer's up-front guess before real measurement (and
// rung 5's persisted-measurement cache, see transcript-row-height-cache.ts,
// supersedes the guess for any row this session has already measured for
// real).
//
// Buckets (px), rationale:
//   - history_loader / goal_event: unchanged special cases (32 / 28), kept
//     as their own composition classes per the frozen spec.
//   - empty/undefined row (virtualizer padding probe): the old flat default.
//   - single plain block (one user message, one assistant reply, one
//     thought, etc.): a short turn, ~1-3 lines of prose plus row chrome.
//   - 2-3 plain blocks: a turn with a short back-and-forth of item rows
//     (e.g. message + inline tool + message) - roughly double.
//   - 4+ plain blocks: reverts to the old flat estimate — this is the
//     "long unsplit turn" shape the original constant was tuned for.
//   - inline_tool / inline_tools block: one or a few tool calls rendered
//     inline (not collapsed) - each is a compact single-line-ish row.
//   - collapsed_actions block: a COLLAPSED tool ledger disclosure. Bucketed
//     by grouped item count since the disclosure header height barely
//     grows with count when collapsed, but a wider spread still nets a
//     taller closed summary (multiple lines of "N tool calls" style text).
//   - subagent_creations block: a subagent group card, taller per entry
//     than a tool ledger entry (it renders a name + status per subagent).
//   - completed-history block (chunked overflow turn): a compact single
//     disclosure summary row regardless of how many original blocks it
//     folds, so it gets its own small constant.
const ESTIMATED_TURN_HEIGHT_PX = 360;
const ESTIMATED_HISTORY_LOADING_ROW_HEIGHT_PX = 32;
const ESTIMATED_GOAL_EVENT_ROW_HEIGHT_PX = 28;

const ESTIMATED_SINGLE_BLOCK_TURN_HEIGHT_PX = 120;
const ESTIMATED_SHORT_MULTI_BLOCK_TURN_HEIGHT_PX = 220;

const ESTIMATED_INLINE_TOOL_BLOCK_HEIGHT_PX = 56;

const ESTIMATED_COLLAPSED_ACTIONS_SMALL_HEIGHT_PX = 56;
const ESTIMATED_COLLAPSED_ACTIONS_MEDIUM_HEIGHT_PX = 88;
const ESTIMATED_COLLAPSED_ACTIONS_LARGE_HEIGHT_PX = 120;

const ESTIMATED_SUBAGENT_GROUP_SMALL_HEIGHT_PX = 72;
const ESTIMATED_SUBAGENT_GROUP_LARGE_HEIGHT_PX = 96;

const ESTIMATED_COMPLETED_HISTORY_SUMMARY_HEIGHT_PX = 44;

const TURN_COMPLETED_HISTORY_BLOCK_KEY = "completed-history";

function estimateCollapsedActionsBlockHeight(itemCount: number): number {
  if (itemCount <= 3) {
    return ESTIMATED_COLLAPSED_ACTIONS_SMALL_HEIGHT_PX;
  }
  if (itemCount <= 8) {
    return ESTIMATED_COLLAPSED_ACTIONS_MEDIUM_HEIGHT_PX;
  }
  return ESTIMATED_COLLAPSED_ACTIONS_LARGE_HEIGHT_PX;
}

function estimateSubagentCreationsBlockHeight(itemCount: number): number {
  return itemCount <= 2
    ? ESTIMATED_SUBAGENT_GROUP_SMALL_HEIGHT_PX
    : ESTIMATED_SUBAGENT_GROUP_LARGE_HEIGHT_PX;
}

function estimateDisplayBlockHeight(block: TurnDisplayBlock): number {
  switch (block.kind) {
    case "collapsed_actions":
      return estimateCollapsedActionsBlockHeight(block.itemIds.length);
    case "subagent_creations":
      return estimateSubagentCreationsBlockHeight(block.itemIds.length);
    case "inline_tools":
      return ESTIMATED_INLINE_TOOL_BLOCK_HEIGHT_PX * Math.max(1, block.itemIds.length);
    case "inline_tool":
      return ESTIMATED_INLINE_TOOL_BLOCK_HEIGHT_PX;
    case "item":
      return ESTIMATED_SINGLE_BLOCK_TURN_HEIGHT_PX;
    default:
      return ESTIMATED_SINGLE_BLOCK_TURN_HEIGHT_PX;
  }
}

function estimateTurnRowHeight(
  blockKey: string,
  displayBlocks: readonly TurnDisplayBlock[],
): number {
  if (blockKey === TURN_COMPLETED_HISTORY_BLOCK_KEY) {
    return ESTIMATED_COMPLETED_HISTORY_SUMMARY_HEIGHT_PX;
  }
  if (displayBlocks.length === 0) {
    return ESTIMATED_SINGLE_BLOCK_TURN_HEIGHT_PX;
  }
  const isAllPlainItemBlocks = displayBlocks.every((block) => block.kind === "item");
  if (isAllPlainItemBlocks) {
    if (displayBlocks.length === 1) {
      return ESTIMATED_SINGLE_BLOCK_TURN_HEIGHT_PX;
    }
    if (displayBlocks.length <= 3) {
      return ESTIMATED_SHORT_MULTI_BLOCK_TURN_HEIGHT_PX;
    }
    return ESTIMATED_TURN_HEIGHT_PX;
  }
  return displayBlocks.reduce((sum, block) => sum + estimateDisplayBlockHeight(block), 0);
}

/**
 * Composition-derived height estimate for a virtualized transcript row.
 * Pure function of the row's shape: item count, item kinds, and (for plain
 * message/prose blocks, where per-item content length isn't visible at this
 * layer) a coarse block-count proxy for prose length. See module doc above
 * for the bucket table and rationale. Consulted by the measurement model
 * ONLY when no persisted real measurement exists for the row's key this
 * session (transcript-row-height-cache.ts).
 */
export function estimateRenderableRowHeight(
  row: TranscriptRenderableRow | undefined,
): number {
  if (row?.kind === "history_loader") {
    return ESTIMATED_HISTORY_LOADING_ROW_HEIGHT_PX;
  }
  if (!row || row.kind !== "transcript") {
    return ESTIMATED_TURN_HEIGHT_PX;
  }
  if (row.row.kind === "goal_event") {
    return ESTIMATED_GOAL_EVENT_ROW_HEIGHT_PX;
  }
  if (row.row.kind === "turn") {
    return estimateTurnRowHeight(row.row.blockKey, row.row.renderPresentation.displayBlocks);
  }
  // pending_prompt / outbox_prompt: a single composer-shaped prompt row.
  return ESTIMATED_SINGLE_BLOCK_TURN_HEIGHT_PX;
}

function collapsedActionsSizeBand(itemCount: number): string {
  if (itemCount <= 3) return "s";
  if (itemCount <= 8) return "m";
  return "l";
}

function turnRowBucketKey(
  blockKey: string,
  displayBlocks: readonly TurnDisplayBlock[],
): string {
  if (blockKey === TURN_COMPLETED_HISTORY_BLOCK_KEY) {
    return "turn:completed_history";
  }
  if (displayBlocks.length === 0) {
    return "turn:empty";
  }
  const isAllPlainItemBlocks = displayBlocks.every((block) => block.kind === "item");
  if (isAllPlainItemBlocks) {
    if (displayBlocks.length === 1) return "turn:plain:1";
    if (displayBlocks.length <= 3) return "turn:plain:2-3";
    return "turn:plain:4+";
  }
  // Mixed / special composition: bucket by the ordered block kinds plus a coarse
  // size band for the count-sensitive kinds, so structurally-identical turns
  // (e.g. every collapsed tool-ledger turn of the same magnitude) share a bucket.
  const signature = displayBlocks
    .map((block) => {
      switch (block.kind) {
        case "collapsed_actions":
          return `collapsed_actions:${collapsedActionsSizeBand(block.itemIds.length)}`;
        case "subagent_creations":
          return `subagent_creations:${block.itemIds.length <= 2 ? "s" : "l"}`;
        case "inline_tools":
          return `inline_tools:${Math.min(block.itemIds.length, 4)}`;
        default:
          return block.kind;
      }
    })
    .join("|");
  return `turn:mixed:${signature}`;
}

/**
 * Stable composition-bucket identifier for a renderable row, aligned with the
 * buckets estimateRenderableRowHeight guesses from. Rows that share a bucket key
 * are estimated identically before measurement, so the per-session calibration
 * (transcript-row-height-calibration.ts) can pool their real measured heights.
 * Returns null for rows whose height is a small fixed constant not worth
 * calibrating (history loader, goal event) or for the out-of-range probe.
 */
export function getRowEstimateBucketKey(
  row: TranscriptRenderableRow | undefined,
): string | null {
  if (!row || row.kind === "history_loader") {
    return null;
  }
  if (row.kind !== "transcript") {
    return null;
  }
  if (row.row.kind === "goal_event") {
    return null;
  }
  if (row.row.kind === "turn") {
    return turnRowBucketKey(row.row.blockKey, row.row.renderPresentation.displayBlocks);
  }
  return "prompt";
}

/**
 * A cheap identity token for a row's COMPOSITION — used to invalidate a
 * persisted measured height when the row's underlying content changes shape
 * (transcript-row-height-cache.ts). For "turn" rows this reuses the same
 * reference stability the turn-row cache
 * (transcript-row-cache-key.ts/isTranscriptTurnRowCacheHit) already
 * guarantees: `renderPresentation` is the SAME object reference across
 * renders whenever the underlying turn/goal/receipt cache key is unchanged,
 * and a NEW object whenever it changes. Other row kinds don't carry a
 * comparably stable content reference at this layer, so their token is a
 * best-effort proxy (adequate here — none of the OTHER kinds are the tall,
 * bounce-prone rows this rung targets).
 */
export function getRowCompositionToken(
  row: TranscriptRenderableRow | undefined,
): unknown {
  if (!row) {
    return undefined;
  }
  if (row.kind === "history_loader") {
    return "history_loader";
  }
  if (row.row.kind === "turn") {
    return row.row.renderPresentation;
  }
  if (row.row.kind === "goal_event") {
    return row.row.event;
  }
  if (row.row.kind === "outbox_prompt") {
    return `outbox:${row.row.clientPromptId}:${row.row.hostsWorkspaceReceipt ?? false}`;
  }
  return `pending:${row.row.hostsWorkspaceReceipt ?? false}`;
}
