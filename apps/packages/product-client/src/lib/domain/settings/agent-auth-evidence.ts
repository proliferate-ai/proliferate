import type { AgentSummary } from "@anyharness/sdk";

// Presentation of the runtime's DERIVED agent-auth state (agent-auth.md "The
// canonical evidence model"). Everything here is a projection of the already
// derived `AgentSummary.authState` — no fact is re-folded, no fallback ladder
// is consulted. The runtime owns the derivation; the UI only names it.

export type AgentAuthState = NonNullable<AgentSummary["authState"]>;
export type AgentAuthDisplay = AgentAuthState["display"];
export type AgentAuthNextAction = AgentAuthState["nextAction"];
export type AgentAuthHandoff = NonNullable<
  NonNullable<AgentAuthState["facts"]>["handoff"]
>;
export type AgentAuthProbeLifecycle = NonNullable<
  AgentAuthState["facts"]
>["probe"];

/**
 * The two green terminals. Reachable ONLY on dated evidence (agent-auth.md: a
 * display in {authenticated, usable} names a probe observation, a key-scoped
 * gateway check, or an acknowledged route, each with a non-null evidence age).
 * The badge trusts the runtime's derivation rather than re-checking that here —
 * but the tone table is the one place we assert "green means evidence".
 */
export function isEvidenceGreen(display: AgentAuthDisplay): boolean {
  return display === "usable" || display === "authenticated";
}

export type AuthEvidenceTone = "success" | "warning" | "destructive" | "neutral";

export function toneForDisplay(display: AgentAuthDisplay): AuthEvidenceTone {
  switch (display) {
    case "usable":
    case "authenticated":
      return "success";
    case "misconfigured":
    case "expired":
      return "destructive";
    case "unavailable":
    case "probing":
    case "selected":
      return "warning";
    case "not_installed":
    case "unsupported":
    case "installed":
      return "neutral";
  }
}

export function labelForDisplay(display: AgentAuthDisplay): string {
  switch (display) {
    case "not_installed":
      return "Not installed";
    case "unsupported":
      return "Unsupported";
    case "misconfigured":
      return "Misconfigured";
    case "expired":
      return "Expired";
    case "unavailable":
      return "Unavailable";
    case "probing":
      return "Probing";
    case "usable":
      return "Usable";
    case "authenticated":
      return "Authenticated";
    case "selected":
      return "Selected";
    case "installed":
      return "Installed";
  }
}

/** The next-action affordance label, or null when no action is offered. */
export function labelForNextAction(action: AgentAuthNextAction): string | null {
  switch (action) {
    case "none":
      return null;
    case "install":
      return "Install";
    case "fix_config":
      return "Fix configuration";
    case "log_in_or_paste_key":
      return "Log in or paste a key";
    case "top_up_or_retry":
      return "Top up or retry";
    case "wait":
      return "Waiting";
    case "wait_for_probe":
      return "Waiting for probe";
    case "choose_source":
      return "Choose a source";
  }
}

/** Coarse relative age ("2m", "3h", "5d") from a whole-second count. */
export function formatEvidenceAge(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * The evidence line shown on a green badge, e.g. "verified 2m ago". Returns
 * null when the display is not green or no evidence age is present — the badge
 * never fakes freshness it does not hold.
 */
export function evidenceAgeLine(state: AgentAuthState): string | null {
  if (!isEvidenceGreen(state.display)) return null;
  const age = state.evidenceAgeSeconds;
  if (age == null) return null;
  return `verified ${formatEvidenceAge(age)} ago`;
}

export interface HandoffPresentation {
  label: string;
  /** True while the browser round-trip is still open (spinner). */
  inFlight: boolean;
  /** True for terminal failures that offer a retry. */
  retryable: boolean;
}

export function presentHandoff(
  handoff: AgentAuthHandoff,
): HandoffPresentation {
  switch (handoff) {
    case "initiated":
      return { label: "Sign-in started", inFlight: true, retryable: false };
    case "awaiting_browser":
      return { label: "Waiting for your browser", inFlight: true, retryable: false };
    case "completed":
      return { label: "Sign-in complete", inFlight: false, retryable: false };
    case "cancelled":
      return { label: "Sign-in cancelled", inFlight: false, retryable: true };
    case "timed_out":
      return { label: "Sign-in timed out", inFlight: false, retryable: true };
  }
}
