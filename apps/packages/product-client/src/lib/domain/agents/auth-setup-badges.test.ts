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

    // The light dims, it never goes out: green survives the pending re-probe,
    // and the ruled stale marker (2026-08-27) carries the observation's age.
    expect(badge.launchable).toBe(true);
    expect(badge.tone).toBe("success");
    expect(badge.rechecking).toBe(true);
    expect(badge.pending).toBe(false);
    expect(badge.detail).toMatch(/^last checked \d+[smhd] ago — retrying$/);
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
    // The ruled stale wording (2026-08-27) applies to any stale observation.
    expect(badge.detail).toMatch(/^last checked \d+[smhd] ago — retrying$/);
  });

  it("makes stale with NOTHING observed actionable, not an eternal pending", () => {
    // There is no last observation to show, and no clock here to give up on the
    // re-probe, so the row states the document's words and offers the way
    // forward. The card must never wait on a probe it cannot see finish.
    const badge = deriveOnboardingAgentBadge(
      agentFor({ authStatus: statusFor({ at: null, stale: true }) }),
    );

    expect(badge.phase).toBe("actionable");
    expect(badge.pending).toBe(false);
    expect(badge.terminal).toBe(true);
    // A re-probe IS running: the marker says so, and it is not a spinner.
    expect(badge.rechecking).toBe(true);
    expect(badge.detail).toBe(HARNESS_PANE_COPY.authBadgeRechecking);
  });

  it("makes an applied-but-unobserved harness actionable, never pending forever", () => {
    // The runtime owes this harness an observation and is not even re-probing
    // (the document is not stale). Nothing will move this row on its own.
    const badge = deriveOnboardingAgentBadge(
      agentFor({ authStatus: statusFor({ verdict: "unverified" }) }),
    );

    expect(badge.phase).toBe("actionable");
    expect(badge.label).toBe(HARNESS_PANE_COPY.authBadgeNotVerified);
    expect(badge.pending).toBe(false);
    expect(badge.terminal).toBe(true);
  });

  it("names the action the document supports: nothing applied ⇒ choose a source", () => {
    const badge = deriveOnboardingAgentBadge(
      agentFor({
        authStatus: statusFor({ verdict: "unverified" }, { applied: null }),
      }),
    );

    expect(badge.actionLabel).toBe(HOME_SCREEN_LABELS.authSetupChooseSourceAction);
  });

  it("offers the DETECTED native login as a seat when the runtime offers it", () => {
    // The `native` row's own statement (detected + offer: "mint_seat"): the login
    // already on this machine can be captured as a portable seat.
    const badge = deriveOnboardingAgentBadge(
      agentFor({
        authStatus: statusFor(
          { verdict: "unverified" },
          {
            applied: null,
            methods: [
              { kind: "native", applied: false, detected: true, offer: "mint_seat" },
            ],
          },
        ),
      }),
    );

    expect(badge.actionLabel).toBe(HOME_SCREEN_LABELS.authSetupUseLoginAction);
  });

  it("keeps the GENERIC action for a cause the document cannot attribute", () => {
    // A failed probe on an applied method: the reason (an exhausted allocation, a
    // dead key) is not a document field, and the typed per-cause reasons are
    // unbuilt. Guessing a specific action here would be a derivation.
    const badge = deriveOnboardingAgentBadge(
      agentFor({ authStatus: statusFor({ verdict: "failed", at: OBSERVED_AT }) }),
    );

    expect(badge.actionLabel).toBeNull();
  });

  it("carries the evidence age on green, so the card's green means something", () => {
    const badge = deriveOnboardingAgentBadge(
      agentFor({
        authStatus: statusFor({ verdict: "verified", at: OBSERVED_AT }),
      }),
    );

    expect(badge.detail).not.toBeNull();
    expect(badge.detail).toContain("verified");
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

  it("is not done while an install is still running", () => {
    // The ONE document-independent wait: a live install, whose end the runtime
    // reports as installed / install_required / failed.
    const evidence = resolveAuthSetupEvidence(
      ["claude"],
      agentsByKind(agentFor({ installState: "installing" })),
      true,
    );

    expect(evidence.badges).toHaveLength(1);
    expect(evidence.done).toBe(false);
  });

  it("CANNOT stay pending when the runtime reports no progress at all", () => {
    // The hang this replaces: first-run adoption wrote selections and the probe
    // never advanced one harness past unverified, so Home showed "Setting up your
    // agents…" for the rest of the session and permanently consumed one of three
    // onboarding slots. Every arm of the document is terminal now, so the card
    // completes with its rows actionable instead.
    for (const probe of [
      { verdict: "unverified", at: null, stale: false },
      { verdict: "unverified", at: null, stale: true },
      { verdict: "failed", at: null, stale: false },
      { verdict: "verified", at: null, stale: false },
    ] as const) {
      const evidence = resolveAuthSetupEvidence(
        ["claude"],
        agentsByKind(agentFor({ authStatus: statusFor(probe) })),
        true,
      );

      expect(evidence.done).toBe(true);
      expect(evidence.badges.some((badge) => badge.pending)).toBe(false);
      expect(evidence.badges.every((badge) => badge.terminal)).toBe(true);
    }
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
      true,
    );

    expect(evidence.done).toBe(true);
    expect(evidence.badges.map((badge) => badge.phase)).toEqual([
      "ready",
      "actionable",
    ]);
  });

  it("waits on an adopted kind while the projection has not ANSWERED", () => {
    const evidence = resolveAuthSetupEvidence(["grok"], agentsByKind(), false);

    expect(evidence.done).toBe(false);
    expect(evidence.badges).toHaveLength(1);
    expect(evidence.badges[0]?.harnessKind).toBe("grok");
    // Named through the registry, never the bare wire kind (D-R19).
    expect(evidence.badges[0]?.displayName).not.toBe("grok");
    expect(evidence.badges[0]?.pending).toBe(true);
  });

  it("stops waiting once the projection has answered and still lacks the kind", () => {
    // No further state is coming for this kind, so waiting on it is waiting
    // forever. The row stays VISIBLE and terminal, with the pane affordance.
    const evidence = resolveAuthSetupEvidence(["grok"], agentsByKind(), true);

    expect(evidence.done).toBe(true);
    expect(evidence.badges).toHaveLength(1);
    expect(evidence.badges[0]?.pending).toBe(false);
    expect(evidence.badges[0]?.phase).toBe("actionable");
    expect(evidence.badges[0]?.displayName).not.toBe("grok");
  });

  it("is never done with no adopted kinds at all", () => {
    expect(resolveAuthSetupEvidence([], agentsByKind(), true).done).toBe(false);
  });
});
