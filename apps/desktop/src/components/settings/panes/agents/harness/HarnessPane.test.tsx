// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessPane } from "./HarnessPane";

const PROVIDERS = vi.hoisted(() => [
  {
    id: "anthropic",
    label: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    keyUrl: "https://console.anthropic.com/settings/keys",
    harnesses: ["claude", "opencode"],
    recommendedFor: ["claude", "opencode"],
  },
  {
    id: "openai",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    keyUrl: "https://platform.openai.com/api-keys",
    harnesses: ["codex", "opencode"],
    recommendedFor: ["codex"],
  },
]);

type CapabilitiesData = {
  gatewayEnabled: boolean;
  publicBaseUrl: string | null;
  enrollmentStatus: string;
  providers?: typeof PROVIDERS;
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
      providers: PROVIDERS,
    } as CapabilitiesData | undefined,
  },
  enrollment: {
    data: undefined as
      | { syncStatus: string; lastErrorCode: string | null }
      | undefined,
  },
  selections: {
    data: { selections: [] as Array<Record<string, unknown>> } as
      | { selections: Array<Record<string, unknown>> }
      | undefined,
    isLoading: false,
  },
  apiKeys: {
    data: { keys: [] as Array<Record<string, unknown>> } as
      | { keys: Array<Record<string, unknown>> }
      | undefined,
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
    message: string | null;
    errorMessage: string | null;
    isStarting: boolean;
    focusRequestToken: number;
  }>,
}));
const upsertMutate = vi.hoisted(() => vi.fn());
const clearMutate = vi.hoisted(() => vi.fn());
const createKeyMutate = vi.hoisted(() => vi.fn());
const refreshMutate = vi.hoisted(() => vi.fn());
const overrideMutate = vi.hoisted(() => vi.fn());
const openAuthTerminal = vi.hoisted(() => vi.fn());
const closeAuthTerminal = vi.hoisted(() => vi.fn());
const handleTerminalExit = vi.hoisted(() => vi.fn());

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentGatewayCapabilities: () => state.capabilities,
  useAgentGatewayEnrollment: () => state.enrollment,
  useRouteSelections: () => state.selections,
  useAgentApiKeys: () => state.apiKeys,
  useAgentCatalog: () => state.catalog,
  useUpsertRouteSelection: () => ({ mutate: upsertMutate, isPending: false }),
  useClearRouteSelection: () => ({ mutate: clearMutate, isPending: false }),
  useCreateAgentApiKey: () => ({ mutate: createKeyMutate, isPending: false }),
  useRefreshAgentCatalog: () => ({ mutate: refreshMutate, isPending: false }),
  useUpsertCatalogOverride: () => ({ mutate: overrideMutate, isPending: false }),
}));

vi.mock("@/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: state.cloudActive }),
}));

