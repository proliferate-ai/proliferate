import { describe, expect, it } from "vitest";
import {
  HOME_MODEL_GATE_AGENT_SETUP_NOTICE,
  HOME_MODEL_GATE_BLOCKED_REASONS,
  HOME_MODEL_GATE_REFUSAL_ANNOUNCEMENT,
  resolveHomeModelGate,
  resolveHomeModelGateNotice,
  resolveHomeModelGateRefusalAnnouncement,
  resolveHomeModelSelectorAvailability,
  type HomeModelGate,
  type HomeModelGateInput,
  type HomeModelGateObservation,
} from "#product/lib/domain/home/home-model-gate";

function input(overrides: Partial<HomeModelGateInput> = {}): HomeModelGateInput {
  return {
    hasLaunchTarget: true,
    isTargetUnobserved: false,
    hasExactSelection: false,
    offeredModelCount: 0,
    observations: [],
    agentReadiness: ["ready"],
    isInstalling: false,
    isCatalogLoading: false,
    hasCatalogError: false,
    ...overrides,
  };
}

function observation(
  overrides: Partial<HomeModelGateObservation> = {},
): HomeModelGateObservation {
  return {
    harnessKind: "claude",
    state: null,
    probePhase: null,
    isPending: false,
    isError: false,
    ...overrides,
  };
}

const ALL_GATES: HomeModelGate[] = [
  { kind: "launchable" },
  { kind: "selection_required" },
  ...HOME_MODEL_GATE_BLOCKED_REASONS.map((reason) => ({ kind: "blocked", reason } as const)),
];

describe("resolveHomeModelGate precedence", () => {
  it("reports target_missing before anything else can be true", () => {
    expect(resolveHomeModelGate(input({
      hasLaunchTarget: false,
      hasExactSelection: true,
      offeredModelCount: 4,
    }))).toEqual({ kind: "blocked", reason: "target_missing" });
  });

  it("reports target_unobserved for a cloud target and never falls back to local rows", () => {
    // Local observations exist and are launchable; the cloud target still has
    // not reported, and borrowing the local answer would be a lie about which
    // machine will run the session.
    expect(resolveHomeModelGate(input({
      isTargetUnobserved: true,
      hasExactSelection: true,
      offeredModelCount: 12,
      observations: [observation({ state: "observed" })],
    }))).toEqual({ kind: "blocked", reason: "target_unobserved" });
  });

  it("is launchable on an exact selection even while a probe runs", () => {
    expect(resolveHomeModelGate(input({
      hasExactSelection: true,
      offeredModelCount: 2,
      observations: [observation({ state: "refreshing", probePhase: "running" })],
    }))).toEqual({ kind: "launchable" });
  });

  it("keeps last_good_after_failure launchable-capable", () => {
    expect(resolveHomeModelGate(input({
      hasExactSelection: true,
      offeredModelCount: 3,
      observations: [observation({ state: "last_good_after_failure" })],
    }))).toEqual({ kind: "launchable" });
    // Same rows, nothing selected: still not a failure state.
    expect(resolveHomeModelGate(input({
      offeredModelCount: 3,
      observations: [observation({ state: "last_good_after_failure" })],
    }))).toEqual({ kind: "selection_required" });
  });

  it("never fabricates a selection when rows exist", () => {
    // Every settled failure signal is present at once. Rows still exist, so
    // the truthful answer is "you have not chosen", not "something is broken"
    // and above all not "here, I chose for you".
    expect(resolveHomeModelGate(input({
      offeredModelCount: 1,
      agentReadiness: ["install_required"],
      hasCatalogError: true,
      observations: [
        observation({ state: "failed_without_observation" }),
        observation({ harnessKind: "codex", isError: true }),
      ],
    }))).toEqual({ kind: "selection_required" });
  });

  it("reports querying while a read has never answered", () => {
    expect(resolveHomeModelGate(input({
      observations: [observation({ isPending: true })],
    }))).toEqual({ kind: "blocked", reason: "querying" });
    expect(resolveHomeModelGate(input({ isCatalogLoading: true })))
      .toEqual({ kind: "blocked", reason: "querying" });
  });

  it("reports observation_pending for a queued or running probe, and for an install", () => {
    for (const probePhase of ["queued", "running"] as const) {
      expect(resolveHomeModelGate(input({
        observations: [observation({ state: "detecting", probePhase })],
      }))).toEqual({ kind: "blocked", reason: "observation_pending" });
    }
    expect(resolveHomeModelGate(input({
      isInstalling: true,
      agentReadiness: ["install_required"],
    }))).toEqual({ kind: "blocked", reason: "observation_pending" });
  });

  it("does not treat a settled detecting harness as pending", () => {
    // A manual-refresh-only harness sits `detecting` by design. Reporting that
    // as in-flight is the 32-minute "Probing..." bug.
    expect(resolveHomeModelGate(input({
      observations: [observation({ state: "detecting", probePhase: "idle" })],
    }))).toEqual({ kind: "blocked", reason: "querying" });
  });

  it("reports agent_setup_required only for install_required or login_required", () => {
    for (const readiness of ["install_required", "login_required"] as const) {
      expect(resolveHomeModelGate(input({ agentReadiness: [readiness] })))
        .toEqual({ kind: "blocked", reason: "agent_setup_required" });
    }
    for (const readiness of ["ready", "credentials_required", "unsupported", "error"] as const) {
      expect(resolveHomeModelGate(input({ agentReadiness: [readiness] })))
        .not.toEqual({ kind: "blocked", reason: "agent_setup_required" });
    }
  });

  it("reports the settled observation reasons", () => {
    expect(resolveHomeModelGate(input({
      observations: [observation({ state: "observed_empty" })],
    }))).toEqual({ kind: "blocked", reason: "observed_empty" });
    expect(resolveHomeModelGate(input({
      observations: [observation({ state: "failed_without_observation" })],
    }))).toEqual({ kind: "blocked", reason: "observation_failed" });
    expect(resolveHomeModelGate(input({
      observations: [observation({ isError: true })],
    }))).toEqual({ kind: "blocked", reason: "transport_error" });
    expect(resolveHomeModelGate(input({ hasCatalogError: true })))
      .toEqual({ kind: "blocked", reason: "transport_error" });
  });

  it("every reason is reachable", () => {
    const reached = new Set<string>();
    const cases: HomeModelGateInput[] = [
      input({ hasLaunchTarget: false }),
      input({ isTargetUnobserved: true }),
      input({ observations: [observation({ isPending: true })] }),
      input({ observations: [observation({ probePhase: "running" })] }),
      input({ agentReadiness: ["login_required"] }),
      input({ observations: [observation({ state: "observed_empty" })] }),
      input({ observations: [observation({ state: "failed_without_observation" })] }),
      input({ observations: [observation({ isError: true })] }),
    ];
    for (const testCase of cases) {
      const gate = resolveHomeModelGate(testCase);
      if (gate.kind === "blocked") reached.add(gate.reason);
    }
    expect([...reached].sort()).toEqual([...HOME_MODEL_GATE_BLOCKED_REASONS].sort());
  });
});

