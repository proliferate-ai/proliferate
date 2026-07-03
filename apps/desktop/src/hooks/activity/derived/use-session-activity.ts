import type { LoopCapabilities, LoopWire } from "@proliferate/product-domain/activity/loop";
import type { ActivityProcessWire } from "@proliferate/product-domain/activity/process";
import type { ActivitySubagentWire } from "@proliferate/product-domain/activity/subagent";
import { resolveActivityFixture } from "@/lib/domain/chat/__fixtures__/playground/activity-fixtures";

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
 * STUB — fixture-backed until the runtime's `SessionActivity` mirror is live
 * on the wire (goals-b/02-runtime lands the observer/reconcile/write path,
 * the sidecar forks emit the tagged chunks, and the SDK is regenerated
 * against the new contract). Mirrors exactly the pattern `use-session-goal`
 * started from: production always reads empty rosters until the integration
 * pass swaps this for a live read off `SessionView.activity` keyed by the
 * active session id; dev builds render
 * `VITE_PROLIFERATE_ACTIVITY_FIXTURE=<key>` fixtures (keys in
 * lib/domain/chat/__fixtures__/playground/activity-fixtures.ts).
 */
export function useSessionActivity(): SessionActivityState {
  if (!import.meta.env.DEV) {
    return EMPTY_ACTIVITY;
  }
  const fixture = resolveActivityFixture(import.meta.env.VITE_PROLIFERATE_ACTIVITY_FIXTURE);
  return fixture ?? EMPTY_ACTIVITY;
}
