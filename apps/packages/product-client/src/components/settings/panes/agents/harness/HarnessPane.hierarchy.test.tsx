// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  agentsNeedingSetup: [] as Array<typeof readyAgent>,
  isError: false,
  isLoading: false,
  isReconciling: false,
  reconcileSnapshot: null as null | {
    progress: {
      components: Array<{
        agent: string;
        role: "native_cli" | "agent_process";
        phase: "downloading" | "queued";
        downloadedBytes: number;
        downloadSizeBytes: number | null;
      }>;
    };
  },
};

const installState = vi.hoisted(() => ({
  action: null as null | {
    label: string;
    loading: boolean;
    disabled: boolean;
    onInstall: () => void;
  },
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAnyHarnessRuntimeContext: () => ({ runtimeUrl: "http://127.0.0.1:8457" }),
}));

vi.mock("#product/stores/ui/agent-surface-store", () => ({
  useAgentSurfaceStore: (
    selector: (state: { surface: "local" }) => unknown,
  ) => selector({ surface: "local" }),
}));

vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => readyCatalog,
}));

vi.mock("#product/hooks/agents/workflows/use-harness-install-action", () => ({
  useHarnessInstallAction: () => installState.action,
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
  readyCatalog.agentsNeedingSetup = [];
  readyCatalog.isReconciling = false;
  readyCatalog.reconcileSnapshot = null;
  installState.action = null;
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
      screen.getByText("This harness is not supported on this machine."),
    ).toBeTruthy();
    expect(screen.queryByText("Installed and available on this machine.")).toBeNull();
  });

  it("has no second Local or Workspace runtime selector", () => {
    render(<HarnessPane harnessKind="claude" />);

    expect(screen.queryByLabelText("Harness update target")).toBeNull();
    expect(screen.queryByText("Workspace")).toBeNull();
    expect(screen.getByText("Installation and readiness on this machine.")).toBeTruthy();
  });

  it("replaces the pane with a full install gate when the harness is missing", () => {
    const onInstall = vi.fn();
    installState.action = {
      label: "Install Claude Code",
      loading: false,
      disabled: false,
      onInstall,
    };

    render(<HarnessPane harnessKind="claude" />);

    expect(screen.getByRole("button", { name: "Install Claude Code" })).toBeTruthy();
    expect(
      screen.getByText("Install Claude Code and its Proliferate adapter on this machine."),
    ).toBeTruthy();
    expect(screen.queryByText("Authentication")).toBeNull();
    expect(screen.queryByText("Runtime")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Install Claude Code" }));
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it("keeps real component progress in the full install gate", () => {
    readyCatalog.isReconciling = true;
    readyCatalog.reconcileSnapshot = {
      progress: {
        components: [{
          agent: "claude",
          role: "native_cli",
          phase: "downloading",
          downloadedBytes: 42_000_000,
          downloadSizeBytes: 100_000_000,
        }, {
          agent: "claude",
          role: "agent_process",
          phase: "queued",
          downloadedBytes: 0,
          downloadSizeBytes: null,
        }],
      },
    };

    render(<HarnessPane harnessKind="claude" />);

    expect(screen.getByText("Installing Claude Code")).toBeTruthy();
    expect(screen.getByText("This machine · 42 MB downloaded")).toBeTruthy();
    expect(screen.getByText("Claude Code CLI")).toBeTruthy();
    expect(screen.getByRole("progressbar", {
      name: "Claude Code CLI download progress",
    })).toBeTruthy();
    expect(screen.queryByText("Authentication")).toBeNull();
  });
});
