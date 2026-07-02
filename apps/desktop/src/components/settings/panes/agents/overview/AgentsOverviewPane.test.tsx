// @vitest-environment jsdom

import type { AgentSummary } from "@anyharness/sdk";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentsOverviewPane } from "./AgentsOverviewPane";

const catalogState = vi.hoisted(() => ({
  agents: [] as AgentSummary[],
  isLoading: false,
  isReconciling: false,
}));
const connectionStore = vi.hoisted(() => ({
  connectionState: "healthy",
  error: null as string | null,
}));
const reconcileAgents = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const showToast = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => catalogState,
}));
vi.mock("@/hooks/agents/workflows/use-agent-installation-actions", () => ({
  useAgentInstallationActions: () => ({ reconcileAgents }),
}));
vi.mock("@/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (
    selector: (state: typeof connectionStore) => unknown,
  ) => selector(connectionStore),
}));
vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (
    selector: (state: { show: typeof showToast }) => unknown,
  ) => selector({ show: showToast }),
}));

function agent(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    kind: "claude",
    displayName: "Claude Code",
    agentProcess: { installed: true, role: "agent", version: "1.6.2" },
    credentialState: "ready",
    installState: "installed",
    expectedEnvVars: [],
    nativeRequired: false,
    readiness: "ready",
    supportsLogin: true,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  catalogState.agents = [];
  catalogState.isLoading = false;
  catalogState.isReconciling = false;
  connectionStore.connectionState = "healthy";
  connectionStore.error = null;
});

describe("AgentsOverviewPane", () => {
  it("renders one row per installed harness with meta and status badge", () => {
    catalogState.agents = [
      agent(),
      agent({
        kind: "codex",
        displayName: "Codex",
        agentProcess: { installed: true, role: "agent", version: "0.9.0" },
        credentialState: "login_required",
        readiness: "login_required",
      }),
      agent({
        kind: "grok",
        displayName: "Grok CLI",
        installState: "install_required",
        readiness: "install_required",
      }),
    ];
    render(<AgentsOverviewPane onSelectSection={vi.fn()} />);

    expect(screen.queryByText("Claude Code")).not.toBeNull();
    expect(screen.queryByText("claude · v1.6.2")).not.toBeNull();
    expect(screen.queryByText("Ready")).not.toBeNull();
    expect(screen.queryByText("Codex")).not.toBeNull();
    expect(screen.queryByText("Login required")).not.toBeNull();
    expect(screen.queryByText("Grok CLI")).toBeNull();
  });

  it("navigates to the harness's own settings section when a row is clicked", () => {
    const onSelectSection = vi.fn();
    catalogState.agents = [agent()];
    render(<AgentsOverviewPane onSelectSection={onSelectSection} />);

    fireEvent.click(screen.getByRole("button", { name: /Claude Code/ }));

    expect(onSelectSection).toHaveBeenCalledWith("agent-claude");
  });

  it("renders harnesses without their own settings page as static rows", () => {
    const onSelectSection = vi.fn();
    catalogState.agents = [agent({ kind: "cursor", displayName: "Cursor" })];
    render(<AgentsOverviewPane onSelectSection={onSelectSection} />);

    expect(screen.queryByText("Cursor")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Cursor/ })).toBeNull();
  });

  it("re-runs the local reconcile from the header refresh action", () => {
    catalogState.agents = [agent()];
    render(<AgentsOverviewPane onSelectSection={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(reconcileAgents).toHaveBeenCalledTimes(1);
  });

  it("shows the install gate when no harness is installed", () => {
    catalogState.agents = [
      agent({ installState: "install_required", readiness: "install_required" }),
    ];
    render(<AgentsOverviewPane onSelectSection={vi.fn()} />);

    expect(screen.queryByText("No agents installed")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Check for installs" }));

    expect(reconcileAgents).toHaveBeenCalledTimes(1);
  });
});
