import { useLayoutEffect, useRef } from "react";

export interface UseTranscriptSubmitStampRepinOptions {
  /**
   * Epoch ms of the newest prompt submission (outbox enqueue or session-level
   * optimistic prompt). A monotonic increase re-pins: sending is an explicit
   * return-to-bottom intent. Entries leaving the outbox (delivery, dismissal)
   * can only lower the stamp and must not re-pin.
   */
  lastPromptSubmittedAtMs: number | null | undefined;
  /**
   * Identity of the session/workspace currently mounted (e.g.
   * `${workspaceId}:${sessionId}`). The row lists never remount across a
   * session switch, so `lastPromptSubmittedAtMs` alone can't distinguish "a
   * fresh submit in this session" from "the incoming session's own current
   * stamp, carried over from a stale prior comparison." A change here
   * re-baselines the submit-stamp tracking to the incoming session's current
   * value instead of comparing across the switch.
   */
  sessionKey: string | undefined;
  setPinned: (pinned: boolean) => void;
  scrollToBottom: () => void;
  beginGlue: () => void;
}

/**
 * A prompt submit is an explicit return-to-bottom intent: re-pin even when
 * the pin was silently lost earlier (so the sent bubble can never render
 * clipped behind the dock), snap, and glue across the composer-collapse /
 * row-measurement settle so the multi-frame geometry change lands as one
 * silent jump, exactly like session re-entry. Unlike the scroll-to-bottom
 * button, a submit does NOT consume the manual-only overlay range: the
 * follow target stays the soft bottom above any dock-slot card, so the
 * stream never slides under it (a range the user already consumed stays
 * consumed until they scroll away). Must be registered after the inset
 * effect in `useTranscriptStickToBottom` but before consumer layout effects,
 * so their pinned snaps read the restored pin. Only a monotonic increase of
 * the submission stamp qualifies — see the option's contract.
 *
 * PRO-175: the row lists never remount on a session switch, so this ref
 * would otherwise carry the PREVIOUS session's stamp across the switch. A
 * revisited session's own (unrelated, possibly old) stamp then looks like a
 * fresh increase and fires a spurious re-pin/snap/glue with zero new
 * content. `sessionKey` scopes the comparison to session identity: a
 * session-boundary crossing re-baselines the ref to the incoming session's
 * CURRENT stamp (not null — nulling it would make the very next run see
 * previous == null and misfire through the other door) and skips the
 * compare for that render. `resetForSession` still unconditionally
 * pins/snaps/glues on every switch by design; this only removes the SECOND,
 * redundant re-pin the stale stamp used to trigger alongside it.
 */
export function useTranscriptSubmitStampRepin({
  lastPromptSubmittedAtMs = null,
  sessionKey,
  setPinned,
  scrollToBottom,
  beginGlue,
}: UseTranscriptSubmitStampRepinOptions): void {
  const lastPromptSubmittedAtRef = useRef(lastPromptSubmittedAtMs);
  const sessionKeyRef = useRef(sessionKey);
  useLayoutEffect(() => {
    const previousSessionKey = sessionKeyRef.current;
    sessionKeyRef.current = sessionKey;
    const previous = lastPromptSubmittedAtRef.current;
    lastPromptSubmittedAtRef.current = lastPromptSubmittedAtMs;
    if (previousSessionKey !== undefined && previousSessionKey !== sessionKey) {
      // Session boundary: the ref above is now the new baseline. Do not
      // compare against the outgoing session's stamp.
      return;
    }
    if (
      lastPromptSubmittedAtMs != null
      && (previous == null || lastPromptSubmittedAtMs > previous)
    ) {
      setPinned(true);
      scrollToBottom();
      beginGlue();
    }
  }, [beginGlue, lastPromptSubmittedAtMs, scrollToBottom, sessionKey, setPinned]);
}
