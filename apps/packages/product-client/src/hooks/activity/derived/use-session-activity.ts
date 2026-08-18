import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { LoopCapabilities, LoopWire } from "#product/domain/activity/loop";
import type { ActivityProcessWire } from "#product/domain/activity/process";
import type { ActivitySubagentWire } from "#product/domain/activity/subagent";
import { resolveActivityFixture } from "#product/lib/domain/chat/__fixtures__/playground/activity-fixtures";
import {
  loopCapabilitiesForSession,
  projectSessionActivity,
} from "#product/lib/domain/sessions/activity-mirror";
import { useActiveSessionId } from "#product/hooks/chat/derived/use-active-session-identity";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";

export interface SessionActivityState {
  loops: LoopWire[];
  loopCapabilities: LoopCapabilities;
  processes: ActivityProcessWire[];
  agents: ActivitySubagentWire[];
}

const EMPTY_ACTIVITY: SessionActivityState = {
  loops: [],
  loopCapabilities: { supported: false, native: false },
  processes: [],
  agents: [],
};

/**
 * The active session's mirrored activity (loops + roster processes/subagents)
 * and loop capability flags, read from the session directory slot. The slot is
 * seeded from `Session.activity` and folded forward by the runtime's
 * loop_upserted/loop_removed/loop_fired/process_upserted/subagent_upserted
 * stream events — confirmed native/mirror state only, never optimistic. In dev
 * builds `VITE_PROLIFERATE_ACTIVITY_FIXTURE=<key>` overrides with a fixture
 * (keys in lib/domain/chat/__fixtures__/playground/activity-fixtures.ts).
 *
 * Thin wrapper over `useSessionActivityForSession` bound to
 * `useActiveSessionId()` — see that function for any caller that needs a
 * SPECIFIC session's slice rather than "whichever session happens to be
 * active right now."
 */
export function useSessionActivity(): SessionActivityState {
  const activeSessionId = useActiveSessionId();
  return useSessionActivityForSession(activeSessionId);
}

/**
 * The SAME mirrored activity as `useSessionActivity`, but for an explicit
 * `sessionId` rather than whatever `useActiveSessionId()` currently reports.
 *
 * This matters for the finish-signal ladder (R5 review round 2 — MAJOR):
 * `useSessionActivity()` is hardwired to the active session, so a caller
 * that passes its OWN `sessionId` prop straight into `useSessionActivity()`
 * silently gets the ACTIVE session's roster instead whenever the two
 * diverge (e.g. a tracker mounted for session A keeps rendering with
 * `sessionId="A"` for one tick after the user has already switched to
 * session B — `useActiveSessionId()` inside `useSessionActivity()` would
 * report B). Every `entriesById[sessionId]` slot in
 * `useSessionDirectoryStore` genuinely exists per session (seeded from that
 * session's own `Session.activity` and folded by ITS OWN stream events), so
 * reading it by explicit id here is a real per-session subscription, not an
 * approximation.
 *
 * The slot's OWN liveness is a separate, honest constraint of the client's
 * hot-session data model (`lib/domain/sessions/hot-session-policy.ts`): a
 * session keeps folding stream deltas while it is the active session, an
 * open tab, or has an in-flight turn — a session with no open tab and no
 * live turn (its foreground turn ended, even though a detached background
 * process/subagent continues) goes cold, and this slot then holds whatever
 * it last knew until that session becomes hot again. That is compatible
 * with ruled D6 (the finish signal is per-session): a cold session's dot
 * only needs to be correct once that session is actually viewed again,
 * which is exactly the moment its slot would resync.
 */
export function useSessionActivityForSession(sessionId: string | null): SessionActivityState {
  const slot = useSessionDirectoryStore(useShallow((state) => {
    const entry = sessionId ? state.entriesById[sessionId] ?? null : null;
    if (!entry) {
      return null;
    }
    return {
      sessionActivity: entry.sessionActivity,
      actionCapabilities: entry.actionCapabilities,
    };
  }));

  return useMemo(() => {
    if (import.meta.env.DEV) {
      const fixture = resolveActivityFixture(import.meta.env.VITE_PROLIFERATE_ACTIVITY_FIXTURE);
      if (fixture) {
        return fixture;
      }
    }
    if (!slot) {
      return EMPTY_ACTIVITY;
    }
    const projected = projectSessionActivity(slot.sessionActivity);
    return {
      loops: projected.loops,
      loopCapabilities: loopCapabilitiesForSession(slot.actionCapabilities),
      processes: projected.processes,
      agents: projected.agents,
    };
  }, [slot]);
}
