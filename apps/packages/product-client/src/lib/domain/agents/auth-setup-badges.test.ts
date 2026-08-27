import { describe, expect, it } from "vitest";
import type { AgentAuthStatusDoc, AgentSummary } from "@anyharness/sdk";
import {
  deriveOnboardingAgentBadge,
  resolveAuthSetupEvidence,
} from "#product/lib/domain/agents/auth-setup-badges";
import { HOME_SCREEN_LABELS } from "#product/copy/home/home-screen-copy";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";

const OBSERVED_AT = "2026-08-27T00:00:00Z";

function statusFor(
  probe: Partial<AgentAuthStatusDoc["probe"]> = {},
  overrides: Partial<AgentAuthStatusDoc> = {},
): AgentAuthStatusDoc {
  return {
    harness_kind: "claude",
    methods: [],
    applied: { kind: "seat", seat_id: "seat-1" },
    next_seat_id: null,
    rotate: true,
    probe: { verdict: "unverified", at: null, stale: false, ...probe },
    cooling_until: null,
    ...overrides,
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
    expect(badge.label).toBe(HOME_SCREEN_LABELS.authSetupInstalling);
    expect(badge.pending).toBe(true);
    expect(badge.terminal).toBe(false);
    expect(badge.launchable).toBe(false);
    expect(badge.actionLabel).toBeNull();
  });

  it("wins over an absent document: installing reads installing", () => {
    const badge = deriveOnboardingAgentBadge(
      agentFor({ installState: "installing", authStatus: statusFor() }),
    );

    expect(badge.phase).toBe("installing");
  });

  it.each(["install_required", "failed"] as const)(
    "makes a %s install an actionable terminal with its Install affordance",
    (installState) => {
      const badge = deriveOnboardingAgentBadge(agentFor({ installState }));

      expect(badge.phase).toBe("actionable");
      expect(badge.label).toBe(HOME_SCREEN_LABELS.authSetupNeedsInstall);
      expect(badge.terminal).toBe(true);
      expect(badge.pending).toBe(false);
      expect(badge.launchable).toBe(false);
      expect(badge.actionLabel).toBe(HOME_SCREEN_LABELS.authSetupInstallAction);
    },
  );
});

describe("deriveOnboardingAgentBadge — no status document", () => {
  it("is an actionable terminal, so the card can never spin forever", () => {
    const badge = deriveOnboardingAgentBadge(agentFor({ authStatus: null }));

    expect(badge.phase).toBe("actionable");
    expect(badge.label).toBe(HOME_SCREEN_LABELS.authSetupWaitingStatus);
    expect(badge.tone).toBe("neutral");
    expect(badge.terminal).toBe(true);
    expect(badge.pending).toBe(false);
    expect(badge.launchable).toBe(false);
    expect(badge.rechecking).toBe(false);
  });
});

