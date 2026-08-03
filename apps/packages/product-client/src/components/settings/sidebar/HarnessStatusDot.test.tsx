/* @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import type { AgentSummary } from "@anyharness/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessStatusDot } from "#product/components/settings/sidebar/HarnessStatusDot";

afterEach(cleanup);

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

function dot(summary: AgentSummary | undefined) {
  const { container } = render(<HarnessStatusDot agent={summary} />);
  return container.querySelector("span");
}

describe("HarnessStatusDot", () => {
  it("shows no dot for a ready harness (the dot means 'needs attention')", () => {
    expect(dot(agent())).toBeNull();
  });

  it("shows no dot for a route-upgraded ready harness, deliberately", () => {
    // Readiness is route-aware on every surface, so a gateway-routed harness
    // with no vendor-CLI login reads "ready". It launches fine, so flagging it
    // would ask the user to fix a non-problem — the exact lie
    // agent-distribution.md's route-aware law forbids. The "authenticated how?"
    // detail lives in the harness auth pane, not in an attention dot.
    expect(dot(agent({ credentialsFromRoute: true }))).toBeNull();
  });

  it("still flags a harness whose credentials are genuinely missing", () => {
    const warning = dot(agent({ credentialState: "login_required", readiness: "login_required" }));
    expect(warning?.className).toContain("bg-warning-foreground");
  });

  it("still flags a failed install as an error", () => {
    const failed = dot(agent({ installState: "failed", readiness: "error" }));
    expect(failed?.className).toContain("bg-destructive");
  });

  it("shows nothing before install and nothing without a record", () => {
    expect(dot(agent({ installState: "install_required", readiness: "install_required" }))).toBeNull();
    expect(dot(undefined)).toBeNull();
  });
});
