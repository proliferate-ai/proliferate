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

vi.mock("@/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: state.cloudActive }),
}));

vi.mock("@/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({ agentsByKind: state.agentsByKind }),
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

function gatewaySwitch() {
  return screen.getByRole("switch", { name: "Proliferate gateway" }) as HTMLButtonElement;
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

    const gateway = gatewaySwitch();
    expect(gateway.getAttribute("aria-checked")).toBe("false");

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
    fireEvent.click(gatewaySwitch());

    expect(putMutate).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "cloud" }),
      expect.anything(),
    );
  });

  it("adds an api-key variable prefilled from suggestions and wires a key", () => {
    state.apiKeys.data = [{
      id: "key-1",
      title: "Work key",
      redactedHint: "sk-...abcd",
      status: "active",
      createdAt: "2026-07-01T00:00:00Z",
    }];
    renderPane("claude");

    fireEvent.click(screen.getByRole("button", { name: /Add variable/ }));
    expect(screen.getByDisplayValue("ANTHROPIC_API_KEY")).toBeTruthy();
    // No PUT until the row names a key.
    expect(putMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Select an API key/ }));
    fireEvent.click(screen.getByText("Work key"));

    expect(putMutate).toHaveBeenCalledWith(
      {
        harnessKind: "claude",
        surface: "local",
        body: {
          sources: [{
            sourceKind: "api_key",
            apiKeyId: "key-1",
            envVarName: "ANTHROPIC_API_KEY",
            providerHint: "anthropic",
            enabled: false,
          }],
        },
      },
      expect.anything(),
    );

    fireEvent.click(screen.getByRole("switch", { name: "Enable ANTHROPIC_API_KEY" }));

    expect(putMutate).toHaveBeenLastCalledWith(
      {
        harnessKind: "claude",
        surface: "local",
        body: {
          sources: [{
            sourceKind: "api_key",
            apiKeyId: "key-1",
            envVarName: "ANTHROPIC_API_KEY",
            providerHint: "anthropic",
            enabled: true,
          }],
        },
      },
      expect.anything(),
    );
  });

  it("turns the gateway off when an api-key row is enabled on a single-source harness", () => {
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

    expect(gatewaySwitch().getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Add variable/ }));
    fireEvent.click(screen.getByRole("button", { name: /Select an API key/ }));
    fireEvent.click(screen.getByText("Work key"));
    fireEvent.click(screen.getByRole("switch", { name: "Enable ANTHROPIC_API_KEY" }));

    // The gateway is dropped from the desired set (radio semantics).
    expect(putMutate).toHaveBeenLastCalledWith(
      {
        harnessKind: "claude",
        surface: "local",
        body: {
          sources: [{
            sourceKind: "api_key",
            apiKeyId: "key-1",
            envVarName: "ANTHROPIC_API_KEY",
            providerHint: "anthropic",
            enabled: true,
          }],
        },
      },
      expect.anything(),
    );
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
    expect(screen.queryByRole("switch", { name: "Proliferate gateway" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add variable/ })).toBeNull();
  });

  it("offers Add provider only for opencode", () => {
    renderPane("opencode");
    expect(screen.queryByRole("button", { name: /Add provider/ })).not.toBeNull();
  });

  it("does not offer Add provider for single-source harnesses", () => {
    renderPane("claude");
    expect(screen.queryByRole("button", { name: /Add provider/ })).toBeNull();
  });

  it("prefills a new row from the opencode provider picker", () => {
    renderPane("opencode");

    fireEvent.click(screen.getByRole("button", { name: /Add provider/ }));
    fireEvent.click(screen.getByRole("button", { name: "pick-openrouter" }));

    expect(screen.getByDisplayValue("OPENROUTER_API_KEY")).toBeTruthy();
  });

  it("disables the gateway toggle with a subtitle when the gateway is unavailable", () => {
    state.capabilities.data = {
      gatewayEnabled: false,
      publicBaseUrl: null,
      enrollmentStatus: "disabled",
    };
    renderPane("claude");

    expect(gatewaySwitch().disabled).toBe(true);
    expect(screen.queryByText("Unavailable for your account")).not.toBeNull();

    fireEvent.click(gatewaySwitch());
    expect(putMutate).not.toHaveBeenCalled();
  });

  it("disables the gateway toggle while enrollment is unsynced", () => {
    state.enrollment.data = { syncStatus: "pending", lastErrorCode: null };
    renderPane("claude");

    expect(gatewaySwitch().disabled).toBe(true);
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

    fireEvent.click(screen.getByRole("button", { name: "Run login" }));

    expect(openAuthTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "claude" }),
      { restart: false },
    );
  });

  it("asks the user to sign in when cloud is inactive", () => {
    state.cloudActive = false;
    renderPane("claude");

    expect(screen.queryByText(/Sign in to Proliferate Cloud/)).not.toBeNull();
    expect(screen.queryByRole("switch", { name: "Proliferate gateway" })).toBeNull();
  });
});

describe("HarnessPane all models", () => {
  it("renders the layered catalog grid on the All Models subtab", () => {
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

    fireEvent.click(screen.getByRole("tab", { name: "All Models" }));

    expect(screen.queryByText("Sonnet 4.6")).not.toBeNull();
    expect(screen.getAllByRole("switch")).toHaveLength(2);
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

    fireEvent.click(screen.getByRole("tab", { name: "All Models" }));
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));

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

    fireEvent.click(screen.getByRole("tab", { name: "All Models" }));
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));

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

    fireEvent.click(screen.getByRole("tab", { name: "All Models" }));
    const [sonnetSwitch] = screen.getAllByRole("switch");
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

    fireEvent.click(screen.getByRole("tab", { name: "All Models" }));

    expect(screen.queryByText("Sonnet 4.6")).not.toBeNull();
    expect(screen.queryByText("seed")).not.toBeNull();
    // No override capability for runtime-resolved models: the switch is
    // present (all resolved models are "on") but disabled.
    const [modelSwitch] = screen.getAllByRole("switch") as HTMLButtonElement[];
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

    fireEvent.click(screen.getByRole("tab", { name: "All Models" }));

    expect(
      screen.queryByText(`probed ${new Date("2026-07-02T20:00:00Z").toLocaleString()}`),
    ).not.toBeNull();
  });

  it("hits the runtime refresh endpoint for local+gateway instead of the cloud refresh", () => {
    enableLocalGatewaySelection();
    state.gatewayModels.data = { models: [], source: "seed" };
    renderPane("claude");

    fireEvent.click(screen.getByRole("tab", { name: "All Models" }));
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));

    expect(refreshGatewayModelsMutate).toHaveBeenCalledWith("claude", expect.anything());
    expect(refreshMutate).not.toHaveBeenCalled();
  });
});