describe("deriveOnboardingAgentBadge — the status document, verbatim", () => {
  it("is ready and launchable ONLY on a dated observation", () => {
    const badge = deriveOnboardingAgentBadge(
      agentFor({
        authStatus: statusFor({ verdict: "verified", at: OBSERVED_AT }),
      }),
    );

    expect(badge.phase).toBe("ready");
    expect(badge.label).toBe(HARNESS_PANE_COPY.authBadgeAuthenticated);
    expect(badge.tone).toBe("success");
    expect(badge.launchable).toBe(true);
    expect(badge.terminal).toBe(true);
  });

  it("refuses green for a verified verdict with no evidence age", () => {
    const badge = deriveOnboardingAgentBadge(
      agentFor({ authStatus: statusFor({ verdict: "verified", at: null }) }),
    );

    expect(badge.phase).not.toBe("ready");
    expect(badge.launchable).toBe(false);
    expect(badge.tone).not.toBe("success");
  });

  it("renders a STALE document as stale-with-last-observation, never loading", () => {
    const badge = deriveOnboardingAgentBadge(
      agentFor({
        authStatus: statusFor({
          verdict: "verified",
          at: OBSERVED_AT,
          stale: true,
        }),
      }),
    );

    // The light dims, it never goes out: green with its age survives the
    // pending re-probe, and the re-checking marker is what says so.
    expect(badge.launchable).toBe(true);
    expect(badge.tone).toBe("success");
    expect(badge.rechecking).toBe(true);
    expect(badge.pending).toBe(false);
  });

  it("makes a stale FAILED observation terminal with its last words on screen", () => {
    const badge = deriveOnboardingAgentBadge(
      agentFor({
        authStatus: statusFor({
          verdict: "failed",
          at: OBSERVED_AT,
          stale: true,
        }),
      }),
    );

    expect(badge.phase).toBe("rechecking");
    expect(badge.label).toBe(HARNESS_PANE_COPY.authBadgeNotAuthenticated);
    expect(badge.rechecking).toBe(true);
    // Terminal, so the card completes rather than waiting on a probe forever.
    expect(badge.terminal).toBe(true);
    expect(badge.pending).toBe(false);
  });

  it("treats stale with NOTHING observed as the first probe still running", () => {
    const badge = deriveOnboardingAgentBadge(
      agentFor({ authStatus: statusFor({ at: null, stale: true }) }),
    );

    expect(badge.phase).toBe("waiting");
    expect(badge.pending).toBe(true);
    expect(badge.terminal).toBe(false);
    expect(badge.rechecking).toBe(true);
  });

  it("waits, bound to the state, while an applied method is unobserved", () => {
    const badge = deriveOnboardingAgentBadge(
      agentFor({ authStatus: statusFor({ verdict: "unverified" }) }),
    );

    expect(badge.phase).toBe("waiting");
    expect(badge.label).toBe(HARNESS_PANE_COPY.authBadgeNotVerified);
    expect(badge.pending).toBe(true);
    expect(badge.terminal).toBe(false);
  });

  it("is an actionable terminal with nothing applied", () => {
    const badge = deriveOnboardingAgentBadge(
      agentFor({
        authStatus: statusFor({ verdict: "unverified" }, { applied: null }),
      }),
    );

    expect(badge.phase).toBe("actionable");
    expect(badge.label).toBe(HARNESS_PANE_COPY.authBadgeNotConfigured);
    expect(badge.tone).toBe("neutral");
    expect(badge.terminal).toBe(true);
  });

  it("is an actionable terminal on a failed observation", () => {
    const badge = deriveOnboardingAgentBadge(
      agentFor({ authStatus: statusFor({ verdict: "failed", at: OBSERVED_AT }) }),
    );

    expect(badge.phase).toBe("actionable");
    expect(badge.tone).toBe("destructive");
    expect(badge.terminal).toBe(true);
    expect(badge.launchable).toBe(false);
  });

  it("never greens an unknown verdict from a newer runtime (forward-compat)", () => {
    const badge = deriveOnboardingAgentBadge(
      agentFor({
        authStatus: statusFor({
          verdict: "quantum_verified" as AgentAuthStatusDoc["probe"]["verdict"],
          at: OBSERVED_AT,
        }),
      }),
    );

    expect(badge.launchable).toBe(false);
    expect(badge.tone).toBe("neutral");
  });
});

describe("resolveAuthSetupEvidence", () => {
  function agentsByKind(...agents: AgentSummary[]) {
    return new Map(agents.map((agent) => [agent.kind, agent]));
  }

  it("is not done while any adopted agent is non-terminal", () => {
    const evidence = resolveAuthSetupEvidence(
      ["claude"],
      agentsByKind(agentFor({ authStatus: statusFor() })),
    );

    expect(evidence.badges).toHaveLength(1);
    expect(evidence.done).toBe(false);
  });

  it("is done once every adopted agent is terminal", () => {
    const evidence = resolveAuthSetupEvidence(
      ["claude", "codex"],
      agentsByKind(
        agentFor({
          authStatus: statusFor({ verdict: "verified", at: OBSERVED_AT }),
        }),
        agentFor({
          kind: "codex",
          displayName: "Codex",
          authStatus: statusFor(
            { verdict: "failed", at: OBSERVED_AT },
            { harness_kind: "codex" },
          ),
        }),
      ),
    );

    expect(evidence.done).toBe(true);
    expect(evidence.badges.map((badge) => badge.phase)).toEqual([
      "ready",
      "actionable",
    ]);
  });

  it("emits a visible pending row for an adopted kind the projection lacks", () => {
    const evidence = resolveAuthSetupEvidence(["grok"], agentsByKind());

    expect(evidence.done).toBe(false);
    expect(evidence.badges).toHaveLength(1);
    expect(evidence.badges[0]?.harnessKind).toBe("grok");
    // Named through the registry, never the bare wire kind (D-R19).
    expect(evidence.badges[0]?.displayName).not.toBe("grok");
    expect(evidence.badges[0]?.pending).toBe(true);
  });

  it("is never done with no adopted kinds at all", () => {
    expect(resolveAuthSetupEvidence([], agentsByKind()).done).toBe(false);
  });
});
