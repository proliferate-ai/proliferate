// Per-row-key measured-height persistence across remounts of the SAME
// session (Chat Scroll rung 5, PRO-187). A real TanStack measurement is
// exact; a composition estimate (transcript-row-height-estimate.ts) is only
// ever a guess. Once a row has been measured for real this session, the
// virtualizer should consult that measurement instead of re-guessing on
// every remount (tab switch, list virtualization mode toggle, etc.) within
// the same session. This is NOT the rung 6 restore contract: nothing here
// survives a reload or a different session, and there is no localStorage —
// module-level state only, bounded, same house pattern as
// assistant-reveal-progress.ts.
//
// Bounds: a small in-memory LRU per session (cap 500 rows, matching
// assistant-reveal-progress.ts's per-cache cap) so a very long-lived session
// with thousands of rows can't grow this unboundedly. Sessions themselves are
// not capped — the working set of concurrently open sessions in one runtime
// is small, and each session's own row map is what's bounded.
//
// Invalidation: each entry carries the row's composition token (see
// getRowCompositionToken) captured at measurement time. A lookup whose
// current composition token doesn't match the stored one is treated as a
// miss (and the stale entry is dropped) rather than served — this is what
// keeps a row whose content changed shape (e.g. a tool ledger goes from
// collapsed to expanded, or streaming text replaces a placeholder) from
// pinning the OLD, now-wrong measured height.
const MAX_CACHED_ROW_HEIGHTS_PER_SESSION = 500;

interface MeasuredRowHeightEntry {
  px: number;
  compositionToken: unknown;
}

const measuredHeightsBySession = new Map<string, Map<string, MeasuredRowHeightEntry>>();

export function getMeasuredRowHeight(
  sessionKey: string,
  rowKey: string,
  compositionToken: unknown,
): number | null {
  const sessionMap = measuredHeightsBySession.get(sessionKey);
  if (!sessionMap) {
    return null;
  }
  const entry = sessionMap.get(rowKey);
  if (!entry) {
    return null;
  }
  if (entry.compositionToken !== compositionToken) {
    sessionMap.delete(rowKey);
    return null;
  }
  return entry.px;
}

export function recordMeasuredRowHeight(
  sessionKey: string,
  rowKey: string,
  px: number,
  compositionToken: unknown,
): void {
  if (!Number.isFinite(px) || px <= 0) {
    return;
  }
  let sessionMap = measuredHeightsBySession.get(sessionKey);
  if (!sessionMap) {
    sessionMap = new Map();
    measuredHeightsBySession.set(sessionKey, sessionMap);
  }
  // Refresh insertion order so the bounded map behaves as a tiny LRU, same as
  // assistant-reveal-progress.ts.
  sessionMap.delete(rowKey);
  sessionMap.set(rowKey, { px, compositionToken });
  while (sessionMap.size > MAX_CACHED_ROW_HEIGHTS_PER_SESSION) {
    const oldestRowKey = sessionMap.keys().next().value;
    if (typeof oldestRowKey !== "string") {
      break;
    }
    sessionMap.delete(oldestRowKey);
  }
}

export function clearMeasuredRowHeightsForTests(): void {
  measuredHeightsBySession.clear();
}
