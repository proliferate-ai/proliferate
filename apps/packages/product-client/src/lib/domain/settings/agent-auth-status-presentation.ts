import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";

/**
 * PRESENTATION of the runtime's status document (agent_auth spec §2) — words,
 * tone, and an age string, nothing else.
 *
 * There is no derivation here and there must never be one. Every function below
 * takes the document's own fields — `probe`, `applied`, and the `native` method
 * row's `detected` — and answers a rendering question about them; none of them
 * reads `readiness`, `credentialState`, `cliAuthState`, install state, or a
 * query's loading flag, and none of them invents a state the runtime does not
 * hold. `agent-auth-evidence.ts` — which projected a client-side derivation —
 * is deleted, and FE-PATHS-1 keeps it deleted.
 */

export type AuthStatusTone = "success" | "warning" | "destructive" | "neutral";

/** The document fields presentation reads. Structural: the hook's return fits. */
export interface HarnessStatusFacts {
  applied: { kind: string; seat_id?: string | null } | null;
  /** The last observation. Null ONLY when the runtime holds no document. */
  probe: { verdict: string; at?: string | null; stale: boolean } | null;
  /**
   * The `native` method row's `detected` — the document's own statement that a
   * working native login exists on this machine. Optional because not every
   * caller holds the method rows; absent reads as "not stated", never as a
   * deficiency. Founder-ruled 2026-08-27: native is a PERMANENT supported
   * method, and this fact is what words a green, nothing-applied harness as
   * "Using your own login".
   */
  nativeDetected?: boolean;
}

/**
 * The two green terminals need DATED evidence (spec §3 flow 4: "green needs
 * dated evidence"). A `verified` verdict with no `at` is not evidence of a
 * moment, so it is not green — the badge never fakes freshness it does not
 * hold. Staleness does NOT withdraw green: a pending re-probe dims the light,
 * it never turns it off, and a launch the document can satisfy is not gated on
 * the probe.
 */
export function isStatusGreen(status: HarnessStatusFacts): boolean {
  return status.probe?.verdict === "verified" && Boolean(status.probe.at);
}

export function statusTone(status: HarnessStatusFacts): AuthStatusTone {
  const probe = status.probe;
  // No document: an unknown state renders neutrally and gates nothing.
  if (probe === null) return "neutral";
  if (isStatusGreen(status)) return "success";
  switch (probe.verdict) {
    case "failed":
      return "destructive";
    case "verified":
    case "unverified":
      // Nothing observed yet. Warning once a method is applied (the runtime owes
      // this harness an observation); neutral when nothing is configured, which
      // is not a fault.
      return status.applied === null ? "neutral" : "warning";
    default:
      // Forward-compat: an unknown verdict from a newer runtime is NEVER green.
      // A reviewer must hold this arm neutral if the vocabulary grows.
      return "neutral";
  }
}

export function statusLabel(status: HarnessStatusFacts): string {
  const probe = status.probe;
  if (probe === null) return HARNESS_PANE_COPY.authBadgeWaitingStatus;
  if (isStatusGreen(status)) {
    // Founder-ruled 2026-08-27: native is a PERMANENT supported method. A green
    // observation with nothing routed applied and a detected native login is a
    // healthy terminal state named in its own words — never "Not configured",
    // never a nag toward a managed method.
    return status.applied === null && status.nativeDetected === true
      ? HARNESS_PANE_COPY.authBadgeUsingOwnLogin
      : HARNESS_PANE_COPY.authBadgeAuthenticated;
  }
  switch (probe.verdict) {
    case "failed":
      return HARNESS_PANE_COPY.authBadgeNotAuthenticated;
    case "verified":
    case "unverified":
      // "Not configured" is the NON-green nothing-applied case only — nothing
      // routed AND no verified observation. A working native login never reads
      // it: its green probe takes the arm above (ruled 2026-08-27).
      return status.applied === null
        ? HARNESS_PANE_COPY.authBadgeNotConfigured
        : HARNESS_PANE_COPY.authBadgeNotVerified;
    default:
      return HARNESS_PANE_COPY.authBadgeWaitingStatus;
  }
}

/** Coarse relative age ("2m", "3h", "5d") from a whole-second count. */
export function formatEvidenceAge(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * The evidence line on a green badge, e.g. "verified 2m ago" — the age that
 * makes green mean something. It speaks for the green NON-stale case only
 * (founder-ruled 2026-08-27, backoff display): while a re-probe runs the
 * observation's age belongs to the stale marker ("last checked <age> ago —
 * retrying"), so stating it here too would print the same age twice. Null when
 * the status is not green, the document is stale, or the observation carries no
 * parseable timestamp.
 */
export function statusEvidenceLine(
  status: HarnessStatusFacts,
  now: number = Date.now(),
): string | null {
  if (!isStatusGreen(status)) return null;
  if (status.probe?.stale === true) return null;
  const at = status.probe?.at;
  if (!at) return null;
  const observedAt = Date.parse(at);
  if (Number.isNaN(observedAt)) return null;
  return HARNESS_PANE_COPY.authEvidenceVerifiedAgo(
    formatEvidenceAge((now - observedAt) / 1000),
  );
}

/**
 * The stale marker (spec §4 cell 4: "a stale status renders as stale, not as
 * loading" — the last observation stays visible while the runtime re-probes).
 *
 * Founder-ruled 2026-08-27 (backoff display): WITH an observation the marker is
 * "last checked <age> ago — retrying" — the age from `probe.at` via the one age
 * formatter, no countdown, no next-attempt wire field, no timer. With NOTHING
 * observed (or no parseable timestamp) there is no age to state honestly, so
 * the marker stays the plain "re-checking". Null when the document is not
 * stale.
 */
export function statusRecheckingMarker(
  status: HarnessStatusFacts,
  now: number = Date.now(),
): string | null {
  const probe = status.probe;
  if (probe?.stale !== true) return null;
  const observedAt = probe.at ? Date.parse(probe.at) : Number.NaN;
  if (Number.isNaN(observedAt)) return HARNESS_PANE_COPY.authBadgeRechecking;
  return HARNESS_PANE_COPY.authStaleLastChecked(
    formatEvidenceAge((now - observedAt) / 1000),
  );
}
