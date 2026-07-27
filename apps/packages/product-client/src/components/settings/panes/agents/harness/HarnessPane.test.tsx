// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { makeTestProductHost } from "#product/test/product-host-test-utils";
import { HarnessPane } from "#product/components/settings/panes/agents/harness/HarnessPane";

// Anonymous host keeps the organizations query disabled, matching the prior
// unset-auth-store default these tests ran under.
const harnessTestHost = makeTestProductHost();

type CapabilitiesData = {
  gatewayEnabled: boolean;
  publicBaseUrl: string | null;
  enrollmentStatus: string;
};

type LocalAgent = {
  kind: string;
  displayName: string;
  readiness: string;
  supportsLogin: boolean;
};

const state = vi.hoisted(() => ({
  cloudActive: true,
  authStatus: "authenticated" as "authenticated" | "anonymous" | "loading",
  agentSurface: "local" as "cloud" | "local",
  capabilities: {
    data: {
      gatewayEnabled: true,
      publicBaseUrl: "https://gateway.example",
      enrollmentStatus: "synced",
    } as CapabilitiesData | undefined,
  },
  enrollment: {
    data: undefined as
      | { syncStatus: string; lastErrorCode: string | null }
      | undefined,
  },
  selections: {
    data: [] as Array<Record<string, unknown>> | undefined,
    isLoading: false,
  },
  apiKeys: {
    data: [] as Array<Record<string, unknown>> | undefined,
  },
  agentModels: {
    data: undefined as
      | {
        harnessKind: string;
        models: Array<Record<string, unknown>>;
        modes: Array<Record<string, unknown>>;
        snapshotId: string | null;
        probedAt: string | null;
        origin: string | null;
        overrideApplied: boolean;
      }
      | undefined,
    isLoading: false,
  },
  agentsByKind: new Map<string, LocalAgent>(),
  loginSessions: {} as Record<string, {
    kind: string;
    terminal: Record<string, unknown> | null;
    errorMessage: string | null;
    isStarting: boolean;
  }>,
  modelSnapshotStatus: {
    data: undefined as Record<string, unknown> | undefined,
    isLoading: false,
  },
  launchOptions: {
    data: undefined as
      | {
        agents: Array<{
          kind: string;
          displayName: string;
          defaultModelId: string | null;
          models: Array<{
            id: string;
            displayName: string;
            aliases?: string[];
            isDefault: boolean;
          }>;
        }>;
      }
      | undefined,
    isLoading: false,
  },
}));
const putMutate = vi.hoisted(() => vi.fn());
const createKeyMutate = vi.hoisted(() => vi.fn());
const overrideMutate = vi.hoisted(() => vi.fn());
const refreshModelSnapshotMutate = vi.hoisted(() => vi.fn());
const openAuthTerminal = vi.hoisted(() => vi.fn());
const closeAuthTerminal = vi.hoisted(() => vi.fn());
const handleTerminalExit = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentGatewayCapabilities: () => state.capabilities,
  useAgentGatewayEnrollment: () => state.enrollment,
  useAuthSelections: () => state.selections,
  useAgentApiKeys: () => state.apiKeys,
  useAgentModels: () => state.agentModels,
  useAgentAuthState: () => ({ data: undefined, isLoading: false }),
  useOrgAgentPolicy: () => ({ data: undefined, isLoading: false }),
  usePutAuthSelections: () => ({ mutate: putMutate, isPending: false }),
  useCreateAgentApiKey: () => ({ mutate: createKeyMutate, isPending: false }),
  useUpsertAgentModelOverride: () => ({ mutate: overrideMutate, isPending: false }),
}));

// The local surface reads the RUNTIME's composed observation
// (model-catalog.md "The picker is the observation") — mock the anyharness
// SDK hooks standing in for that runtime call.
vi.mock("@anyharness/sdk-react", () => ({
  useAnyHarnessRuntimeContext: () => ({ runtimeUrl: "http://127.0.0.1:8457" }),
  // Pre-first-observation seed: the runtime's resolved launch catalog (the
  // session model picker's data source) — mock stands in for that runtime read.
  useAgentLaunchOptionsQuery: () => state.launchOptions,
  // The composed observation (one status document per harness): an absent
  // document keeps HarnessAllModelsSection on the unverified seed path.
  useModelSnapshotStatusQuery: () => state.modelSnapshotStatus,
  // The param-less manual-refresh poke.
  useRefreshModelSnapshotMutation: () => ({
    mutate: refreshModelSnapshotMutate,
    isPending: false,
  }),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (s: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast }),
}));

