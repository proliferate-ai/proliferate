// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessPane } from "./HarnessPane";

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
  catalog: {
    data: undefined as
      | {
        harnessKind: string;
        surface: string;
        route: string;
        models: Array<Record<string, unknown>>;
        snapshotId: string | null;
        probedAt: string | null;
        source: string | null;
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
  gatewayModels: {
    data: undefined as
      | {
        models: Array<Record<string, unknown>>;
        source: "seed" | "probe";
        probedAt?: string;
      }
      | undefined,
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
const refreshMutate = vi.hoisted(() => vi.fn());
const overrideMutate = vi.hoisted(() => vi.fn());
const refreshGatewayModelsMutate = vi.hoisted(() => vi.fn());
const openAuthTerminal = vi.hoisted(() => vi.fn());
const closeAuthTerminal = vi.hoisted(() => vi.fn());
const handleTerminalExit = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentGatewayCapabilities: () => state.capabilities,
  useAgentGatewayEnrollment: () => state.enrollment,
  useAuthSelections: () => state.selections,
  useAgentApiKeys: () => state.apiKeys,
  useAgentCatalog: () => state.catalog,
  useAgentAuthState: () => ({ data: undefined, isLoading: false }),
  usePutAuthSelections: () => ({ mutate: putMutate, isPending: false }),
  useCreateAgentApiKey: () => ({ mutate: createKeyMutate, isPending: false }),
  useRefreshAgentCatalog: () => ({ mutate: refreshMutate, isPending: false }),
  useUpsertCatalogOverride: () => ({ mutate: overrideMutate, isPending: false }),
}));

// Local surface + gateway route reads the RUNTIME's resolved gateway models
// (contract §5) instead of the cloud catalog — mock the anyharness SDK hooks
// standing in for that runtime call.
vi.mock("@anyharness/sdk-react", () => ({
  useAgentGatewayModelsQuery: () => state.gatewayModels,
  useRefreshAgentGatewayModelsMutation: () => ({
    mutate: refreshGatewayModelsMutate,
    isPending: false,
  }),
  // native/api_key refreshes source their probe payload from the runtime's
  // resolved launch catalog (the session model picker's data source) —
  // mock stands in for that runtime read.
  useAgentLaunchOptionsQuery: () => state.launchOptions,
}));

vi.mock("@/stores/toast/toast-store", () => ({
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
vi.mock("@/components/settings/panes/agent-auth/ApiKeyCreatorModal", () => ({
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

vi.mock("@/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({
    cloudEnabled: true,
    cloudActive: state.cloudActive,
    cloudSignInChecking: false,
    // When cloud is inactive the CloudGuard should fall through to the
    // sign-in-required pane (sign-in is available), matching the real hook.
    cloudSignInAvailable: !state.cloudActive,
  }),
}));

vi.mock("@/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({ agentsByKind: state.agentsByKind, agentsNeedingSetup: [] }),
}));

vi.mock("@/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (selector: (s: { runtimeUrl: string }) => unknown) =>
    selector({ runtimeUrl: "http://127.0.0.1:8457" }),
}));

