// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessPane } from "#product/components/settings/panes/agents/harness/HarnessPane";

const readyAgent = {
  kind: "claude",
  displayName: "Claude Code",
  readiness: "ready",
  supportsLogin: true,
};

const readyCatalog = {
  agentsByKind: new Map([["claude", readyAgent]]),
  agentsNeedingSetup: [],
  isError: false,
  isLoading: false,
  isReconciling: false,
  reconcileSnapshot: null,
};

vi.mock("@anyharness/sdk-react", () => ({
  useAnyHarnessRuntimeContext: () => ({ runtimeUrl: "http://127.0.0.1:8457" }),
  useAnyHarnessWorkspaceContext: () => ({ workspaceId: null }),
}));

vi.mock("#product/stores/ui/agent-surface-store", () => ({
  useAgentSurfaceStore: (
    selector: (state: { surface: "local" }) => unknown,
  ) => selector({ surface: "local" }),
}));

vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => readyCatalog,
}));

vi.mock("#product/hooks/agents/derived/use-workspace-agent-catalog", () => ({
  useWorkspaceAgentCatalog: () => readyCatalog,
}));

vi.mock("#product/hooks/agents/workflows/use-harness-install-action", () => ({
  useHarnessInstallAction: () => null,
}));

vi.mock("#product/hooks/agents/workflows/use-harness-auth-editor", () => ({
  useHarnessAuthEditor: () => ({}),
}));

vi.mock("#product/components/settings/panes/agents/harness/HarnessAuthSection", () => ({
  deriveSelectedMethod: () => "cli",
  HarnessAuthSection: () => <h2>Authentication</h2>,
}));

vi.mock("#product/components/settings/panes/agents/harness/HarnessAuthDetailsSection", () => ({
  HarnessAuthDetailsSection: () => null,
}));

vi.mock("#product/components/settings/panes/agents/harness/HarnessSettingsSection", () => ({
  HarnessSettingsSection: () => null,
}));

vi.mock("#product/components/settings/panes/agents/harness/HarnessAllModelsSection", () => ({
  HarnessAllModelsSection: () => null,
}));

afterEach(() => {
  cleanup();
  readyCatalog.agentsByKind.set("claude", readyAgent);
});

describe("HarnessPane visual hierarchy", () => {
  it("presents runtime status before a single authentication heading", () => {
    const { container } = render(<HarnessPane harnessKind="claude" />);
    const runtime = container.querySelector('[data-harness-runtime-state="ready"]');
    const authentication = screen.getByText("Authentication");

    expect(runtime).not.toBeNull();
    if (!runtime) throw new Error("Expected the ready runtime row.");
    expect(screen.getAllByText("Authentication")).toHaveLength(1);
    expect(
      runtime.compareDocumentPosition(authentication) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByText("Configure how Claude Code runs and authenticates on this machine."),
    ).toBeTruthy();
  });

  it("describes an unsupported harness without claiming it is installed", () => {
    readyCatalog.agentsByKind.set("claude", {
      ...readyAgent,
      readiness: "unsupported",
    });

    render(<HarnessPane harnessKind="claude" />);

    expect(screen.getByText("Unsupported")).toBeTruthy();
    expect(
      screen.getByText("This harness is not supported on Local runtime."),
    ).toBeTruthy();
    expect(screen.queryByText("Installed and available on Local runtime.")).toBeNull();
  });
});
