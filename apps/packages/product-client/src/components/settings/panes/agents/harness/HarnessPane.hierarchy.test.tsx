// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { makeTestProductHost } from "#product/test/product-host-test-utils";
import { HarnessPane } from "#product/components/settings/panes/agents/harness/HarnessPane";

const hierarchyTestHost = makeTestProductHost();

function renderHarnessPane(harnessKind = "claude") {
  // A per-render QueryClient: the native-bridge prompt reads the local
  // runtime through a react-query query (disabled here — no healthy runtime
  // connection in this suite — but the provider must exist to render).
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductHostProvider host={hierarchyTestHost}>
        <HarnessPane harnessKind={harnessKind} />
      </ProductHostProvider>
    </QueryClientProvider>,
  );
}

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
  // Consumed by the native-bridge prompt's query key (use-native-bridge.ts).
  useAnyHarnessCacheScopeKey: () => "test-scope",
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
  it("omits the redundant runtime status once the harness is configured", () => {
    const { container } = renderHarnessPane("claude");

    expect(container.querySelector('[data-harness-runtime-state="ready"]')).toBeNull();
    expect(screen.queryByText("Runtime")).toBeNull();
    expect(screen.getAllByText("Authentication")).toHaveLength(1);
    expect(
      screen.getByText("Anthropic's coding agent."),
    ).toBeTruthy();
  });

  it("preserves the agent-specific warning row when login is required", () => {
    const loginRequiredAgent = {
      ...readyAgent,
      readiness: "login_required",
    };
    readyCatalog.agentsByKind.set("claude", loginRequiredAgent);
    readyCatalog.agentsNeedingSetup = [loginRequiredAgent];

    const { container } = renderHarnessPane("claude");

    expect(container.querySelector('[data-harness-runtime-state="login_required"]')).not.toBeNull();
    expect(screen.getByText("Login required")).toBeTruthy();
    expect(screen.getByText("Sign in with Claude Code in Proliferate.")).toBeTruthy();
    expect(screen.getByText("Authentication")).toBeTruthy();
  });

  it("describes an unsupported harness without claiming it is installed", () => {
    readyCatalog.agentsByKind.set("claude", {
      ...readyAgent,
      readiness: "unsupported",
    });

    renderHarnessPane("claude");

    expect(screen.getByText("Unsupported")).toBeTruthy();
    expect(
      screen.getByText("This harness is not supported on this machine."),
    ).toBeTruthy();
    expect(screen.queryByText("Installed and available on this machine.")).toBeNull();
  });

  it("has no second Local or Workspace runtime selector", () => {
    renderHarnessPane("claude");

    expect(screen.queryByLabelText("Harness update target")).toBeNull();
    expect(screen.queryByText("Workspace")).toBeNull();
    expect(screen.queryByText("Installation and readiness on this machine.")).toBeNull();
    expect(
      screen.getByText("Anthropic's coding agent."),
    ).toBeTruthy();
  });

  it("replaces the pane with a full install gate when the harness is missing", () => {
    const onInstall = vi.fn();
    installState.action = {
      label: "Install Claude Code",
      loading: false,
      disabled: false,
      onInstall,
    };

    renderHarnessPane("claude");

    expect(screen.getByRole("button", { name: "Install Claude Code" })).toBeTruthy();
    expect(
      screen.getByText("Install Claude Code and its Proliferate adapter on this machine."),
    ).toBeTruthy();
    expect(screen.queryByText("Authentication")).toBeNull();
    expect(screen.queryByText("Runtime")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Install Claude Code" }));
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it("keeps the install gate compact while shared toast progress owns the details", () => {
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

    renderHarnessPane("claude");

    expect(screen.getByText("Installing Claude Code")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Installing Claude Code…" })).toBeTruthy();
    expect(screen.queryByText("This machine · 42 MB downloaded")).toBeNull();
    expect(screen.queryByText("Claude Code CLI")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText("Authentication")).toBeNull();
  });
});
