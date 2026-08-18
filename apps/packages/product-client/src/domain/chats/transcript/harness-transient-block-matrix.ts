// Q13 / Founder Ruling 3 (Chat Scroll rung 10, PRO-187): the reserved-slot
// invariant ("no live-turn slot may change height as a function of item
// lifecycle, only as a function of revealed content") is enforced at ONE
// normalized layer — the `@anyharness/sdk` TranscriptState item kinds
// (`thought`, `tool_call`, `assistant_prose`, ...) that every harness adapter
// reduces its own wire protocol into (see transcript-trailing-status.ts,
// TranscriptTurnChrome.tsx's ASSISTANT_ACTION_SLOT_HEIGHT). Whether the
// invariant actually holds for a given harness in production therefore
// depends on ONE fact per harness: does its adapter ever normalize a
// mid-turn event into something OTHER than a private `thought` /
// `tool_call` / `assistant_prose` transition — i.e. a new, visible,
// height-bearing item kind the chrome layer does not fold into the reserved
// slot. This module is that static classification, derived from each
// harness's adapter/reducer source (not from the live wire, which is why it
// is "static": it changes only when an adapter's item-kind mapping changes).
//
// Written live-measurement plan (the events an agent captures per harness
// during a REAL streaming session, alongside this static matrix, to confirm
// the classification below against a live transcript — rung 10's other
// deliverable):
//   1. thought start   — first envelope producing a `thought` item for the
//      turn; record itemId, isTransient, and the chrome's rendered slot
//      height immediately after.
//   2. thought delta    — each subsequent `thought` text delta; record the
//      slot height again (must be byte-identical to #1's).
//   3. thought stop     — the envelope that ends the thought (isTransient
//      flips false or the item is superseded); record the slot height once
//      more, then whether the trailing-status label is retained per
//      latestTransientStatusText's "survives the thought's own stream
//      closing" rule.
//   4. tool start/stop  — same three-point height check across a `tool_call`
//      item's lifecycle (mounts collapsed per transcript-collapsed-actions.ts;
//      expand/collapse is user-triggered, out of scope here).
//   5. prose interleave — a `thought` -> `tool_call` -> `assistant_prose`
//      sequence within ONE turn; record the slot height at each transition
//      boundary AND confirm no turn-level row height changed as a side effect
//      (the failure mode this rung targets is a SLOT height change, not a
//      new row's own height, which legitimately grows with content).
// A harness fixture whose live-capture (steps 1-5) disagrees with its static
// row below is a rung-10 regression: either the adapter started emitting a
// new visible item kind, or the chrome layer stopped folding an existing one
// into the reserved slot.

export type HarnessKind = "claude" | "codex" | "opencode" | "grok";

export interface HarnessTransientBlockClass {
  harness: HarnessKind;
  /**
   * Whether this harness's adapter can emit a mid-turn item kind that is
   * NOT one of the three the chrome layer already folds into the reserved
   * ASSISTANT_ACTION_SLOT_HEIGHT slot (`thought`, `tool_call`,
   * `assistant_prose`). True here means the reserved-slot invariant is NOT
   * structurally guaranteed for this harness and needs its own physics
   * fixture beyond the shared one (none currently do).
   */
  emitsUnclassifiedVisibleItemKind: boolean;
  /**
   * Whether reasoning ever arrives as `isTransient: false` (a permanently
   * visible reasoning item, distinct from the private trailing-status label)
   * for this harness. Per the ADR (Cell 6), reasoning items are visibility
   * "private" and surface only as the one-line trailing status; a harness
   * that violates this needs the invariant extended to a new visible row
   * kind, which is exactly the Q13 residual-flicker path the ADR names as
   * unconfirmed pending this matrix.
   */
  emitsPersistentVisibleReasoning: boolean;
  /** One-line rationale citing the adapter source this was derived from. */
  note: string;
}

export const HARNESS_TRANSIENT_BLOCK_MATRIX: readonly HarnessTransientBlockClass[] = [
  {
    harness: "claude",
    emitsUnclassifiedVisibleItemKind: false,
    emitsPersistentVisibleReasoning: false,
    note: "Claude's thinking deltas normalize to `thought` items (isTransient "
      + "true until the block closes); tool use normalizes to `tool_call`. No "
      + "adapter path produces a fourth mid-turn item kind.",
  },
  {
    harness: "codex",
    emitsUnclassifiedVisibleItemKind: false,
    emitsPersistentVisibleReasoning: false,
    note: "Codex reasoning summaries normalize to `thought` the same way; "
      + "function-call events normalize to `tool_call`. Same two-kind surface "
      + "as claude.",
  },
  {
    harness: "opencode",
    emitsUnclassifiedVisibleItemKind: false,
    emitsPersistentVisibleReasoning: false,
    note: "opencode's step/part protocol maps reasoning parts to `thought` "
      + "and tool parts to `tool_call`; no distinct mid-turn visible kind.",
  },
  {
    harness: "grok",
    emitsUnclassifiedVisibleItemKind: false,
    emitsPersistentVisibleReasoning: false,
    note: "grok reasoning normalizes to `thought`; tool calls to `tool_call`. "
      + "Same two-kind surface; no harness-specific chrome path exists.",
  },
];

export function findHarnessTransientBlockClass(
  harness: HarnessKind,
): HarnessTransientBlockClass | undefined {
  return HARNESS_TRANSIENT_BLOCK_MATRIX.find((entry) => entry.harness === harness);
}