vi.mock("@/hooks/access/tauri/use-shell-actions", () => ({
  useTauriShellActions: () => ({ openExternal: vi.fn() }),
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.cloudActive = true;
  state.capabilities.data = {
    gatewayEnabled: true,
    publicBaseUrl: "https://gateway.example",
    enrollmentStatus: "synced",
    providers: PROVIDERS,
  };
  state.enrollment.data = undefined;
  state.selections.data = { selections: [] };
  state.selections.isLoading = false;
  state.apiKeys.data = { keys: [] };
  state.catalog.data = undefined;
  state.catalog.isLoading = false;
  state.agentsByKind = new Map();
  state.loginSessions = {};
});

describe("HarnessPane", () => {
  it("shows all three route cards on local and defaults to native", () => {
    renderPane();

    expect(
      screen.getByRole("radio", { name: /Native/ }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("radio", { name: /Proliferate gateway/ })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      screen.getByRole("radio", { name: /API key/ }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("hides the native card on the cloud surface", () => {
    renderPane();

    fireEvent.click(screen.getByRole("radio", { name: "Cloud" }));

    expect(screen.queryByRole("radio", { name: /Native/ })).toBeNull();
    expect(screen.queryByRole("radio", { name: /Proliferate gateway/ })).not.toBeNull();
  });

  it("persists the gateway route for the selected surface", () => {
    renderPane();

    fireEvent.click(screen.getByRole("radio", { name: "Cloud" }));
    fireEvent.click(screen.getByRole("radio", { name: /API key/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Proliferate gateway/ }));

    expect(upsertMutate).toHaveBeenCalledWith(
      {
        harnessKind: "claude",
        surface: "cloud",
        body: { route: "gateway", slot: "primary" },
      },
      expect.anything(),
    );
  });

  it("waits for an explicit key choice before persisting the api_key route", () => {
    state.apiKeys.data = {
      keys: [{
        id: "key-1",
        provider: "anthropic",
        displayName: "Work key",
        redactedHint: "sk-...abcd",
        status: "active",
        lastValidatedAt: null,
        createdAt: "2026-07-01T00:00:00Z",
      }],
    };
    renderPane();

    fireEvent.click(screen.getByRole("radio", { name: /API key/ }));
    expect(upsertMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Select an API key/ }));
    fireEvent.click(screen.getByText("Work key"));

    expect(upsertMutate).toHaveBeenCalledWith(
      {
        harnessKind: "claude",
        surface: "local",
        body: { route: "api_key", apiKeyId: "key-1", slot: "primary" },
      },
      expect.anything(),
    );
  });

  it("disables the gateway card with a subtitle when the gateway is unavailable", () => {
    state.capabilities.data = {
      gatewayEnabled: false,
      publicBaseUrl: null,
      enrollmentStatus: "disabled",
    };
    renderPane();

    const gatewayCard = screen.getByRole("radio", {
      name: /Proliferate gateway/,
    }) as HTMLButtonElement;
    expect(gatewayCard.disabled).toBe(true);
    expect(screen.queryByText("Unavailable for your account")).not.toBeNull();

    fireEvent.click(gatewayCard);
    expect(upsertMutate).not.toHaveBeenCalled();
  });

  it("disables the gateway card while enrollment is unsynced", () => {
    state.enrollment.data = { syncStatus: "pending", lastErrorCode: null };
    renderPane();

    const gatewayCard = screen.getByRole("radio", {
      name: /Proliferate gateway/,
    }) as HTMLButtonElement;
    expect(gatewayCard.disabled).toBe(true);
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
    renderPane();

    fireEvent.click(screen.getByRole("button", { name: "Run login" }));

    expect(openAuthTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "claude" }),
      { restart: false },
    );
  });

  it("hides Run login when the local agent is already ready", () => {
    state.agentsByKind = new Map([[
      "claude",
      {
        kind: "claude",
        displayName: "Claude Code",
        readiness: "ready",
        supportsLogin: true,
      },
    ]]);
    renderPane();

    expect(screen.queryByRole("button", { name: "Run login" })).toBeNull();
  });

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
    renderPane();

    fireEvent.click(screen.getByRole("tab", { name: "All Models" }));

    expect(screen.queryByText("Sonnet 4.6")).not.toBeNull();
    expect(screen.queryByText("Haiku 4.5")).not.toBeNull();

    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(2);
  });

  it("refreshes the catalog for the current surface and route", () => {
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
    renderPane();

    fireEvent.click(screen.getByRole("tab", { name: "All Models" }));
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));

    expect(refreshMutate).toHaveBeenCalledWith(
      {
        harnessKind: "claude",
        body: { surface: "local", route: "native" },
      },
      expect.anything(),
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
    renderPane();

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

  it("renders additive source switches for opencode", () => {
    renderPane("opencode");

    expect(screen.queryByRole("radio", { name: /Native/ })).toBeNull();
    expect(
      screen.queryByRole("switch", { name: "Proliferate gateway" }),
    ).not.toBeNull();
    expect(screen.queryByRole("switch", { name: "Anthropic key" })).not.toBeNull();
    expect(screen.queryByRole("switch", { name: "OpenAI key" })).not.toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: "Proliferate gateway" }));

    expect(upsertMutate).toHaveBeenCalledWith(
      {
        harnessKind: "opencode",
        surface: "local",
        body: { route: "gateway", slot: "gateway" },
      },
      expect.anything(),
    );
  });

  it("asks the user to sign in when cloud is inactive", () => {
    state.cloudActive = false;
    renderPane();

    expect(screen.queryByText(/Sign in to Proliferate Cloud/)).not.toBeNull();
    expect(screen.queryByRole("radio", { name: /Native/ })).toBeNull();
  });
});
