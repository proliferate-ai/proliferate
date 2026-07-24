import { describe, expect, it } from "vitest";
import type { AgentSummary, ReconcileAgentResult } from "@anyharness/sdk";
import { getAgentStatusDisplay } from "#product/lib/domain/agents/status-presentation";

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
