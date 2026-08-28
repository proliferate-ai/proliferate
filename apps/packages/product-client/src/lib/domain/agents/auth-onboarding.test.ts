import { describe, expect, it } from "vitest";
import type { AgentSummary } from "@anyharness/sdk";
import {
  hasDetectedNativeAuth,
  planFirstRunAuthAdoption,
  resolveAgentAuthDisplay,
} from "#product/lib/domain/agents/auth-onboarding";

function agent(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    kind: "claude",
    displayName: "Claude Code",
    agentProcess: { state: "ready" },
    credentialState: "ready",
    expectedEnvVars: [],
    installState: "installed",
    nativeRequired: false,
    readiness: "ready",
    supportsLogin: true,
    ...overrides,
  } as AgentSummary;
}

describe("hasDetectedNativeAuth", () => {
  it("detects installed agents with ready credentials", () => {
    expect(hasDetectedNativeAuth(agent())).toBe(true);
  });

  it("rejects agents that still need login or install", () => {
    expect(
      hasDetectedNativeAuth(agent({ credentialState: "login_required" })),
    ).toBe(false);
    expect(
      hasDetectedNativeAuth(
        agent({ installState: "install_required", readiness: "install_required" }),
      ),
    ).toBe(false);
  });

  it("rejects readiness that comes from an enrolled route, not a local credential", () => {
    // Readiness is route-aware on every surface, so a gateway-routed harness
    // reports credentialState "ready" with no vendor-CLI login. That is not
    // NATIVE auth and must not be read as such.
    expect(hasDetectedNativeAuth(agent({ credentialsFromRoute: true }))).toBe(
      false,
    );
  });

  it("treats an absent provenance flag as native (older runtimes were native-only)", () => {
    const { credentialsFromRoute: _omitted, ...withoutFlag } = agent();
    expect(hasDetectedNativeAuth(withoutFlag as AgentSummary)).toBe(true);
  });
});

describe("resolveAgentAuthDisplay", () => {
  it("shows the loading gate for a not-yet-loaded record instead of auth controls", () => {
    expect(resolveAgentAuthDisplay(null, true)).toBe("loading");
  });

  it("shows the install gate for a missing record once loading has finished", () => {
    expect(resolveAgentAuthDisplay(null, false)).toBe("install-gate");
  });

  it("shows the install gate when the local agent still needs installing", () => {
    expect(
      resolveAgentAuthDisplay(
        agent({ installState: "install_required", readiness: "install_required" }),
        false,
      ),
    ).toBe("install-gate");
  });

  it("shows auth controls only for a present, installed record", () => {
    expect(resolveAgentAuthDisplay(agent(), false)).toBe("auth-controls");
  });
});