// ModalShell (Radix Dialog) has no jsdom polyfills here — stub the picker to a
// deterministic button that fires onSelect when the modal is open.
vi.mock("./ProviderPickerModal", () => ({
  ProviderPickerModal: ({
    open,
    onSelect,
    onClose,
  }: {
    open: boolean;
    onSelect: (provider: { id: string; displayName: string; envVarNames: string[] }) => void;
    onClose: () => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          onSelect({
            id: "openrouter",
            displayName: "OpenRouter",
            envVarNames: ["OPENROUTER_API_KEY"],
          });
          onClose();
        }}
      >
        pick-openrouter
      </button>
    ) : null,
}));

// Stub ApiKeyCreatorModal: when open, renders a deterministic button that
// fires onSubmit with a fixture key. This exercises the create+bind flow
// without needing Radix Dialog jsdom polyfills.
vi.mock("#product/components/settings/panes/agent-auth/ApiKeyCreatorModal", () => ({
  ApiKeyCreatorModal: ({
    open,
    onClose,
    onSubmit,
    envVarField,
  }: {
    open: boolean;
    onClose: () => void;
    onSubmit: (input: { title: string; value: string; envVarName: string }) => void;
    envVarField?: { initialValue?: string };
  }) =>
    open ? (
      <div data-testid="add-key-modal">
        <button
          type="button"
          onClick={() =>
            onSubmit({
              title: "Test key",
              value: "sk-test-value",
              envVarName: envVarField?.initialValue ?? "TEST_KEY",
            })}
        >
          submit-add-key
        </button>
        <button type="button" onClick={onClose}>
          cancel-add-key
        </button>
      </div>
    ) : null,
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({
    authStatus: state.authStatus,
    cloudEnabled: true,
    cloudActive: state.cloudActive,
    cloudSignInChecking: false,
    // When cloud is inactive the CloudGuard should fall through to the
    // sign-in-required pane (sign-in is available), matching the real hook.
    cloudSignInAvailable: state.authStatus !== "authenticated",
  }),
}));

vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({ agentsByKind: state.agentsByKind, agentsNeedingSetup: [], isError: false, isLoading: false, isReconciling: false, reconcileSnapshot: null }),
}));
vi.mock("#product/hooks/agents/workflows/use-harness-install-action", () => ({
  useHarnessInstallAction: () => null,
}));
vi.mock("#product/providers/CloudAnyHarnessRuntimeProvider", () => ({ CloudAnyHarnessRuntimeProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("#product/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (selector: (s: { runtimeUrl: string }) => unknown) =>
    selector({ runtimeUrl: "http://127.0.0.1:8457" }),
}));

vi.mock("#product/hooks/access/anyharness/agents/use-agent-resources-cache", () => ({
  useAgentResourcesCache: () => ({
    invalidateAgentListResources: vi.fn().mockResolvedValue(undefined),
    invalidateAgentSetupResources: vi.fn().mockResolvedValue(undefined),
    invalidateAgentLaunchReadinessResources: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("#product/hooks/agents/workflows/use-agent-login-terminal-workflow", () => ({
  useAgentLoginTerminalWorkflow: () => ({
    sessionsByKind: state.loginSessions,
    runtimeConnection: { baseUrl: "http://127.0.0.1:8457", authToken: undefined },
    openAuthTerminal,
    closeAuthTerminal,
    handleTerminalExit,
  }),
}));

vi.mock("#product/components/agents/AgentLoginTerminalPanel", () => ({
  AgentLoginTerminalPanel: () => <div data-testid="login-terminal" />,
}));

vi.mock("#product/stores/ui/agent-surface-store", () => ({
  useAgentSurfaceStore: (selector: (s: { surface: "cloud" | "local"; setSurface: (v: "cloud" | "local") => void }) => unknown) =>
    selector({
      surface: state.agentSurface,
      setSurface: (value: "cloud" | "local") => {
        state.agentSurface = value;
      },
    }),
}));

function renderPane(harnessKind = "claude") {
  const queryClient = new QueryClient({ defaultOptions: {
    queries: { retry: false }, mutations: { retry: false },
  } });

  return render(
    <QueryClientProvider client={queryClient}>
      <ProductHostProvider host={harnessTestHost}>
        <HarnessPane harnessKind={harnessKind} />
      </ProductHostProvider>
    </QueryClientProvider>,
  );
}

/**
 * §7's model list opens collapsed behind its own status row (agent-auth.md pane
 * anatomy §7), so the model toggles are aria-hidden until the row is clicked.
 */
function expandModelList() {
  fireEvent.click(screen.getByRole("button", { name: "All Models" }));
}

function gatewayCard() {
  return screen.getByRole("button", { name: "Proliferate gateway" }) as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.cloudActive = true;
  state.authStatus = "authenticated";
  state.agentSurface = "local";
  state.capabilities.data = {
    gatewayEnabled: true,
    publicBaseUrl: "https://gateway.example",
    enrollmentStatus: "synced",
  };
  state.enrollment.data = undefined;
  state.selections.data = [];
  state.selections.isLoading = false;
  state.apiKeys.data = [];
  state.agentModels.data = undefined;
  state.agentModels.isLoading = false;
  state.agentsByKind = new Map();
  state.loginSessions = {};
  state.modelSnapshotStatus.data = undefined;
  state.modelSnapshotStatus.isLoading = false;
  state.launchOptions.data = undefined;
  state.launchOptions.isLoading = false;
});

describe("HarnessPane authentication", () => {
  it("persists an enabled gateway source when the toggle is switched on", () => {
    renderPane("claude");

    const gateway = gatewayCard();
    expect(gateway.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(gateway);

    expect(putMutate).toHaveBeenCalledWith(
      {
        harnessKind: "claude",
        surface: "local",
        body: { sources: [{ sourceKind: "gateway", enabled: true }] },
      },
      expect.anything(),
    );
  });

  it("persists to the selected surface", () => {
    state.agentSurface = "cloud";
    renderPane("claude");

    expect(screen.getByText("Installation and readiness in Proliferate Cloud.")).toBeTruthy();
    expect(screen.queryByText(/Workspace/)).toBeNull();

    fireEvent.click(gatewayCard());

    expect(putMutate).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "cloud" }),
      expect.anything(),
    );
  });

  it("shows empty state when API key card is clicked with no rows", () => {
    state.apiKeys.data = [{
      id: "key-1",
      title: "Work key",
      redactedHint: "sk-...abcd",
      status: "active",
      createdAt: "2026-07-01T00:00:00Z",
    }];
    renderPane("claude");

    const apiKey = screen.getByRole("button", { name: "API key" });

    // Clicking the API key card only selects it, does NOT open the modal.
    fireEvent.click(apiKey);
    expect(apiKey.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("add-key-modal")).toBeNull();

    // The empty state is shown with an "Add API key" button.
    expect(screen.getByText("No API key configured.")).toBeTruthy();

    // Clicking the "Add API key" button in the empty state opens the modal.
    fireEvent.click(screen.getByRole("button", { name: /Add API key/ }));
    expect(screen.getByTestId("add-key-modal")).toBeTruthy();

    // Submitting the modal creates and binds the key in one step.
    fireEvent.click(screen.getByRole("button", { name: "submit-add-key" }));

    // The mock for useCreateAgentApiKey fires createKeyMutate — the onSuccess
    // callback (which calls addBoundApiKey + commit) is handled internally by
    // the component, so we just verify the vault create was called.
    expect(createKeyMutate).toHaveBeenCalledWith(
      { title: "Test key", value: "sk-test-value" },
      expect.anything(),
    );
  });

  it("turns the gateway off when the API key card is selected on a single-source harness", () => {
    state.apiKeys.data = [{
      id: "key-1",
      title: "Work key",
      redactedHint: "sk-...abcd",
      status: "active",
      createdAt: "2026-07-01T00:00:00Z",
    }];
    state.selections.data = [{
      id: "sel-gw",
      harnessKind: "claude",
      surface: "local",
      sourceKind: "gateway",
      apiKeyId: null,
      keyTitle: null,
      envVarName: null,
      providerHint: null,
      enabled: true,
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    }];
    renderPane("claude");

    expect(gatewayCard().getAttribute("aria-pressed")).toBe("true");

    // Clicking "API key" card disables gateway (radio semantics) and shows the
    // empty state (no existing rows).
    fireEvent.click(screen.getByRole("button", { name: "API key" }));

    // The gateway is dropped from the desired set (radio semantics).
    expect(putMutate).toHaveBeenLastCalledWith(
      {
        harnessKind: "claude",
        surface: "local",
        body: {
          sources: [{ sourceKind: "gateway", enabled: false }],
        },
      },
      expect.anything(),
    );
    // The modal is NOT open yet; the empty state is shown instead.
    expect(screen.queryByTestId("add-key-modal")).toBeNull();
    expect(screen.getByText("No API key configured.")).toBeTruthy();
  });

  it("selects exactly one method for a single-source harness: API key then CLI ends on CLI", () => {
    renderPane("claude");

    const gateway = () =>
      screen.getByRole("button", { name: "Proliferate gateway" });
    const apiKey = () => screen.getByRole("button", { name: "API key" });
    const cli = () => screen.getByRole("button", { name: "CLI login" });

    // Clicking API key highlights ONLY the API key card and shows empty state —
    // gateway and api_key are never selected together on a single-source harness.
    fireEvent.click(apiKey());
    expect(apiKey().getAttribute("aria-pressed")).toBe("true");
    expect(gateway().getAttribute("aria-pressed")).toBe("false");
    expect(cli().getAttribute("aria-pressed")).toBe("false");
    // The modal does NOT open; empty state is shown.
    expect(screen.queryByTestId("add-key-modal")).toBeNull();
    expect(screen.getByText("No API key configured.")).toBeTruthy();

    // Clicking CLI sticks on CLI.
    fireEvent.click(cli());
    expect(cli().getAttribute("aria-pressed")).toBe("true");
    expect(apiKey().getAttribute("aria-pressed")).toBe("false");
    expect(gateway().getAttribute("aria-pressed")).toBe("false");
  });

  it("shows Applying… while the delivery ack is outstanding and clears it once acked", () => {
    // Proof C1 (UI state): a selection reads pending until the surface's
    // runtime acknowledges the delivered state, then flips to applied.
    const pendingSelection = {
      id: "sel-gw",
      harnessKind: "claude",
      surface: "local",
      sourceKind: "gateway",
      apiKeyId: null,
      keyTitle: null,
      envVarName: null,
      providerHint: null,
      enabled: true,
      applied: false,
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    };
    state.selections.data = [pendingSelection];
    const queryClient = new QueryClient({ defaultOptions: {
      queries: { retry: false }, mutations: { retry: false },
    } });
    const element = () => (
      <QueryClientProvider client={queryClient}>
        <ProductHostProvider host={harnessTestHost}>
          <HarnessPane harnessKind="claude" />
        </ProductHostProvider>
      </QueryClientProvider>
    );
    const view = render(element());

    expect(screen.queryByText("Applying…")).not.toBeNull();
    expect(
      view.container.querySelector('[data-harness-auth-delivery="pending"]'),
    ).not.toBeNull();

    // The ack lands (desktop ack POST or the cloud materializer's stamp) and
    // the refetched selections read applied.
    state.selections.data = [{ ...pendingSelection, applied: true }];
    view.rerender(element());

    expect(screen.queryByText("Applying…")).toBeNull();
    expect(
      view.container.querySelector('[data-harness-auth-delivery="applied"]'),
    ).not.toBeNull();
  });

  it("scopes the Applying… indicator to the pending harness and surface", () => {
    // A sibling harness's (codex) and the other surface's (cloud) unacked
    // deliveries must not flip the claude/local pane to pending.
    state.selections.data = [
      {
        id: "sel-codex",
        harnessKind: "codex",
        surface: "local",
        sourceKind: "gateway",
        apiKeyId: null,
        keyTitle: null,
        envVarName: null,
        providerHint: null,
        enabled: true,
        applied: false,
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      },
      {
        id: "sel-claude-cloud",
        harnessKind: "claude",
        surface: "cloud",
        sourceKind: "gateway",
        apiKeyId: null,
        keyTitle: null,
        envVarName: null,
        providerHint: null,
        enabled: true,
        applied: false,
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      },
      {
        id: "sel-claude-local",
        harnessKind: "claude",
        surface: "local",
        sourceKind: "gateway",
        apiKeyId: null,
        keyTitle: null,
        envVarName: null,
        providerHint: null,
        enabled: true,
        applied: true,
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      },
    ];
    const { container } = renderPane("claude");

    expect(screen.queryByText("Applying…")).toBeNull();
    expect(
      container.querySelector('[data-harness-auth-delivery="applied"]'),
    ).not.toBeNull();
  });

  it("shows the native empty-state copy when nothing is enabled", () => {
    renderPane("claude");
    expect(
      screen.queryByText(/No auth configured — the CLI's own login is used/),
    ).not.toBeNull();
  });

  it("offers cursor api_key and CLI methods but never the gateway card", () => {
    renderPane("cursor");

    // Cursor has no gateway recipe (agent-auth.md: "typed refusal, no gateway
    // route exists for cursor") — the gateway card is omitted, not disabled.
    expect(screen.queryByRole("button", { name: "Proliferate gateway" })).toBeNull();
    expect(screen.getByRole("button", { name: "API key" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "CLI login" })).toBeTruthy();
  });

  it("persists a cursor api_key selection using its CURSOR_API_KEY suggestion", () => {
    state.apiKeys.data = [{
      id: "key-1",
      title: "Cursor key",
      redactedHint: "sk-...abcd",
      status: "active",
      createdAt: "2026-07-01T00:00:00Z",
    }];
    renderPane("cursor");

    fireEvent.click(screen.getByRole("button", { name: "API key" }));
    expect(screen.getByText("No API key configured.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Add API key/ }));
    expect(screen.getByTestId("add-key-modal")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "submit-add-key" }));
    expect(createKeyMutate).toHaveBeenCalledWith(
      { title: "Test key", value: "sk-test-value" },
      expect.anything(),
    );
  });

  it("offers Add provider only for opencode when API key method is active", () => {
    // Seed an api_key selection so the API key detail section is visible.
    state.selections.data = [{
      id: "sel-key",
      harnessKind: "opencode",
      surface: "local",
      sourceKind: "api_key",
      apiKeyId: "key-1",
      keyTitle: null,
      envVarName: "OPENROUTER_API_KEY",
      providerHint: "openrouter",
      enabled: true,
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    }];
    renderPane("opencode");
    expect(screen.queryByRole("button", { name: /Add provider/ })).not.toBeNull();
  });

  it("does not offer Add provider for single-source harnesses", () => {
    // Seed an api_key selection so the API key detail section is visible.
    state.selections.data = [{
      id: "sel-key",
      harnessKind: "claude",
      surface: "local",
      sourceKind: "api_key",
      apiKeyId: "key-1",
      keyTitle: null,
      envVarName: "ANTHROPIC_API_KEY",
      providerHint: "anthropic",
      enabled: true,
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    }];
    renderPane("claude");
    expect(screen.queryByRole("button", { name: /Add provider/ })).toBeNull();
  });

  it("always shows CLI as selected for multi-source (opencode) even with gateway on", () => {
    state.selections.data = [{
      id: "sel-gw",
      harnessKind: "opencode",
      surface: "local",
      sourceKind: "gateway",
      apiKeyId: null,
      keyTitle: null,
      envVarName: null,
      providerHint: null,
      enabled: true,
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    }];
    renderPane("opencode");

    const cli = screen.getByRole("button", { name: "CLI login" });
    const gateway = screen.getByRole("button", { name: "Proliferate gateway" });

    // CLI is always selected for multi-source harnesses (native coexistence).
    expect(cli.getAttribute("aria-pressed")).toBe("true");
    expect(gateway.getAttribute("aria-pressed")).toBe("true");

    // CLI card is disabled (not a toggle) and shows the coexistence hint.
    expect((cli as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Native logins always apply alongside other sources.")).not.toBeNull();
  });

  it("opencode: clicking API key shows empty state and reflects the in-progress state", () => {
    renderPane("opencode");

    const apiKey = () => screen.getByRole("button", { name: "API key" });
    // Before the click there is no api_key detail block.
    expect(apiKey().getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: /Add provider/ })).toBeNull();

    fireEvent.click(apiKey());

    // The card lights immediately (pending) and the empty state is shown.
    expect(apiKey().getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("add-key-modal")).toBeNull();
    expect(screen.getByText("No API key configured.")).toBeTruthy();
    // Nothing is PUT yet (no key wired).
    expect(putMutate).not.toHaveBeenCalled();

    // CLI stays always-selected and disabled (native coexistence) throughout.
    const cli = screen.getByRole("button", { name: "CLI login" }) as HTMLButtonElement;
    expect(cli.getAttribute("aria-pressed")).toBe("true");
    expect(cli.disabled).toBe(true);
  });

  it("opencode: toggling API key off darkens the card and hides the empty state", () => {
    renderPane("opencode");

    const apiKey = () => screen.getByRole("button", { name: "API key" });

    fireEvent.click(apiKey());
    expect(apiKey().getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("No API key configured.")).toBeTruthy();

    // Clicking again turns api_key off: the empty state is hidden and the highlight
    // clears, so "off" visibly means off.
    fireEvent.click(apiKey());
    expect(apiKey().getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText("No API key configured.")).toBeNull();
  });

  it("opencode: enabling a wired api key lights it alongside the gateway", () => {
    state.apiKeys.data = [{
      id: "key-1",
      title: "Work key",
      redactedHint: "sk-...abcd",
      status: "active",
      createdAt: "2026-07-01T00:00:00Z",
    }];
    // Gateway on + a wired-but-disabled api_key row: the api_key editor is
    // visible (rows present) but the card stays dark until a row is enabled.
    state.selections.data = [
      {
        id: "sel-gw",
        harnessKind: "opencode",
        surface: "local",
        sourceKind: "gateway",
        apiKeyId: null,
        keyTitle: null,
        envVarName: null,
        providerHint: null,
        enabled: true,
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      },
      {
        id: "sel-key",
        harnessKind: "opencode",
        surface: "local",
        sourceKind: "api_key",
        apiKeyId: "key-1",
        keyTitle: "Work key",
        envVarName: "OPENROUTER_API_KEY",
        providerHint: "openrouter",
        enabled: false,
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      },
    ];
    renderPane("opencode");

    const apiKey = () => screen.getByRole("button", { name: "API key" });
    // Env var name is shown read-only (not in an input).
    expect(screen.getByText("OPENROUTER_API_KEY")).toBeTruthy();
    expect(apiKey().getAttribute("aria-pressed")).toBe("false");
    expect(gatewayCard().getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("switch", { name: "Enable OPENROUTER_API_KEY" }));

    // The api_key card lights and the gateway stays on — both coexist.
    expect(apiKey().getAttribute("aria-pressed")).toBe("true");
    expect(gatewayCard().getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByRole("button", { name: "CLI login" }).getAttribute("aria-pressed"),
    ).toBe("true");

    expect(putMutate).toHaveBeenLastCalledWith(
      {
        harnessKind: "opencode",
        surface: "local",
        body: {
          sources: [
            { sourceKind: "gateway", enabled: true },
            {
              sourceKind: "api_key",
              apiKeyId: "key-1",
              envVarName: "OPENROUTER_API_KEY",
              providerHint: "openrouter",
              enabled: true,
            },
          ],
        },
      },
      expect.anything(),
    );
  });

  it("prefills a new row from the opencode provider picker", () => {
    // Seed an api_key selection so the API key detail section is visible.
    state.selections.data = [{
      id: "sel-key",
      harnessKind: "opencode",
      surface: "local",
      sourceKind: "api_key",
      apiKeyId: "key-1",
      keyTitle: null,
      envVarName: "OPENAI_API_KEY",
      providerHint: "openai",
      enabled: true,
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    }];
    renderPane("opencode");

    fireEvent.click(screen.getByRole("button", { name: /Add provider/ }));
    fireEvent.click(screen.getByRole("button", { name: "pick-openrouter" }));

    // New row shows env var name (read-only display since it has a value).
    expect(screen.getByText("OPENROUTER_API_KEY")).toBeTruthy();
  });

  it("disables the gateway toggle with a subtitle when the gateway is unavailable", () => {
    state.capabilities.data = {
      gatewayEnabled: false,
      publicBaseUrl: null,
      enrollmentStatus: "disabled",
    };
    renderPane("claude");

    expect(gatewayCard().disabled).toBe(true);
    expect(screen.queryByText("Unavailable for your account")).not.toBeNull();

    fireEvent.click(gatewayCard());
    expect(putMutate).not.toHaveBeenCalled();
  });

  it("disables the gateway toggle while enrollment is unsynced", () => {
    state.enrollment.data = { syncStatus: "pending", lastErrorCode: null };
    renderPane("claude");

    expect(gatewayCard().disabled).toBe(true);
    expect(screen.queryByText("Enrollment pending")).not.toBeNull();
  });

  it("offers Run login on native when local credentials are undetected", () => {
    state.agentsByKind = new Map([[
      "claude",
      {
        kind: "claude",
        displayName: "Claude Code",
        readiness: "login_required",
        supportsLogin: true,
      },
    ]]);
    renderPane("claude");

    fireEvent.click(screen.getByRole("button", { name: "Authenticate" }));

    expect(openAuthTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "claude" }),
      { restart: false },
    );
  });

  it("asks the user to sign in when signed out", () => {
    state.authStatus = "anonymous";
    state.cloudActive = false;
    renderPane("claude");

    expect(screen.queryAllByText(/Sign in to Proliferate Cloud/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Proliferate gateway" })).toBeNull();
  });

  // The founder ruling for PR 5f: model-auth (BYOK/api_key + gateway route) is
  // an auth-plane surface. A signed-in user with NO cloud compute (E2B) — a
  // local-only or self-hosted install — must still get the route cards to store
  // a key or pick a route. Previously the local surface hid them behind the
  // compute-based `cloudActive`, showing "Sign in to Proliferate Cloud".
  it("shows the model-auth route cards for an authenticated user without cloud compute", () => {
    state.authStatus = "authenticated";
    state.cloudActive = false;
    const { container } = renderPane("claude");

    // No sign-in prompt: the auth plane is ready even without cloud compute.
    expect(screen.queryAllByText(/Sign in to Proliferate Cloud/).length).toBe(0);
    // The exact route markers the qualification DOM asserts.
    expect(container.querySelector('[data-harness-route-option="claude:gateway"]')).not.toBeNull();
    expect(container.querySelector('[data-harness-route-option="claude:api_key"]')).not.toBeNull();
    expect(container.querySelector('[data-harness-route-option="claude:cli"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Proliferate gateway" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "API key" })).toBeTruthy();
  });
});

// The layered read (observation-else-seed with the override patch) serves
// machineless picking, so it is the CLOUD surface's source; the local surface
// reads the composed observation instead (next describe).
describe("HarnessPane all models", () => {
  it("renders the layered catalog grid in the All Models section", () => {
    state.agentSurface = "cloud";
    state.agentModels.data = {
      harnessKind: "claude",
      models: [
        { id: "sonnet", displayName: "Sonnet 4.6" },
        { id: "haiku", displayName: "Haiku 4.5", enabled: false },
      ],
      modes: [{ id: "build" }],
      snapshotId: "snap-1",
      probedAt: null,
      origin: "snapshot",
      overrideApplied: true,
    };
    renderPane("claude");



    expandModelList();
    expect(screen.queryByText("Sonnet 4.6")).not.toBeNull();
    // 2 model toggles + 1 settings switch (Pass model).
    expect(screen.getAllByRole("switch").length).toBeGreaterThanOrEqual(2);
  });

  // The cloud-snapshot ingest route (POST /agent-models/{h}/refresh) is
  // Worker-authenticated only (F-040) — no product client can ever call it,
  // so the native/api_key/cloud-surface branch renders no Refresh button at
  // all (see HarnessAllModelsSection's `canManuallyRefresh`).
  it("renders no Refresh button for a native/api_key route (no callable refresh exists)", () => {
    state.agentSurface = "cloud";
    state.agentModels.data = {
      harnessKind: "claude",
      models: [],
      modes: [],
      snapshotId: null,
      probedAt: null,
      origin: null,
      overrideApplied: false,
    };
    renderPane("claude");

    expect(screen.queryByRole("button", { name: /^Refresh$/ })).toBeNull();
  });

  it("upserts an override patch when a model is toggled off", () => {
    state.agentSurface = "cloud";
    state.agentModels.data = {
      harnessKind: "claude",
      models: [
        { id: "sonnet", displayName: "Sonnet 4.6" },
        { id: "haiku", displayName: "Haiku 4.5", enabled: false },
      ],
      modes: [{ id: "build" }],
      snapshotId: "snap-1",
      probedAt: null,
      origin: "snapshot",
      overrideApplied: true,
    };
    renderPane("claude");


    expandModelList();
    // First switch(es) are settings switches; model switches come later in DOM.
    const allSwitches = screen.getAllByRole("switch");
    const sonnetSwitch = allSwitches[allSwitches.length - 2]; // Second-to-last is first model
    fireEvent.click(sonnetSwitch);

    expect(overrideMutate).toHaveBeenCalledWith(
      {
        harnessKind: "claude",
        body: {
          patchJson: JSON.stringify({
            update: { haiku: { enabled: false }, sonnet: { enabled: false } },
          }),
        },
      },
      expect.anything(),
    );
  });
});

// The picker is the observation (model-catalog.md "Serving"): the local
// surface renders the harness's ONE composed observation off the runtime's
// status route — no per-context branching by route.
describe("HarnessPane all models (local composed observation)", () => {
  it("reads the composed observation instead of the cloud catalog", () => {
    state.modelSnapshotStatus.data = {
      agent: "claude",
      schemaVersion: 2,
      probeEngine: "owner",
      state: "idle",
      probedAt: "2026-07-02T20:00:00Z",
      snapshotAgeSeconds: 90,
      modelCount: 1,
      modeCount: 0,
      models: [{ id: "claude-sonnet-4-5", name: "Sonnet 4.6", provider: "anthropic" }],
      modes: [],
    };
    renderPane("claude");

    expect(screen.queryByText("refreshed 1m ago")).not.toBeNull();
    expandModelList();
    expect(screen.queryByText("Sonnet 4.6")).not.toBeNull();
    // No override capability for observation rows: the model switch is
    // present (all observed models are "on") but disabled.
    const allSwitches = screen.getAllByRole("switch") as HTMLButtonElement[];
    const modelSwitch = allSwitches[allSwitches.length - 1]; // Last switch is the model toggle
    expect(modelSwitch.getAttribute("aria-checked")).toBe("true");
    expect(modelSwitch.disabled).toBe(true);
  });

  it("marks the shipped-catalog seed as unverified before the first observation", () => {
    state.modelSnapshotStatus.data = undefined;
    state.launchOptions.data = {
      agents: [{
        kind: "claude",
        displayName: "Claude Code",
        defaultModelId: "claude-sonnet-4-5",
        models: [{ id: "claude-sonnet-4-5", displayName: "Sonnet 4.6", isDefault: true }],
      }],
    };
    renderPane("claude");

    expect(screen.queryByText("Sonnet 4.6")).not.toBeNull();
    expect(screen.queryByText("unverified")).not.toBeNull();
  });

  it("hits the param-less runtime refresh endpoint for the local surface", () => {
    renderPane("claude");

    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));

    expect(refreshModelSnapshotMutate).toHaveBeenCalledWith("claude", expect.anything());
  });
});
