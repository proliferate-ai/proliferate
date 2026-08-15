import type { UsageState } from "@anyharness/sdk";
import { useActiveSessionId } from "#product/hooks/chat/derived/use-active-session-identity";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

/**
 * The active session's live context-usage snapshot — mirrored from the
 * transcript reducer's `usageState` (reducer/transcript.ts), set on every
 * `usage_update` event on both the live-stream and cold-load hydration paths.
 * `null` before the first event arrives and for harnesses that never emit
 * usage (cursor, grok).
 */
export function useActiveSessionUsage(): UsageState | null {
  const activeSessionId = useActiveSessionId();
  return useSessionTranscriptStore((state) =>
    activeSessionId ? state.entriesById[activeSessionId]?.transcript.usageState ?? null : null
  );
}
