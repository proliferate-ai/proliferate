// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { makeTestProductHost, type TestProductHostOptions } from "#product/test/product-host-test-utils";
import { HarnessPane } from "#product/components/settings/panes/agents/harness/HarnessPane";

// Anonymous host keeps the organizations query disabled, as before. Its
// desktop runtime bridge is what makes the LOCAL surface real here (E-R34).
const harnessTestHost = makeTestProductHost({ desktop: { runtime: { getConnection: vi.fn(), restart: vi.fn() } } as TestProductHostOptions["desktop"] });

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
    isPending: false,
    isFetching: false,
  },
  enrollment: {
    data: undefined as
      | { syncStatus: string; lastErrorCode: string | null }
      | undefined,
    isPending: false,
    isFetching: false,
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
}));
const putMutate = vi.hoisted(() => vi.fn());
const createKeyMutate = vi.hoisted(() => vi.fn());
const revokeKeyMutate = vi.hoisted(() => vi.fn());
const overrideMutate = vi.hoisted(() => vi.fn());
const refreshModelSnapshotMutate = vi.hoisted(() => vi.fn());
const openAuthTerminal = vi.hoisted(() => vi.fn());
const closeAuthTerminal = vi.hoisted(() => vi.fn());
const handleTerminalExit = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useCloudSandbox: () => ({ data: { id: "sandbox-1" }, isLoading: false }),
  useCloudHarnessLaunchOptions: ({ harnessKind }: { harnessKind: string }) => ({
    data: state.agentModels.data ? {
      harnessKind,
      basisRevision: "cloud-basis",
      revision: 1,
      state: "observed",
      options: {
        models: state.agentModels.data.models.map((model) => ({
          id: String(model.id),
          observedName: typeof model.displayName === "string" ? model.displayName : null,
          observedDescription: null,
        })),
        controls: [],
        defaults: { modelId: null, controlValues: {} },
      },
      observedAt: state.agentModels.data.probedAt,
      probeAttemptedAt: "2026-08-19T00:00:00Z",
      probeFailureCode: null,
      readiness: "ready",
    } : undefined,
    isLoading: false,
  }),
  useAgentGatewayCapabilities: () => state.capabilities,
  useAgentGatewayEnrollment: () => state.enrollment,
  useAuthSelections: () => state.selections,
  useAgentApiKeys: () => state.apiKeys,
  useAgentModels: () => state.agentModels,
  useAgentAuthState: () => ({ data: undefined, isLoading: false }),
  useOrgAgentPolicy: () => ({ data: undefined, isLoading: false }),
  usePutAuthSelections: () => ({ mutate: putMutate, isPending: false }),
  useCreateAgentApiKey: () => ({ mutate: createKeyMutate, isPending: false }),
  useRevokeAgentApiKey: () => ({ mutate: revokeKeyMutate, isPending: false }),
  useUpsertAgentModelOverride: () => ({ mutate: overrideMutate, isPending: false }),
}));

// The local surface reads the RUNTIME's composed observation
// (model-catalog.md "The picker is the observation") — mock the anyharness
// SDK hooks standing in for that runtime call.
vi.mock("@anyharness/sdk-react", () => ({
  useAnyHarnessRuntimeContext: () => ({ runtimeUrl: "http://127.0.0.1:8457" }),
  useAgentLaunchOptionsQuery: ({ harnessKind }: { harnessKind: string }) => {
    const sourceModels = state.modelSnapshotStatus.data?.models ?? null;
    return {
      data: sourceModels ? {
        harnessKind,
        basisRevision: "local-basis",
        revision: 1,
        state: "observed",
        options: {
          models: sourceModels.map((model) => ({
            id: String(model.id),
            observedName: typeof model.name === "string"
              ? model.name
              : typeof model.displayName === "string" ? model.displayName : null,
            observedDescription: null,
          })),
          controls: [],
          defaults: { modelId: null, controlValues: {} },
        },
        observedAt: typeof state.modelSnapshotStatus.data?.probedAt === "string"
          ? state.modelSnapshotStatus.data.probedAt
          : null,
        probeAttemptedAt: "2026-08-19T00:00:00Z",
        probeFailureCode: null,
        readiness: "ready",
        // The LOCAL runtime owns its probe engine in this fixture; the cloud
        // hook above carries no such field, because the wire has none.
        canManuallyRefresh: true,
      } : undefined,
      isLoading: false,
    };
  },
  // The composed observation (one status document per harness): an absent
  // document keeps HarnessAllModelsSection on the unverified seed path.
  useModelSnapshotStatusQuery: () => state.modelSnapshotStatus,
  // The param-less manual-refresh poke.
  useRefreshModelSnapshotMutation: () => ({
    mutate: refreshModelSnapshotMutate,
    isPending: false,
  }),
  useRefreshHarnessLaunchOptionsMutation: () => ({
    mutate: refreshModelSnapshotMutate,
    isPending: false,
  }),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (s: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast }),
}));

