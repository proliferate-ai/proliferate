import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { LoopCapabilities, LoopWire } from "@proliferate/product-domain/activity/loop";
import type { ActivityProcessWire } from "@proliferate/product-domain/activity/process";
import type { ActivitySubagentWire } from "@proliferate/product-domain/activity/subagent";
import { resolveActivityFixture } from "@/lib/domain/chat/__fixtures__/playground/activity-fixtures";
import {
  loopCapabilitiesForSession,
  projectSessionActivity,
} from "@/lib/domain/sessions/activity-mirror";
import { useActiveSessionId } from "@/hooks/chat/derived/use-active-session-identity";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";

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
 */
export function useSessionActivity(): SessionActivityState {
  const activeSessionId = useActiveSessionId();
  const slot = useSessionDirectoryStore(useShallow((state) => {
    const entry = activeSessionId ? state.entriesById[activeSessionId] ?? null : null;
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
