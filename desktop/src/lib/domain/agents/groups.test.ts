import { describe, expect, it } from "vitest";
import type { AgentSummary, ReconcileAgentResult } from "@anyharness/sdk";
import {
  classifyAgent,
  getAgentGroupBadgeTone,
} from "@/lib/domain/agents/groups";

function buildAgent(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    kind: "claude",
    name: "Claude",
    displayName: "Claude",
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

describe("classifyAgent", () => {
  it("places setup-required agents in needs setup", () => {
    expect(
      classifyAgent(buildAgent({ readiness: "install_required" })),
    ).toBe("needs_setup");
    expect(
      classifyAgent(buildAgent({ readiness: "credentials_required" })),
    ).toBe("needs_setup");
    expect(
      classifyAgent(buildAgent({ readiness: "login_required" })),
    ).toBe("needs_setup");
  });

  it("keeps installing agents in needs setup", () => {
    expect(
      classifyAgent(
        buildAgent({
          readiness: "install_required",
          installState: "installing",
        }),
      ),
    ).toBe("needs_setup");
  });

  it("places ready agents in configured", () => {
    expect(
      classifyAgent(buildAgent({ readiness: "ready" })),
    ).toBe("configured");
  });

  it("places unsupported and error agents in unavailable", () => {
    expect(
      classifyAgent(buildAgent({ readiness: "unsupported" })),
    ).toBe("unavailable");
    expect(
      classifyAgent(buildAgent({ readiness: "error" })),
    ).toBe("unavailable");
  });

  it("places failed reconciliation results in unavailable", () => {
    expect(
      classifyAgent(
        buildAgent({ readiness: "install_required" }),
        buildReconcileResult({ outcome: "failed" }),
      ),
    ).toBe("unavailable");
  });
});

describe("getAgentGroupBadgeTone", () => {
  it("normalizes normal semantic tones to neutral for grouped agent rows", () => {
    expect(getAgentGroupBadgeTone("configured", "success")).toBe("neutral");
    expect(getAgentGroupBadgeTone("needs_setup", "warning")).toBe("neutral");
    expect(getAgentGroupBadgeTone("needs_setup", "muted")).toBe("neutral");
  });

  it("uses destructive only for unavailable groups or destructive statuses", () => {
    expect(getAgentGroupBadgeTone("unavailable", "muted")).toBe("destructive");
    expect(getAgentGroupBadgeTone("needs_setup", "destructive")).toBe("destructive");
  });
});