vi.mock("@/hooks/access/anyharness/agents/use-agent-resources-cache", () => ({
  useAgentResourcesCache: () => ({
    invalidateAgentListResources: vi.fn().mockResolvedValue(undefined),
    invalidateAgentSetupResources: vi.fn().mockResolvedValue(undefined),
    invalidateAgentLaunchReadinessResources: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/hooks/agents/workflows/use-agent-login-terminal-workflow", () => ({
  useAgentLoginTerminalWorkflow: () => ({
    sessionsByKind: state.loginSessions,
    runtimeConnection: { baseUrl: "http://127.0.0.1:8457", authToken: undefined },
    openAuthTerminal,
    closeAuthTerminal,
    handleTerminalExit,
  }),
}));

vi.mock("@/components/agents/AgentLoginTerminalPanel", () => ({
  AgentLoginTerminalPanel: () => <div data-testid="login-terminal" />,
}));

function renderPane(harnessKind = "claude") {
  return render(<HarnessPane harnessKind={harnessKind} />);
}

function gatewayCard() {
  return screen.getByRole("button", { name: "Proliferate gateway" }) as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.cloudActive = true;
  state.capabilities.data = {
    gatewayEnabled: true,
    publicBaseUrl: "https://gateway.example",
    enrollmentStatus: "synced",
  };
  state.enrollment.data = undefined;
  state.selections.data = [];
  state.selections.isLoading = false;
  state.apiKeys.data = [];
  state.catalog.data = undefined;
  state.catalog.isLoading = false;
  state.agentsByKind = new Map();
  state.loginSessions = {};
  state.gatewayModels.data = undefined;
  state.gatewayModels.isLoading = false;
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
    renderPane("claude");

    fireEvent.click(screen.getByRole("radio", { name: "Cloud" }));
    fireEvent.click(gatewayCard());

    expect(putMutate).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "cloud" }),
      expect.anything(),
    );
  });

  it("opens the add-key modal when the API key card is clicked with no rows", () => {
    state.apiKeys.data = [{
      id: "key-1",
      title: "Work key",
      redactedHint: "sk-...abcd",
      status: "active",
      createdAt: "2026-07-01T00:00:00Z",
    }];
    renderPane("claude");

    // Clicking the API key card opens the create+bind modal (not an inline draft).
    fireEvent.click(screen.getByRole("button", { name: "API key" }));
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

    // Clicking "API key" card disables gateway (radio semantics) and opens the
    // add-key modal (no existing rows).
    fireEvent.click(screen.getByRole("button", { name: "API key" }));

    // The gateway is dropped from the desired set (radio semantics).
    expect(putMutate).toHaveBeenLastCalledWith(
      {
        harnessKind: "claude",
        surface: "local",
        body: {
          sources: [],
        },
      },
      expect.anything(),
    );
    // The modal is open for create+bind.
    expect(screen.getByTestId("add-key-modal")).toBeTruthy();
  });

  it("selects exactly one method for a single-source harness: API key then CLI ends on CLI", () => {
    renderPane("claude");

    const gateway = () =>
      screen.getByRole("button", { name: "Proliferate gateway" });
    const apiKey = () => screen.getByRole("button", { name: "API key" });
    const cli = () => screen.getByRole("button", { name: "CLI login" });

    // Clicking API key opens the modal and highlights ONLY the API key card —
    // gateway and api_key are never selected together on a single-source harness.
    fireEvent.click(apiKey());
    expect(apiKey().getAttribute("aria-pressed")).toBe("true");
    expect(gateway().getAttribute("aria-pressed")).toBe("false");
    expect(cli().getAttribute("aria-pressed")).toBe("false");
    // The add-key modal opens.
    expect(screen.getByTestId("add-key-modal")).toBeTruthy();

    // Clicking CLI cancels the modal intent and sticks on CLI.
    fireEvent.click(cli());
    expect(cli().getAttribute("aria-pressed")).toBe("true");
    expect(apiKey().getAttribute("aria-pressed")).toBe("false");
    expect(gateway().getAttribute("aria-pressed")).toBe("false");
  });

  it("shows the native empty-state copy when nothing is enabled", () => {
    renderPane("claude");
    expect(
      screen.queryByText(/No auth configured — the CLI's own login is used/),
    ).not.toBeNull();
  });

  it("shows cursor as native-only with no controls", () => {
    renderPane("cursor");

    expect(
      screen.queryByText(/authenticates with its own sign-in/),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Proliferate gateway" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add variable/ })).toBeNull();
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

  it("opencode: clicking API key opens the add-key modal and reflects the in-progress state", () => {
    renderPane("opencode");

    const apiKey = () => screen.getByRole("button", { name: "API key" });
    // Before the click there is no api_key detail block.
    expect(apiKey().getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: /Add provider/ })).toBeNull();

    fireEvent.click(apiKey());

    // The card lights immediately (pending) and the add-key modal is open.
    expect(apiKey().getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("add-key-modal")).toBeTruthy();
    // Nothing is PUT yet (no key wired).
    expect(putMutate).not.toHaveBeenCalled();

    // CLI stays always-selected and disabled (native coexistence) throughout.
    const cli = screen.getByRole("button", { name: "CLI login" }) as HTMLButtonElement;
    expect(cli.getAttribute("aria-pressed")).toBe("true");
    expect(cli.disabled).toBe(true);
  });

  it("opencode: toggling API key off darkens the card and closes the modal", () => {
    renderPane("opencode");

    const apiKey = () => screen.getByRole("button", { name: "API key" });

    fireEvent.click(apiKey());
    expect(apiKey().getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("add-key-modal")).toBeTruthy();

    // Clicking again turns api_key off: the modal closes and the highlight
    // clears, so "off" visibly means off.
    fireEvent.click(apiKey());
    expect(apiKey().getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("add-key-modal")).toBeNull();
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

  it("asks the user to sign in when cloud is inactive", () => {
    state.cloudActive = false;
    renderPane("claude");

    expect(screen.queryAllByText(/Sign in to Proliferate Cloud/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Proliferate gateway" })).toBeNull();
  });
});

describe("HarnessPane all models", () => {
  it("renders the layered catalog grid in the All Models section", () => {
    state.catalog.data = {
      harnessKind: "claude",
      surface: "local",
      route: "native",
      models: [
        { id: "sonnet", displayName: "Sonnet 4.6" },
        { id: "haiku", displayName: "Haiku 4.5", enabled: false },
      ],
      snapshotId: "snap-1",
      probedAt: null,
      source: "seed",
      overrideApplied: true,
    };
    renderPane("claude");



    expect(screen.queryByText("Sonnet 4.6")).not.toBeNull();
    // 2 model toggles + 1 settings switch (Pass model).
    expect(screen.getAllByRole("switch").length).toBeGreaterThanOrEqual(2);
  });

  it("refreshes the catalog for a native/api_key route using the runtime's resolved models", () => {
    state.catalog.data = {
      harnessKind: "claude",
      surface: "local",
      route: "native",
      models: [],
      snapshotId: null,
      probedAt: null,
      source: null,
      overrideApplied: false,
    };
    state.launchOptions.data = {
      agents: [
        {
          kind: "claude",
          displayName: "Claude Code",
          defaultModelId: "sonnet",
          models: [{ id: "sonnet", displayName: "Sonnet 4.6", isDefault: true }],
        },
      ],
    };
    renderPane("claude");


    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));

    expect(refreshMutate).toHaveBeenCalledWith(
      {
        harnessKind: "claude",
        body: {
          surface: "local",
          route: "native",
          modelsJson: JSON.stringify([{ id: "sonnet", displayName: "Sonnet 4.6" }]),
        },
      },
      expect.anything(),
    );
    expect(showToast).not.toHaveBeenCalled();
  });

  it("shows a toast and skips the server call when the local runtime has no models for this harness", () => {
    state.catalog.data = {
      harnessKind: "claude",
      surface: "local",
      route: "native",
      models: [],
      snapshotId: null,
      probedAt: null,
      source: null,
      overrideApplied: false,
    };
    // No launchOptions data mocked: stands in for a runtime that is
    // unreachable, or one with no ready models for this harness yet.
    renderPane("claude");


    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));

    expect(refreshMutate).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      "Local runtime unavailable — could not read Claude models.",
    );
  });

  it("upserts an override patch when a model is toggled off", () => {
    state.catalog.data = {
      harnessKind: "claude",
      surface: "local",
      route: "native",
      models: [
        { id: "sonnet", displayName: "Sonnet 4.6" },
        { id: "haiku", displayName: "Haiku 4.5", enabled: false },
      ],
      snapshotId: "snap-1",
      probedAt: null,
      source: "seed",
      overrideApplied: true,
    };
    renderPane("claude");


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

// Contract §5: local surface + gateway route reads the runtime's resolved
// gateway model plan instead of the cloud catalog.
function enableLocalGatewaySelection() {
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
}

describe("HarnessPane all models (local + gateway runtime)", () => {
  it("reads the runtime's resolved gateway models instead of the cloud catalog", () => {
    enableLocalGatewaySelection();
    state.gatewayModels.data = {
      models: [{ id: "claude-sonnet-4-5", displayName: "Sonnet 4.6", provider: "anthropic" }],
      source: "seed",
    };
    renderPane("claude");



    expect(screen.queryByText("Sonnet 4.6")).not.toBeNull();
    expect(screen.queryByText("seed")).not.toBeNull();
    // No override capability for runtime-resolved models: the model switch is
    // present (all resolved models are "on") but disabled.
    const allSwitches = screen.getAllByRole("switch") as HTMLButtonElement[];
    const modelSwitch = allSwitches[allSwitches.length - 1]; // Last switch is the model toggle
    expect(modelSwitch.getAttribute("aria-checked")).toBe("true");
    expect(modelSwitch.disabled).toBe(true);
  });

  it("shows a localized probed time when the runtime has a live probe", () => {
    enableLocalGatewaySelection();
    state.gatewayModels.data = {
      models: [{ id: "claude-sonnet-4-5" }],
      source: "probe",
      probedAt: "2026-07-02T20:00:00Z",
    };
    renderPane("claude");



    expect(
      screen.queryByText(`probed ${new Date("2026-07-02T20:00:00Z").toLocaleString()}`),
    ).not.toBeNull();
  });

  it("hits the runtime refresh endpoint for local+gateway instead of the cloud refresh", () => {
    enableLocalGatewaySelection();
    state.gatewayModels.data = { models: [], source: "seed" };
    renderPane("claude");


    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));

    expect(refreshGatewayModelsMutate).toHaveBeenCalledWith("claude", expect.anything());
    expect(refreshMutate).not.toHaveBeenCalled();
  });
});
