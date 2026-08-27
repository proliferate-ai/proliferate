import type { HarnessStatus } from "#product/hooks/access/anyharness/agent-auth/use-harness-status";

/**
 * Status-document fixtures for the pane suites (agent_auth spec §2).
 *
 * The panes render the document verbatim, so a suite that wants a badge state
 * states the DOCUMENT rather than the derived words — there is no derivation
 * left to drive from readiness, credentialState, or cliAuthState.
 */
export function harnessStatusFixture(
  overrides: Partial<HarnessStatus> = {},
): HarnessStatus {
  return {
    methods: [],
    // Nothing applied and nothing observed: the honest default for a pane whose
    // harness has no auth wired yet.
    applied: null,
    nextSeatId: null,
    rotate: true,
    probe: { verdict: "unverified", at: null, stale: false },
    coolingUntil: null,
    unknown: false,
    loading: false,
    refresh: () => {},
    ...overrides,
  };
}

/** A dated, verified observation — the only shape that renders green. */
export function verifiedHarnessStatus(
  overrides: Partial<HarnessStatus> = {},
): HarnessStatus {
  return harnessStatusFixture({
    applied: { kind: "seat", seat_id: "seat-1" },
    probe: { verdict: "verified", at: "2026-08-27T00:00:00Z", stale: false },
    ...overrides,
  });
}