describe("planFirstRunAuthAdoption", () => {
  it("adopts the gateway ONLY for the non-native installed agents when credentials are mixed (THE BUG CASE)", () => {
    // Regression guard for the fixed bug: adoption used to early-return []
    // for the WHOLE list the moment any single agent had detected native
    // auth. Per AGENT_AUTH.md ("adopts the gateway for harnesses without
    // native logins"), each harness must decide independently — one
    // harness's native login must not suppress adoption for the others.
    const actions = planFirstRunAuthAdoption({
      agents: [
        agent({ kind: "claude" }), // native — excluded
        agent({ kind: "codex" }), // native — excluded
        agent({ kind: "grok", credentialState: "login_required" }), // not native, installed — adopts
        // not native, but NOT installed — excluded within the same mixed
        // scenario (install exclusion must hold alongside native exclusion).
        agent({
          kind: "opencode",
          credentialState: "login_required",
          installState: "install_required",
          readiness: "install_required",
        }),
      ],
      selectionCount: 0,
      gatewayEnabled: true,
    });

    expect(actions).toEqual([{ harnessKind: "grok", surface: "local" }]);
  });

  it("writes nothing when every installed agent already has native credentials (all-native)", () => {
    const actions = planFirstRunAuthAdoption({
      agents: [agent({ kind: "claude" }), agent({ kind: "codex" })],
      selectionCount: 0,
      gatewayEnabled: true,
    });

    expect(actions).toEqual([]);
  });

  it("is a no-op when any selection already exists", () => {
    const actions = planFirstRunAuthAdoption({
      agents: [agent({ kind: "claude", credentialState: "login_required" })],
      selectionCount: 1,
      gatewayEnabled: true,
    });

    expect(actions).toEqual([]);
  });

  it("preselects the gateway for EVERY installed harness when nothing is detected, excluding not-installed/install-required agents", () => {
    const actions = planFirstRunAuthAdoption({
      agents: [
        agent({ kind: "claude", credentialState: "login_required" }),
        agent({ kind: "grok", credentialState: "login_required" }),
        agent({
          kind: "codex",
          credentialState: "unknown",
          installState: "install_required",
          readiness: "install_required",
        }),
        // Genuinely NOT installed (distinct from "install_required" above) —
        // still excluded, since the filter only admits installState==="installed".
        agent({
          kind: "opencode",
          credentialState: "unknown",
          installState: "failed",
          readiness: "install_required",
        }),
      ],
      selectionCount: 0,
      gatewayEnabled: true,
    });

    expect(actions).toEqual([
      { harnessKind: "claude", surface: "local" },
      { harnessKind: "grok", surface: "local" },
    ]);
  });

  it("still preselects the gateway when the only 'ready' harness is route-upgraded", () => {
    // Regression guard for the route-aware readiness read: a harness that reads
    // "ready" because a route supplies its credentials is NOT detected native
    // auth, so it must not suppress gateway preselection for the rest. Before
    // the provenance flag this returned [] and silently disabled first-run
    // adoption for every harness on the machine.
    const actions = planFirstRunAuthAdoption({
      agents: [
        agent({ kind: "claude", credentialsFromRoute: true }),
        agent({ kind: "codex", credentialState: "login_required" }),
      ],
      selectionCount: 0,
      gatewayEnabled: true,
    });

    expect(actions).toEqual([
      { harnessKind: "claude", surface: "local" },
      { harnessKind: "codex", surface: "local" },
    ]);
  });

  it("still adopts the gateway for the routed harness even when a different harness is genuinely native", () => {
    // The other direction: a genuine native login on one harness (codex)
    // must not suppress adoption for a route-ready harness (claude) that is
    // NOT natively authed. Per-harness independence cuts both ways.
    const actions = planFirstRunAuthAdoption({
      agents: [
        agent({ kind: "claude", credentialsFromRoute: true }),
        agent({ kind: "codex" }),
      ],
      selectionCount: 0,
      gatewayEnabled: true,
    });

    expect(actions).toEqual([{ harnessKind: "claude", surface: "local" }]);
  });

  // A-R1: gateway-capability guard. cursor is single-source with only a
  // "cursor" auth slot — no gateway recipe exists for it (agent-auth.md's
  // per-harness recipe table; server-side selection_rules.py fails closed
  // with "Harness 'cursor' has no gateway recipe"). Adoption must never hand
  // a harness a gateway action it cannot service, mirroring the settings
  // write path's isGatewayCapableHarness guard in buildDesiredSources.
  it("does not adopt cursor even when it is the only non-native installed agent (mixed credentials)", () => {
    const actions = planFirstRunAuthAdoption({
      agents: [
        agent({ kind: "claude" }), // native — excluded
        agent({ kind: "cursor", credentialState: "login_required" }), // not native, installed, NOT gateway-capable — excluded
      ],
      selectionCount: 0,
      gatewayEnabled: true,
    });

    expect(actions).toEqual([]);
  });

  it("adopts only the gateway-capable non-native installed agent alongside cursor", () => {
    const actions = planFirstRunAuthAdoption({
      agents: [
        agent({ kind: "cursor", credentialState: "login_required" }), // not native, NOT gateway-capable — excluded
        agent({ kind: "grok", credentialState: "login_required" }), // not native, gateway-capable — adopts
      ],
      selectionCount: 0,
      gatewayEnabled: true,
    });

    expect(actions).toEqual([{ harnessKind: "grok", surface: "local" }]);
  });

  it("excludes cursor from a zero-native machine while still adopting the other installed harnesses", () => {
    const actions = planFirstRunAuthAdoption({
      agents: [
        agent({ kind: "cursor", credentialState: "login_required" }),
        agent({ kind: "claude", credentialState: "login_required" }),
        agent({ kind: "codex", credentialState: "login_required" }),
      ],
      selectionCount: 0,
      gatewayEnabled: true,
    });

    expect(actions).toEqual([
      { harnessKind: "claude", surface: "local" },
      { harnessKind: "codex", surface: "local" },
    ]);
  });

  it("does nothing when nothing is detected and the gateway is disabled", () => {
    const actions = planFirstRunAuthAdoption({
      agents: [agent({ kind: "claude", credentialState: "login_required" })],
      selectionCount: 0,
      gatewayEnabled: false,
    });

    expect(actions).toEqual([]);
  });
});
