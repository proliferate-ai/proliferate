const CHAT_ROW_ID_PREFIX = "chatrow:";

export interface ChatRowMatchTarget {
  rowUnitId: string;
  ordinal: number;
}

/**
 * Parses a chat-row content-search match id (`chatrow:<rowKey>:<ordinal>`)
 * into its row unit id and match ordinal. Row keys themselves contain colons
 * (`turn:<id>:block:<key>`), so only the trailing numeric segment is the
 * ordinal. Returns null for ids from other surfaces (diff/file marks).
 */
export function parseChatRowMatchId(matchId: string | null): ChatRowMatchTarget | null {
  if (!matchId || !matchId.startsWith(CHAT_ROW_ID_PREFIX)) {
    return null;
  }
  const lastColon = matchId.lastIndexOf(":");
  if (lastColon <= CHAT_ROW_ID_PREFIX.length - 1) {
    return null;
  }
  const ordinal = Number(matchId.slice(lastColon + 1));
  if (!Number.isInteger(ordinal) || ordinal < 0) {
    return null;
  }
  return { rowUnitId: matchId.slice(0, lastColon), ordinal };
}

export function chatRowKeyFromUnitId(rowUnitId: string): string {
  return rowUnitId.startsWith(CHAT_ROW_ID_PREFIX)
    ? rowUnitId.slice(CHAT_ROW_ID_PREFIX.length)
    : rowUnitId;
}

/**
 * Marks the active chat-row match in the DOM and scrolls it into view. The
 * painted marks (document order guaranteed by querySelectorAll) are selected by
 * ordinal, clamped to the last painted mark when fewer are painted than the
 * data index counted (a benign extraction/render mismatch). Only chat-row marks
 * are touched — diff/file marks manage their active class through React.
 * Returns true once a mark was activated.
 */
export function scrollActiveChatRowMatchIntoView(target: ChatRowMatchTarget): boolean {
  const selector = `mark[data-content-search-row="${cssEscape(target.rowUnitId)}"]`;
  const marks = document.querySelectorAll<HTMLElement>(selector);
  if (marks.length === 0) {
    return false;
  }

  for (const active of document.querySelectorAll<HTMLElement>(
    "mark[data-content-search-row].codex-thread-find-active",
  )) {
    active.classList.remove("codex-thread-find-active");
  }

  const index = Math.min(target.ordinal, marks.length - 1);
  const mark = marks[index];
  mark.classList.add("codex-thread-find-active");
  mark.scrollIntoView({ block: "center", inline: "nearest" });
  return true;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}
