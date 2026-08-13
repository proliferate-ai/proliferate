import { describe, expect, it } from "vitest";
import type { AgentSummary, ReconcileAgentResult } from "@anyharness/sdk";
import {
  getAgentStatusDisplay,
  getHarnessAttentionDotTone,
} from "#product/lib/domain/agents/status-presentation";

function buildAgent(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    kind: "claude",
    name: "Claude",
    description: "Anthropic Claude",
    readiness: "install_required",
    installState: "install_required",
    credentialState: "not_configured",
    message: null,
    supportsLogin: false,
    expectedEnvVars: [],
    loginCommand: null,
    docsUrl: null,
    ...overrides,
  } as AgentSummary;
}

function buildReconcileResult(
  overrides: Partial<ReconcileAgentResult> = {},
): ReconcileAgentResult {
  return {
    kind: "claude",
    outcome: "failed",
    message: null,
    ...overrides,
  } as ReconcileAgentResult;
}

describe("getAgentStatusDisplay", () => {
  it("keeps just-installed as a success semantic status", () => {
    const status = getAgentStatusDisplay(
      buildAgent({ readiness: "ready" }),
      { reconcileResult: buildReconcileResult({ outcome: "installed" }) },
    );

    expect(status).toEqual({
      label: "Just installed",
      tone: "success",
    });
  });

  it("keeps ready agents as a success semantic status", () => {
    const status = getAgentStatusDisplay(buildAgent({ readiness: "ready" }));

    expect(status).toEqual({
      label: "Configured",
      tone: "success",
    });
  });

  it("keeps failed reconciliation as a destructive semantic status", () => {
    const status = getAgentStatusDisplay(
      buildAgent({ readiness: "install_required" }),
      { reconcileResult: buildReconcileResult({ outcome: "failed" }) },
    );

    expect(status).toEqual({
      label: "Install failed",
      tone: "destructive",
    });
  });

  it("shows installing only for the agent currently installing", () => {
    const status = getAgentStatusDisplay(
      buildAgent({ installState: "installing" }),
      { isReconciling: true },
    );

    expect(status).toEqual({
      label: "Installing...",
      tone: "muted",
    });
  });

  it("does not show every setup-needed agent as installing during reconcile", () => {
    const status = getAgentStatusDisplay(
      buildAgent({
        readiness: "install_required",
        installState: "install_required",
      }),
      { isReconciling: true },
    );

    expect(status).toEqual({
      label: "Install required",
      tone: "warning",
    });
  });
});

describe("getHarnessAttentionDotTone", () => {
  it("shows nothing without a record", () => {
    expect(getHarnessAttentionDotTone(undefined)).toBeNull();
  });

  it("shows nothing before install", () => {
    expect(getHarnessAttentionDotTone(
      buildAgent({ installState: "install_required", readiness: "install_required" }),
    )).toBeNull();
  });

  it("shows no dot for a ready harness (the dot means 'needs attention')", () => {
    expect(getHarnessAttentionDotTone(
      buildAgent({ credentialState: "ready", installState: "installed", readiness: "ready" }),
    )).toBeNull();
  });

  it("still flags a harness whose credentials are genuinely missing", () => {
    expect(getHarnessAttentionDotTone(
      buildAgent({ installState: "installed", credentialState: "login_required", readiness: "login_required" }),
    )).toBe("warning");
    expect(getHarnessAttentionDotTone(
      buildAgent({ installState: "installed", credentialState: "missing_env", readiness: "credentials_required" }),
    )).toBe("warning");
  });

  it("still flags a failed install as an error, even with ready credentials", () => {
    expect(getHarnessAttentionDotTone(
      buildAgent({ credentialState: "ready", installState: "failed", readiness: "error" }),
    )).toBe("danger");
  });

  it("falls back to danger for any other unresolved credential state", () => {
    expect(getHarnessAttentionDotTone(
      buildAgent({ credentialState: "not_configured", installState: "installed", readiness: "error" }),
    )).toBe("danger");
  });
});
