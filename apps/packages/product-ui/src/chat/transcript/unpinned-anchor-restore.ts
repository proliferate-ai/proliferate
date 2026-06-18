// Decides how to restore the user's read position when an unpinned transcript
// changes composition around the anchored (first-visible) row. The restore math
// itself lives in VirtualizedTranscriptRowList; this is the pure branch picker so
// the above/below/same-index distinction can be unit-tested without a layout
// engine (jsdom does no layout, so the virtualizer surfaces no virtual items).

export interface UnpinnedAnchorChange {
  // Index of the anchored row when its scroll position was captured.
  capturedRowIndex: number;
  // Index of the same anchored row (matched by key) after the change.
  nextRowIndex: number;
}

export type UnpinnedAnchorRestoreAction =
  // Rows were inserted/removed ABOVE the viewport, so the anchor shifted. Hold
  // it with the measured scrollHeight delta (immune to estimate error on the
  // changed, still-unmeasured rows).
  | { kind: "measured-delta" }
  // The anchor index is unchanged, so nothing changed above it: the change is at
  // the anchor row itself or strictly below the viewport. Re-anchor to the
  // (measured) row top plus the captured intra-row offset, which holds the
  // anchor row at the same viewport y and no-ops for purely-below changes.
  | { kind: "measured-offset" };

// nextRowIndex < 0 means the anchored row vanished; callers should bail before
// reaching here. This picker only distinguishes the above-change (shifted index)
// case from the same-index (at/below) case.
export function resolveUnpinnedAnchorRestore(
  change: UnpinnedAnchorChange,
): UnpinnedAnchorRestoreAction {
  if (change.nextRowIndex !== change.capturedRowIndex) {
    return { kind: "measured-delta" };
  }
  return { kind: "measured-offset" };
}