describe("home model gate presentation", () => {
  // Ruling 2, asserted structurally rather than per-screen: whatever the gate
  // is, an enabled picker and the setup sentence cannot both be produced.
  it("never enables the model selector alongside the Finish agent setup notice", () => {
    for (const gate of ALL_GATES) {
      const availability = resolveHomeModelSelectorAvailability(gate);
      const notice = resolveHomeModelGateNotice(gate);
      const selectorEnabled =
        availability !== "observation_pending" && availability !== "unavailable";
      expect(
        selectorEnabled && notice?.text === HOME_MODEL_GATE_AGENT_SETUP_NOTICE,
        `gate ${JSON.stringify(gate)} produced a coexistence`,
      ).toBe(false);
    }
  });

  it("says Finish agent setup for agent_setup_required and nothing else", () => {
    const saying = ALL_GATES.filter((gate) =>
      resolveHomeModelGateNotice(gate)?.text === HOME_MODEL_GATE_AGENT_SETUP_NOTICE
    );
    expect(saying).toEqual([{ kind: "blocked", reason: "agent_setup_required" }]);
  });

  it("stays silent for selection_required, observed_empty and the in-flight reasons", () => {
    for (const gate of [
      { kind: "launchable" },
      { kind: "selection_required" },
      { kind: "blocked", reason: "target_missing" },
      { kind: "blocked", reason: "querying" },
      { kind: "blocked", reason: "observation_pending" },
      { kind: "blocked", reason: "observed_empty" },
    ] satisfies HomeModelGate[]) {
      expect(resolveHomeModelGateNotice(gate)).toBeNull();
    }
  });

  it("carries the frozen copy and an enabled cure for every blocked notice", () => {
    expect(resolveHomeModelGateNotice({ kind: "blocked", reason: "observation_failed" }))
      .toEqual({ text: "Couldn't check your models.", actionLabel: "Retry", action: "retry_probe" });
    expect(resolveHomeModelGateNotice({ kind: "blocked", reason: "transport_error" }))
      .toEqual({
        text: "Models couldn't be loaded.",
        actionLabel: "Retry",
        action: "refetch_launch_options",
      });
    expect(resolveHomeModelGateNotice({ kind: "blocked", reason: "target_unobserved" }))
      .toEqual({
        text: "Proliferate Cloud hasn't reported launch options yet.",
        actionLabel: "Check again",
        action: "check_target_again",
      });
  });

  it("keeps the picker enabled for observed_empty and disabled for the failures", () => {
    expect(resolveHomeModelSelectorAvailability({ kind: "selection_required" })).toBe("ready");
    expect(resolveHomeModelSelectorAvailability({ kind: "blocked", reason: "observed_empty" }))
      .toBe("observed_empty");
    expect(resolveHomeModelSelectorAvailability({ kind: "blocked", reason: "observation_pending" }))
      .toBe("observation_pending");
    for (const reason of ["observation_failed", "transport_error", "target_unobserved"] as const) {
      expect(resolveHomeModelSelectorAvailability({ kind: "blocked", reason }))
        .toBe("unavailable");
    }
  });
});

describe("refusal announcement", () => {
  it("re-announces on repeat refusals without stacking or numerals", () => {
    const first = resolveHomeModelGateRefusalAnnouncement(1);
    const second = resolveHomeModelGateRefusalAnnouncement(2);
    const third = resolveHomeModelGateRefusalAnnouncement(3);

    expect(resolveHomeModelGateRefusalAnnouncement(0)).toBe("");
    // Different string each time, so the live region re-commits...
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
    // ...but always the same sentence, never appended to.
    for (const text of [first, second, third]) {
      expect(text.trim()).toBe(HOME_MODEL_GATE_REFUSAL_ANNOUNCEMENT);
      expect(/\d/.test(text)).toBe(false);
    }
    expect(third.length).toBe(first.length);
  });
});
