import { describe, expect, it } from "vitest";
import type { AgentSummary, ReconcileAgentResult } from "@anyharness/sdk";
import {
  getAgentDetailText,
  getAgentStatusDisplay,
} from "@/lib/domain/agents/status-presentation";

function buildAgent(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    kind: "claude",
    name: "Claude",
    description: "Anthropic Claude",
    readiness: "install_required",
    installState: "not_installed",
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

describe("getAgentDetailText", () => {
  it("prefers failed reconcile messages over generic helper copy", () => {
    const detail = getAgentDetailText(
      buildAgent({
        supportsLogin: true,
        expectedEnvVars: ["ANTHROPIC_API_KEY"],
      }),
      buildReconcileResult({
        message: "npm not found while installing Claude",
      }),
    );

    expect(detail).toBe("npm not found while installing Claude");
  });

  it("falls back to the agent message when the agent is not ready", () => {
    const detail = getAgentDetailText(
      buildAgent({
        readiness: "credentials_required",
        message: "Credentials are missing for Claude.",
      }),
    );

    expect(detail).toBe("Credentials are missing for Claude.");
  });

  it("uses the no-credentials copy when setup is otherwise self-contained", () => {
    const detail = getAgentDetailText(
      buildAgent({
        readiness: "install_required",
        supportsLogin: false,
        expectedEnvVars: [],
        message: null,
      }),
    );

    expect(detail).toBe("No additional credentials are required.");
  });
});

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
});
