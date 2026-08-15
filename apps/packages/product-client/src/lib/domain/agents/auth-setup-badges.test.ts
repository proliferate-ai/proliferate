import { describe, expect, it } from "vitest";
import type { AgentSummary } from "@anyharness/sdk";
import type { AgentAuthState } from "#product/lib/domain/settings/agent-auth-evidence";
import {
  deriveOnboardingAgentBadge,
  resolveAuthSetupEvidence,
} from "#product/lib/domain/agents/auth-setup-badges";

type Display = AgentAuthState["display"];

const ALL_DISPLAYS: Display[] = [
  "not_installed",
  "unsupported",
  "misconfigured",
  "expired",
  "unavailable",
  "probing",
  "usable",
  "authenticated",
  "selected",
  "installed",
];

function authStateFor(
  display: Display,
  extra: Partial<AgentAuthState> = {},
): AgentAuthState {
  return {
    display,
    nextAction: "none",
    facts: {
      installed: true,
      expired: false,
      misconfigured: false,
      unsupportedRoute: false,
      probe: { phase: "idle", observationNonempty: false },
    },
    ...extra,
  };
}

function agentFor(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    kind: "claude",
    displayName: "Claude Code",
    credentialState: "ready",
    installState: "installed",
    expectedEnvVars: [],
    nativeRequired: false,
    readiness: "ready",
    supportsLogin: true,
    ...overrides,
  } as AgentSummary;
}

describe("deriveOnboardingAgentBadge — install state binding", () => {
  it("binds installing to a pending, non-terminal badge (no affordance yet)", () => {
    const badge = deriveOnboardingAgentBadge(
      agentFor({ installState: "installing" }),
    );
    expect(badge.phase).toBe("installing");
    expect(badge.pending).toBe(true);
    expect(badge.terminal).toBe(false);
    expect(badge.launchable).toBe(false);
  });

  it("binds install_required (no derivation yet) to an actionable install", () => {
    const badge = deriveOnboardingAgentBadge(
      agentFor({ installState: "install_required", authState: undefined }),
    );
    expect(badge.phase).toBe("actionable");
    expect(badge.terminal).toBe(true);
    expect(badge.actionLabel).toBe("Install");
  });

  it("binds an installed-but-underived agent to an actionable terminal (never an eternal spinner)", () => {
    const badge = deriveOnboardingAgentBadge(
      agentFor({ installState: "installed", authState: undefined }),
    );
    // A runtime that never folds a derivation must not spin forever: the card
    // completes via actionable-terminal semantics, with the pane fallback.
    expect(badge.phase).toBe("actionable");
    expect(badge.pending).toBe(false);
    expect(badge.terminal).toBe(true);
    expect(badge.launchable).toBe(false);
    expect(badge.label).toBe("Waiting for status");
  });
});

describe("deriveOnboardingAgentBadge — ack + derived display binding", () => {
  it("renders usable/authenticated as launchable terminals with no action", () => {
    for (const display of ["usable", "authenticated"] as const) {
      const badge = deriveOnboardingAgentBadge(
        agentFor({ authState: authStateFor(display, { nextAction: "none" }) }),
      );
      expect(badge.phase).toBe("ready");
      expect(badge.launchable).toBe(true);
      expect(badge.terminal).toBe(true);
      expect(badge.tone).toBe("success");
      expect(badge.actionLabel).toBeNull();
    }
  });

  it("renders selected (acknowledged, awaiting probe) as a bound pending state", () => {
    const badge = deriveOnboardingAgentBadge(
      agentFor({ authState: authStateFor("selected", { nextAction: "wait" }) }),
    );
    expect(badge.phase).toBe("waiting");
    expect(badge.pending).toBe(true);
    expect(badge.terminal).toBe(false);
  });

  it("renders a running/queued probe as pending, not terminal", () => {
    for (const phase of ["running", "queued"] as const) {
      const badge = deriveOnboardingAgentBadge(
        agentFor({
          authState: authStateFor("probing", {
            nextAction: "wait_for_probe",
            facts: {
              installed: true,
              expired: false,
              misconfigured: false,
              unsupportedRoute: false,
              probe: { phase, observationNonempty: false },
            },
          }),
        }),
      );
      expect(badge.phase).toBe("probing");
      expect(badge.pending).toBe(true);
      expect(badge.terminal).toBe(false);
    }
  });

  it("renders a stuck probe (backoff) as a terminal badge carrying its next attempt, never an eternal spinner", () => {
    const badge = deriveOnboardingAgentBadge(
      agentFor({
        authState: authStateFor("unavailable", {
          nextAction: "top_up_or_retry",
          facts: {
            installed: true,
            expired: false,
            misconfigured: false,
            unsupportedRoute: false,
            probe: {
              phase: "backoff",
              observationNonempty: false,
              nextAttemptAt: "2026-01-01T00:00:30Z",
              lastFailureDetail: "429 rate limited",
            },
          },
        }),
      }),
    );
    expect(badge.phase).toBe("backoff");
    expect(badge.pending).toBe(false);
    expect(badge.terminal).toBe(true);
    expect(badge.nextAttemptAt).toBe("2026-01-01T00:00:30Z");
    expect(badge.lastFailureDetail).toBe("429 rate limited");
  });

  it("renders every non-launchable terminal display with an actionable next step (no dead ends)", () => {
    const terminalActionByDisplay: Partial<Record<Display, string>> = {
      installed: "log_in_or_paste_key",
      not_installed: "install",
      expired: "log_in_or_paste_key",
      misconfigured: "fix_config",
    };
    for (const [display, nextAction] of Object.entries(
      terminalActionByDisplay,
    )) {
      const badge = deriveOnboardingAgentBadge(
        agentFor({
          kind: display,
          authState: authStateFor(display as Display, {
            nextAction: nextAction as AgentAuthState["nextAction"],
          }),
        }),
      );
      expect(badge.terminal).toBe(true);
      expect(badge.launchable).toBe(false);
      // A next-action label is present, so the row is never a dead end.
      expect(badge.actionLabel).not.toBeNull();
    }
  });
});