// ModalShell (Radix Dialog) has no jsdom polyfills here — stub the picker to a
// deterministic button that fires onSubmit (provider + pasted key) when open.
// The stub also surfaces `error` and the bound env-var list so the pane's
// failure/dup handling is assertable without Radix.
vi.mock("./ProviderPickerModal", () => ({
  ProviderPickerModal: ({
    open,
    onSubmit,
    error,
    boundEnvVarNames,
  }: {
    open: boolean;
    onSubmit: (
      provider: { id: string; displayName: string; envVarNames: readonly string[] },
      value: string,
    ) => void;
    error?: string | null;
    boundEnvVarNames?: readonly string[];
  }) =>
    open ? (
      <div>
        <button
          type="button"
          onClick={() => {
            onSubmit(
              {
                id: "openrouter",
                displayName: "OpenRouter",
                envVarNames: ["OPENROUTER_API_KEY"],
              },
              "sk-openrouter",
            );
          }}
        >
          pick-openrouter
        </button>
        <button
          type="button"
          onClick={() => {
            onSubmit(
              {
                id: "azure",
                displayName: "Azure",
                envVarNames: ["AZURE_RESOURCE_NAME", "AZURE_API_KEY"],
              },
              "sk-azure",
            );
          }}
        >
          pick-azure
        </button>
        <div data-testid="picker-bound">{(boundEnvVarNames ?? []).join(",")}</div>
        {error === null || error === undefined ? null : (
          <div data-testid="picker-error">{error}</div>
        )}
      </div>
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
    controlPlaneReachable: true,
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
  useHarnessConnectionStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ runtimeUrl: "http://127.0.0.1:8457", connectionState: "healthy" }),
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

// §7's model list opens collapsed until clicked; flush the reveal's rAF.
function expandModelList() {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => (frames.push(cb), frames.length));
  fireEvent.click(screen.getByRole("button", { name: "Models" }));
  act(() => { while (frames.length > 0) frames.shift()?.(0); });
}

// One persisted opencode api_key selection — enough for the API-key detail
// section (and its "Add provider" button) to render.
function seededOpencodeApiKeySelection() {
  return {
    id: "sel-key",
    harnessKind: "opencode",
    surface: "local" as const,
    sourceKind: "api_key" as const,
    apiKeyId: "key-1",
    keyTitle: null,
    envVarName: "OPENAI_API_KEY",
    providerHint: "openai",
    enabled: true,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };
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
  state.capabilities.isPending = false;
  state.capabilities.isFetching = false;
  state.enrollment.data = undefined;
  state.enrollment.isPending = false;
  state.enrollment.isFetching = false;
  state.selections.data = [];
  state.selections.isLoading = false;
  state.apiKeys.data = [];
  state.agentModels.data = undefined;
  state.agentModels.isLoading = false;
  state.agentsByKind = new Map();
  state.loginSessions = {};
  state.modelSnapshotStatus.data = undefined;
  state.modelSnapshotStatus.isLoading = false;
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

  it("shows an inline paste field (no modal) when API key is selected with no rows", () => {
    renderPane("claude");

    const apiKey = screen.getByRole("button", { name: "API key" });

    // Clicking the API key row only selects it — no modal, ever.
    fireEvent.click(apiKey);
    expect(apiKey.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("add-key-modal")).toBeNull();

    // The inline entry names the derived provider — env vars never surface.
    const field = screen.getByLabelText("Anthropic API key");
    expect(screen.queryByText("ANTHROPIC_API_KEY")).toBeNull();

    fireEvent.change(field, { target: { value: "sk-test-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // The vault key is created with the derived provider title.
    expect(createKeyMutate).toHaveBeenCalledWith(
      { title: "Anthropic API key", value: "sk-test-value" },
      expect.anything(),
    );
  });

  it("binds an already-saved vault key from the Saved keys segment", async () => {
    state.apiKeys.data = [{
      id: "key-1",
      title: "Work key",
      redactedHint: "sk-...abcd",
      status: "active",
      createdAt: "2026-07-01T00:00:00Z",
    }];
    renderPane("claude");

    fireEvent.click(screen.getByRole("button", { name: "API key" }));
    // Saved keys are offered as a segment next to the paste field.
    fireEvent.click(screen.getByRole("radio", { name: "Saved keys" }));
    fireEvent.click(await screen.findByRole("button", { name: /Work key/ }));

    expect(putMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: {
          sources: expect.arrayContaining([
            expect.objectContaining({
              sourceKind: "api_key",
              apiKeyId: "key-1",
              envVarName: "ANTHROPIC_API_KEY",
              enabled: true,
            }),
          ]),
        },
      }),
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
    // No modal; the inline paste entry is shown instead.
    expect(screen.queryByTestId("add-key-modal")).toBeNull();
    expect(screen.getByLabelText("Anthropic API key")).toBeTruthy();
  });

  it("selects exactly one method for a single-source harness: API key then CLI ends on CLI", () => {
    renderPane("claude");

    const gateway = () =>
      screen.getByRole("button", { name: "Proliferate gateway" });
    const apiKey = () => screen.getByRole("button", { name: "API key" });
    const cli = () => screen.getByRole("button", { name: "CLI login" });

    // Clicking API key highlights ONLY the API key card —
    // gateway and api_key are never selected together on a single-source harness.
    fireEvent.click(apiKey());
    expect(apiKey().getAttribute("aria-pressed")).toBe("true");
    expect(gateway().getAttribute("aria-pressed")).toBe("false");
    expect(cli().getAttribute("aria-pressed")).toBe("false");
    // The modal does NOT open; the inline paste entry is shown.
    expect(screen.queryByTestId("add-key-modal")).toBeNull();
    expect(screen.getByLabelText("Anthropic API key")).toBeTruthy();

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

  it("shows the minimal native status row when nothing is enabled", () => {
    const { container } = renderPane("claude");
    // Minimal status ruling (2026-07-27): one row, badge + refresh, no
    // savedState/description noise.
    expect(container.querySelector('[data-harness-status="native"]')).not.toBeNull();
    expect(
      screen.queryByText(/No auth configured — the CLI's own login is used/),
    ).toBeNull();
    expect(screen.getByText("Not authenticated")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh status" })).toBeTruthy();
  });

  it("offers cursor api_key and CLI methods but never the gateway card", () => {
    renderPane("cursor");

    // Cursor has no gateway recipe (agent-auth.md: "typed refusal, no gateway
    // route exists for cursor") — the gateway card is omitted, not disabled.
    expect(screen.queryByRole("button", { name: "Proliferate gateway" })).toBeNull();
    expect(screen.getByRole("button", { name: "API key" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "CLI login" })).toBeTruthy();
  });

  it("persists a cursor api_key selection using its CURSOR_API_KEY derivation", () => {
    renderPane("cursor");

    fireEvent.click(screen.getByRole("button", { name: "API key" }));

    const field = screen.getByLabelText("Cursor API key");
    fireEvent.change(field, { target: { value: "sk-cursor" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(createKeyMutate).toHaveBeenCalledWith(
      { title: "Cursor API key", value: "sk-cursor" },
      expect.anything(),
    );
  });

  it("offers Configure only for opencode's providers section", () => {
    // Seed an api_key selection so the providers summary shows a configured tile.
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
    expect(screen.queryByRole("button", { name: "Configure" })).not.toBeNull();
    expect(screen.getByText("1 configured")).toBeTruthy();
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
    expect(screen.queryByRole("button", { name: "Configure" })).toBeNull();
  });

  it("opencode never shows the auth-method chooser (providers-only pane)", () => {
    renderPane("opencode");

    // Point 4 (ruling 2026-07-27): no method rows at all for opencode.
    expect(screen.queryByRole("button", { name: "Proliferate gateway" })).toBeNull();
    expect(screen.queryByRole("button", { name: "API key" })).toBeNull();
    expect(screen.queryByRole("button", { name: "CLI login" })).toBeNull();

    // The provider-key surface is the pane: Configure is always reachable.
    expect(screen.getByRole("button", { name: "Configure" })).toBeTruthy();
    expect(screen.getByText("No providers configured")).toBeTruthy();
  });

  it("opencode: a configured provider renders as a summary tile and can be removed via the modal", async () => {
    state.apiKeys.data = [{
      id: "key-1",
      title: "Work key",
      redactedHint: "sk-...abcd",
      status: "active",
      createdAt: "2026-07-01T00:00:00Z",
    }];
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

    // The summary shows a count, not the env var name.
    expect(screen.getByText("1 configured")).toBeTruthy();
    expect(screen.queryByText("OPENROUTER_API_KEY")).toBeNull();
  });

  it("prefills a new row from the opencode provider picker", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    // The picker is React.lazy (its logo map must stay out of the login chunk).
    const pick = await screen.findByRole("button", { name: "pick-openrouter" });
    fireEvent.click(pick);

    // Write 1: the vault api_key entry, from the inline paste field.
    expect(createKeyMutate).toHaveBeenCalledWith(
      { title: "OpenRouter API key", value: "sk-openrouter" },
      expect.anything(),
    );

    // Write 2: one selection row (env var = provider's key-shaped registry env
    // var, provider_hint = provider id), once the vault create resolves.
    const lastCall = createKeyMutate.mock.calls[createKeyMutate.mock.calls.length - 1];
    const onSuccess = lastCall?.[1]?.onSuccess;
    await act(async () => {
      onSuccess?.({ id: "key-openrouter" });
    });

    expect(putMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: {
          sources: expect.arrayContaining([
            {
              sourceKind: "api_key",
              apiKeyId: "key-openrouter",
              envVarName: "OPENROUTER_API_KEY",
              providerHint: "openrouter",
              enabled: true,
            },
          ]),
        },
      }),
      expect.anything(),
    );
  });

  it("revokes the just-created key and keeps the picker open when the selection PUT fails", async () => {
    state.selections.data = [seededOpencodeApiKeySelection()];
    renderPane("opencode");

    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    fireEvent.click(await screen.findByRole("button", { name: "pick-openrouter" }));

    const createCall = createKeyMutate.mock.calls[createKeyMutate.mock.calls.length - 1];
    await act(async () => {
      createCall?.[1]?.onSuccess?.({ id: "key-openrouter" });
    });

    // The selection PUT is rejected: the vault key now has no referent.
    const putCall = putMutate.mock.calls[putMutate.mock.calls.length - 1];
    await act(async () => {
      putCall?.[1]?.onError?.({ message: "Duplicate selection source" });
    });

    // No orphan: the unreferenced key is revoked.
    expect(revokeKeyMutate).toHaveBeenCalledWith("key-openrouter");
    // The modal stays open and reports the failure inline so the user can retry.
    expect(screen.queryByRole("button", { name: "pick-openrouter" })).not.toBeNull();
    expect(screen.getByTestId("picker-error").textContent).toBe(
      "Duplicate selection source",
    );
    // The optimistic row is rolled back, so nothing renders as wired.
    expect(screen.queryByText("OPENROUTER_API_KEY")).toBeNull();
    // A pane-level error is the modal's job here, not a toast.
    expect(showToast).not.toHaveBeenCalledWith("Duplicate selection source");
  });

  it("clears any inline picker error and never revokes the key once the selection PUT succeeds", async () => {
    // The picker itself owns row-collapse on success (the stub here doesn't
    // model that); the pane-level contract is: no error, no revoke, and the
    // modal is not force-closed by the pane (that's the modal's job, and the
    // instructions call out that success never yields a close-on-success
    // assertion at this level).
    state.selections.data = [seededOpencodeApiKeySelection()];
    renderPane("opencode");

    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    fireEvent.click(await screen.findByRole("button", { name: "pick-openrouter" }));

    const createCall = createKeyMutate.mock.calls[createKeyMutate.mock.calls.length - 1];
    await act(async () => {
      createCall?.[1]?.onSuccess?.({ id: "key-openrouter" });
    });
    // Still open: write 2 has not landed yet.
    expect(screen.queryByRole("button", { name: "pick-openrouter" })).not.toBeNull();

    const putCall = putMutate.mock.calls[putMutate.mock.calls.length - 1];
    await act(async () => {
      putCall?.[1]?.onSuccess?.([]);
    });

    expect(screen.queryByTestId("picker-error")).toBeNull();
    expect(revokeKeyMutate).not.toHaveBeenCalled();
  });

  it("passes the harness's bound env vars to the picker so duplicates aren't offered", async () => {
    state.selections.data = [seededOpencodeApiKeySelection()];
    renderPane("opencode");

    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    await screen.findByRole("button", { name: "pick-openrouter" });

    expect(screen.getByTestId("picker-bound").textContent).toBe("OPENAI_API_KEY");
  });

  it("writes a multi-field provider's secret under its key-shaped env var", async () => {
    state.selections.data = [seededOpencodeApiKeySelection()];
    renderPane("opencode");

    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    fireEvent.click(await screen.findByRole("button", { name: "pick-azure" }));

    const createCall = createKeyMutate.mock.calls[createKeyMutate.mock.calls.length - 1];
    await act(async () => {
      createCall?.[1]?.onSuccess?.({ id: "key-azure" });
    });

    // AZURE_RESOURCE_NAME is envVarNames[0] but holds no secret.
    expect(putMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: {
          sources: expect.arrayContaining([
            {
              sourceKind: "api_key",
              apiKeyId: "key-azure",
              envVarName: "AZURE_API_KEY",
              providerHint: "azure",
              enabled: true,
            },
          ]),
        },
      }),
      expect.anything(),
    );
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

  // P1-b regression: while the capabilities query is still in flight (first
  // load, no data yet), the gateway status row must show a neutral/loading
  // tone instead of falsely reporting "Not ready" before the observation
  // exists.
  it("shows a loading status, not a false Not ready warning, while gateway capabilities are pending", () => {
    state.capabilities.data = undefined;
    state.capabilities.isPending = true;
    state.capabilities.isFetching = true;
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

    expect(screen.queryByText("Not ready")).toBeNull();
    expect(screen.getAllByText("Checking").length).toBeGreaterThan(0);
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

  // The Authentication section is gated on the auth plane (editor.authReady),
  // not on cloud compute (agent-auth.md, HarnessAuthSection): an anonymous
  // local user gets the sign-in prompt instead of the method cards, so no
  // "Authenticate" affordance (native's own) is reachable until they sign in.
  it("shows the sign-in prompt (not Authenticate) for an anonymous local user with a login_required claude agent", () => {
    state.authStatus = "anonymous";
    state.cloudActive = false;
    state.agentSurface = "local";
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

    expect(screen.queryByRole("button", { name: "Authenticate" })).toBeNull();
    expect(screen.queryAllByText(/Sign in to Proliferate Cloud/).length).toBeGreaterThan(0);
  });

  // P1-a regression: `localAgent?.supportsLogin ?? canRunLogin` let `??`
  // (which binds tighter than the intended `&&`) short-circuit on
  // `supportsLogin: true` alone, offering Authenticate even when the CLI
  // itself says login can't run right now (canRunLogin false, e.g. already
  // authenticated). The fix requires BOTH supportsLogin and canRunLogin.
  it("does not offer Authenticate for a healthy authenticated agent even when supportsLogin is true", () => {
    state.agentsByKind = new Map([[
      "claude",
      {
        kind: "claude",
        displayName: "Claude Code",
        readiness: "ready",
        supportsLogin: true,
      },
    ]]);
    renderPane("claude");

    // Select the CLI card (the default fallback already selects it, but be
    // explicit) — its detail area renders nothing but the badge when
    // authenticated (design-handoff v2: "the state must be said exactly once").
    fireEvent.click(screen.getByRole("button", { name: "CLI login" }));

    expect(screen.getByText("Authenticated")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Authenticate" })).toBeNull();
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

describe("HarnessPane all models", () => {
  it("renders no expandable models list on the cloud surface (the copied observation store is gone)", () => {
    state.agentSurface = "cloud";
    renderPane("claude");
    expect(screen.queryByRole("button", { name: "Models" })).toBeNull();
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

});

describe("HarnessPane all models (local composed observation)", () => {
  const oneModelObservation = () => ({
    agent: "claude", schemaVersion: 2, probeEngine: "owner", state: "idle",
    probedAt: "2026-07-02T20:00:00Z", snapshotAgeSeconds: 90, modelCount: 1, modeCount: 0,
    models: [{ id: "claude-sonnet-4-5", name: "Sonnet 4.6", provider: "anthropic" }],
    modes: [],
  });
  it("reads the runtime launch-option observation", () => {
    state.modelSnapshotStatus.data = oneModelObservation();
    renderPane("claude");

    expect(screen.queryByText("1 model")).not.toBeNull();
    expect(screen.queryByText(/refreshed/)).not.toBeNull(); // E-R1: "Last refreshed" copy is gone
    expandModelList();
    expect(screen.queryByText("Sonnet 4.6")).not.toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("does not seed model choices before the first observation", () => {
    state.modelSnapshotStatus.data = undefined;
    renderPane("claude");

    expect(screen.queryByText(/\d+ models?/)).toBeNull(); // E-R1: no count before a settled observation
    expandModelList();
    expect(screen.queryByText("Sonnet 4.6")).toBeNull();
  });

  it("hits the param-less runtime refresh endpoint for the local surface", () => {
    // Round 5: Refresh needs a payload (ownership is a field on it).
    state.modelSnapshotStatus.data = oneModelObservation();
    renderPane("claude");

    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));

    expect(refreshModelSnapshotMutate).toHaveBeenCalledWith("claude", expect.anything());
  });
});
