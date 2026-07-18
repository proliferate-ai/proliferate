export const STREAM_FLUSH_MS = 16;
export const STREAM_REVEAL_COMMIT_INTERVAL_MS = 32;
export const STREAM_REVEAL_IDLE_MS = 240;
export const STREAM_REVEAL_FADE_MS = 320;
export const STREAM_REVEAL_HANDOFF_DELAY_MS = 160;
export const STREAM_REVEAL_SETTLE_MS =
  STREAM_REVEAL_FADE_MS + STREAM_REVEAL_HANDOFF_DELAY_MS;
export const MAX_STREAM_REVEAL_CHARACTERS_PER_SECOND = 360;

export type AssistantMessageRevealPhase = "idle" | "active" | "settling";

export interface AssistantMessageRevealState {
  complete: boolean;
  phase: AssistantMessageRevealPhase;
  visibleLength: number;
  targetLength: number;
  isStreaming: boolean;
}

export function splitAssistantContent(content: string): {
  stableContent: string;
  liveContent: string;
  animateLiveContent: boolean;
} {
  if (!content) {
    return { stableContent: "", liveContent: "", animateLiveContent: false };
  }

  // Keep the high-frequency Markdown parse bounded to the active paragraph.
  const structuredTail = hasOpenCodeFence(content) || hasTrailingTable(content);
  const boundary = findStableBoundary(content);
  if (boundary < 0 || boundary + 2 >= content.length) {
    return {
      stableContent: "",
      liveContent: content,
      animateLiveContent: !structuredTail,
    };
  }

  return {
    stableContent: content.slice(0, boundary + 2),
    liveContent: content.slice(boundary + 2),
    animateLiveContent: !structuredTail,
  };
}

export function selectVisibleTarget(
  content: string,
  currentLength: number,
  maximumCharacters = 1,
): string {
  if (content.length <= currentLength) return content;
  return content.slice(
    0,
    Math.min(content.length, currentLength + Math.max(1, maximumCharacters)),
  );
}

export function findCommonPrefixLength(left: string, right: string): number {
  const maximumLength = Math.min(left.length, right.length);
  let index = 0;
  while (index < maximumLength && left[index] === right[index]) index += 1;
  return index;
}

export function initialVisibleContent(
  content: string,
  animateReveal: boolean,
  initialVisibleLength = 0,
): string {
  if (!animateReveal) return content;
  return content.slice(
    0,
    Math.max(0, Math.min(content.length, initialVisibleLength)),
  );
}

// A split boundary inside an open code fence breaks Markdown in both halves.
function findStableBoundary(content: string): number {
  let boundary = content.lastIndexOf("\n\n");
  while (boundary >= 0) {
    if (!hasOpenCodeFence(content.slice(0, boundary + 2))) return boundary;
    boundary = content.lastIndexOf("\n\n", boundary - 1);
  }
  return -1;
}

function hasOpenCodeFence(content: string): boolean {
  return (content.match(/```/g)?.length ?? 0) % 2 === 1;
}

function hasTrailingTable(content: string): boolean {
  const lines = content.trimEnd().split("\n");
  if (lines.length < 2) return false;
  return lines.slice(-3).filter((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("|") && trimmed.endsWith("|");
  }).length >= 2;
}
