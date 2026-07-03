import { describe, expect, it } from "vitest";
import type { AgentSummary } from "@anyharness/sdk";
import {
  hasDetectedNativeAuth,
  planFirstRunAuthAdoption,
  resolveAgentAuthDisplay,
} from "./auth-onboarding";

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
  it("writes nothing when native creds are detected (native is implicit)", () => {
    const actions = planFirstRunAuthAdoption({
      agents: [
        agent({ kind: "claude" }),
        agent({ kind: "codex" }),
        agent({ kind: "grok", credentialState: "login_required" }),
      ],
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

  it("preselects the gateway for installed harnesses when nothing is detected", () => {
    const actions = planFirstRunAuthAdoption({
      agents: [
        agent({ kind: "claude", credentialState: "login_required" }),
        agent({
          kind: "codex",
          credentialState: "unknown",
          installState: "install_required",
          readiness: "install_required",
        }),
      ],
      selectionCount: 0,
      gatewayEnabled: true,
    });

    expect(actions).toEqual([
      { harnessKind: "claude", surface: "local" },
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
