import { describe, expect, it } from "vitest";
import {
  HOME_MODEL_GATE_AGENT_SETUP_NOTICE,
  HOME_MODEL_GATE_BLOCKED_REASONS,
  HOME_MODEL_GATE_REFRESH_REJECTED_NOTICE,
  HOME_MODEL_GATE_REFUSAL_ANNOUNCEMENT,
  homeModelGateNeedsNewProbe,
  resolveHomeModelGate,
  resolveHomeModelGateNotice,
  resolveHomeModelGateRefusalAnnouncement,
  resolveHomeModelSelectorAvailability,
  type HomeModelGate,
  type HomeModelGateBlockedReason,
  type HomeModelGateInput,
  type HomeModelGateObservation,
} from "#product/lib/domain/home/home-model-gate";
import { resolveModelSelectorEnabled } from "#product/lib/domain/chat/models/model-selector-types";

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

  it("reports a settled detecting harness as observation_idle, with a cure", () => {
    // A harness excluded from automatic probing sits `detecting` + `idle`
    // forever. Calling that in-flight is the "Probing…" that never ends;
    // calling it `querying` is a silent dead end with nothing to press.
    const gate = resolveHomeModelGate(input({
      observations: [observation({ state: "detecting", probePhase: "idle" })],
    }));
    expect(gate).toEqual({ kind: "blocked", reason: "observation_idle" });
    expect(resolveHomeModelSelectorAvailability(gate)).not.toBe("observation_pending");
    const notice = resolveHomeModelGateNotice(gate);
    expect(notice).toEqual({
      text: "Models haven't been detected yet.",
      actionLabel: "Refresh",
      action: "retry_probe",
    });
  });

  it("leaves no gate silent and actionless", () => {
    // The whole point of the slice: every state either shows a notice whose
    // action cures it, or leaves a control enabled that does.
    for (const gate of ALL_GATES) {
      const notice = resolveHomeModelGateNotice(gate);
      const availability = resolveHomeModelSelectorAvailability(gate);
      const pickerUsable = availability === "ready" || availability === "observed_empty";
      const inFlight = gate.kind === "blocked"
        && (gate.reason === "querying" || gate.reason === "observation_pending");
      const noTarget = gate.kind === "blocked" && gate.reason === "target_missing";
      expect(
        notice !== null || pickerUsable || inFlight || noTarget,
        `gate ${JSON.stringify(gate)} is silent with nothing to press`,
      ).toBe(true);
    }
  });

  it("resolves the residual to observation_idle rather than a query nobody is running", () => {
    // Nothing loading, nothing failed, nothing observed, and an all-unsupported
    // catalog that will never produce a model: the honest answer is "ask me".
    expect(resolveHomeModelGate(input({ agentReadiness: ["unsupported"] })))
      .toEqual({ kind: "blocked", reason: "observation_idle" });
  });

  it("reports agent_setup_required for every readiness the Agents pane can cure", () => {
    // The product's own `getAgentsNeedingSetup` rule: not ready, not
    // unsupported. `credentials_required` was missing before, which regressed
    // against main — those users used to get the notice and its Agents link.
    for (const readiness of [
      "install_required",
      "login_required",
      "credentials_required",
      "error",
    ] as const) {
      expect(resolveHomeModelGate(input({ agentReadiness: [readiness] })))
        .toEqual({ kind: "blocked", reason: "agent_setup_required" });
    }
    // `unsupported` is not setup and can never be cured, so it must not speak
    // for the catalog — one unsupported agent alongside working ones would
    // otherwise pin Home to a setup notice forever.
    for (const readiness of ["ready", "unsupported"] as const) {
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
      input({ observations: [observation({ state: "detecting", probePhase: "idle" })] }),
      input({ isCatalogLoading: true }),
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
      // The component's own expression, imported rather than restated, so the
      // assertion cannot quietly agree with a copy of the rule.
      const selectorEnabled = resolveModelSelectorEnabled({
        disabled: false,
        connectionState: "healthy",
        isLoading: false,
        hasAgents: true,
        availability,
      });
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
    expect(resolveHomeModelGateNotice({ kind: "blocked", reason: "observation_idle" }))
      .toEqual({
        text: "Models haven't been detected yet.",
        actionLabel: "Refresh",
        action: "retry_probe",
      });
    expect(resolveHomeModelGateNotice({ kind: "blocked", reason: "target_unobserved" }))
      .toEqual({
        text: "Proliferate Cloud hasn't reported launch options yet.",
        actionLabel: "Check again",
        action: "check_target_again",
      });
  });

  it("names a new probe as the cure for exactly the gate that promises one", () => {
    // The retry path reads THIS, so it cannot disagree with the arm that chose
    // the reason — which is how a Refresh got promised to states the retry
    // then answered with a re-read of the row that already said so.
    const needing = ALL_GATES.filter(homeModelGateNeedsNewProbe);
    expect(needing).toEqual([{ kind: "blocked", reason: "observation_idle" }]);
  });

  it("says a refused refresh instead of repeating a sentence that cannot change", () => {
    const rejected = resolveHomeModelGateNotice(
      { kind: "blocked", reason: "observation_idle" },
      { refreshRejected: true },
    );
    expect(rejected).toEqual({
      text: HOME_MODEL_GATE_REFRESH_REJECTED_NOTICE,
      actionLabel: "Refresh",
      action: "retry_probe",
    });
    expect(resolveHomeModelGateNotice(
      { kind: "blocked", reason: "observation_failed" },
      { refreshRejected: true },
    )?.text).toBe(HOME_MODEL_GATE_REFRESH_REJECTED_NOTICE);

    // A notice whose action never calls the mutation cannot be blamed for it.
    for (const reason of ["agent_setup_required", "transport_error", "target_unobserved"] as const) {
      const untouched = resolveHomeModelGateNotice({ kind: "blocked", reason });
      expect(resolveHomeModelGateNotice({ kind: "blocked", reason }, { refreshRejected: true }))
        .toEqual(untouched);
    }
    // And a silent gate stays silent.
    expect(resolveHomeModelGateNotice({ kind: "selection_required" }, { refreshRejected: true }))
      .toBeNull();
  });

  it("keeps the picker enabled for observed_empty and disabled for the failures", () => {
    expect(resolveHomeModelSelectorAvailability({ kind: "selection_required" })).toBe("ready");
    expect(resolveHomeModelSelectorAvailability({ kind: "blocked", reason: "observed_empty" }))
      .toBe("observed_empty");
    expect(resolveHomeModelSelectorAvailability({ kind: "blocked", reason: "observation_pending" }))
      .toBe("observation_pending");
    for (
      const reason of [
        "observation_failed",
        "transport_error",
        "target_unobserved",
        "observation_idle",
      ] as const satisfies readonly HomeModelGateBlockedReason[]
    ) {
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