describe("no-dead-end invariant across every display", () => {
  // Mirror of the card's affordance rule (HomeOnboardingCards): a launchable
  // badge needs no action; every other badge routes to the pane via its
  // next-action label, or the "open agents" fallback when the action is null.
  const OPEN_AGENTS_FALLBACK = "Open agent settings";
  function cardAffordance(
    launchable: boolean,
    actionLabel: string | null,
  ): string | null {
    return launchable ? null : actionLabel ?? OPEN_AGENTS_FALLBACK;
  }

  it("resolves every display to either a launchable terminal or a non-null affordance", () => {
    for (const display of ALL_DISPLAYS) {
      const badge = deriveOnboardingAgentBadge(
        agentFor({ authState: authStateFor(display) }),
      );
      if (badge.launchable) {
        expect(cardAffordance(badge.launchable, badge.actionLabel)).toBeNull();
      } else {
        // Never a dead end: a non-launchable badge always has an affordance.
        expect(cardAffordance(badge.launchable, badge.actionLabel)).not.toBeNull();
      }
      // Green tone is reachable ONLY on the two launchable terminals.
      if (badge.tone === "success") {
        expect(badge.launchable).toBe(true);
      }
    }
  });

  it("keeps unsupported (next action 'none') from being a dead end via the fallback", () => {
    const badge = deriveOnboardingAgentBadge(
      agentFor({ authState: authStateFor("unsupported", { nextAction: "none" }) }),
    );
    expect(badge.launchable).toBe(false);
    expect(badge.actionLabel).toBeNull();
    expect(cardAffordance(badge.launchable, badge.actionLabel)).toBe(
      OPEN_AGENTS_FALLBACK,
    );
  });
});

describe("resolveAuthSetupEvidence — card completion is state-bound", () => {
  function byKind(agents: AgentSummary[]): Map<string, AgentSummary> {
    return new Map(agents.map((agent) => [agent.kind, agent]));
  }

  it("is not done while any adopted agent is still pending (no timer completes it)", () => {
    const agents = byKind([
      agentFor({ kind: "claude", authState: authStateFor("usable") }),
      agentFor({ kind: "codex", installState: "installing" }),
    ]);
    const { badges, done } = resolveAuthSetupEvidence(["claude", "codex"], agents);
    expect(badges).toHaveLength(2);
    expect(done).toBe(false);
  });

  it("emits a visible named badge for an adopted kind missing from the projection", () => {
    const agents = byKind([
      agentFor({ kind: "claude", authState: authStateFor("usable") }),
    ]);
    const { badges, done } = resolveAuthSetupEvidence(["claude", "codex"], agents);
    expect(done).toBe(false);
    // The stuck agent is still accounted for by a row, named by its kind.
    const missing = badges.find((badge) => badge.harnessKind === "codex");
    expect(missing).toBeDefined();
    expect(missing?.displayName).toBe("codex");
    expect(missing?.pending).toBe(true);
    expect(missing?.terminal).toBe(false);
  });

  it("completes only when every adopted agent reaches a terminal state (launchable or actionable)", () => {
    const agents = byKind([
      agentFor({ kind: "claude", authState: authStateFor("usable") }),
      agentFor({
        kind: "codex",
        authState: authStateFor("installed", { nextAction: "log_in_or_paste_key" }),
      }),
    ]);
    const { done } = resolveAuthSetupEvidence(["claude", "codex"], agents);
    expect(done).toBe(true);
  });

  it("is not done for an empty adopted set", () => {
    const { done } = resolveAuthSetupEvidence([], new Map());
    expect(done).toBe(false);
  });
});
