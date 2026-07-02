// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessPane } from "./HarnessPane";

/**
 * Runtime-scope behavior of the per-harness pages: the direct family
 * (This Mac + enrolled ssh targets) in the scope selector, per-target
 * override writes, inherited-vs-override display, and configure-while-
 * offline. Split from HarnessPane.test.tsx to respect the component
 * file-size cap.
 */

const PROVIDERS = vi.hoisted(() => [
  {
    id: "anthropic",
    label: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    keyUrl: "https://console.anthropic.com/settings/keys",
    harnesses: ["claude", "opencode"],
    recommendedFor: ["claude", "opencode"],
  },
]);

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
    },
  },
  enrollment: { data: undefined },
  selections: {
    data: { selections: [] as Array<Record<string, unknown>> } as
      | { selections: Array<Record<string, unknown>> }
      | undefined,
    isLoading: false,
  },
  overrides: {
    data: { selections: [] as Array<Record<string, unknown>> } as
      | { selections: Array<Record<string, unknown>> }
      | undefined,
    isLoading: false,
  },
  targets: {
    data: [] as Array<Record<string, unknown>> | undefined,
  },
  attachStates: {} as Record<string, string>,
  apiKeys: { data: { keys: [] as Array<Record<string, unknown>> } },
  catalog: { data: undefined, isLoading: false },
  agentsByKind: new Map<string, LocalAgent>(),
  loginSessions: {} as Record<string, unknown>,
}));
const upsertMutate = vi.hoisted(() => vi.fn());
const clearMutate = vi.hoisted(() => vi.fn());

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentGatewayCapabilities: () => state.capabilities,
  useAgentGatewayEnrollment: () => state.enrollment,
  useRouteSelections: (_enabled?: boolean, options?: { targetId?: string | null }) =>
    options?.targetId ? state.overrides : state.selections,
  useAgentApiKeys: () => state.apiKeys,
  useAgentCatalog: () => state.catalog,
  useUpsertRouteSelection: () => ({ mutate: upsertMutate, isPending: false }),
  useClearRouteSelection: () => ({ mutate: clearMutate, isPending: false }),
  useCreateAgentApiKey: () => ({ mutate: vi.fn(), isPending: false }),
  useRefreshAgentCatalog: () => ({ mutate: vi.fn(), isPending: false }),
  useUpsertCatalogOverride: () => ({ mutate: vi.fn(), isPending: false }),
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
    openAuthTerminal: vi.fn(),
    closeAuthTerminal: vi.fn(),
    handleTerminalExit: vi.fn(),
  }),
}));

vi.mock("@/components/agents/AgentLoginTerminalPanel", () => ({
  AgentLoginTerminalPanel: () => <div data-testid="login-terminal" />,
}));

vi.mock("@/hooks/access/cloud/targets/use-cloud-targets", () => ({
  useCloudTargets: () => state.targets,
  useCloudTarget: () => ({ data: undefined }),
}));

vi.mock("@/hooks/settings/workflows/use-ssh-direct-target-profile", () => ({
  useComputeTargetAppearancePreferences: () => ({
    preferences: {},
    loading: false,
    reload: vi.fn(),
    savePreference: vi.fn(),
  }),
}));

vi.mock("@/hooks/compute/derived/use-direct-runtime-attach-states", () => ({
  useDirectRuntimeAttachStateResolver: () => (targetId: string | null) =>
    targetId === null ? "attached" : state.attachStates[targetId] ?? "detached",
  useDirectRuntimeAttachState: (targetId: string | null) =>
    targetId === null ? "attached" : state.attachStates[targetId] ?? "detached",
}));

vi.mock("@/hooks/compute/derived/use-loopback-runtime-name", () => ({
  useLoopbackRuntimeDisplayName: () => "This Mac",
}));

function renderPane(harnessKind = "claude") {
  return render(<HarnessPane harnessKind={harnessKind} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.cloudActive = true;
  state.selections.data = { selections: [] };
  state.selections.isLoading = false;
  state.overrides.data = { selections: [] };
  state.overrides.isLoading = false;
  state.targets.data = [];
  state.attachStates = {};
  state.agentsByKind = new Map();
  state.loginSessions = {};
});

const HOMELAB_TARGET = {
  id: "t-1",
  displayName: "Homelab",
  kind: "ssh",
  status: "online",
  ownerScope: "personal",
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

describe("HarnessPane runtime scopes", () => {
  it("lists This Mac and each enrolled runtime in the scope selector", () => {
    state.targets.data = [HOMELAB_TARGET];
    renderPane();

    expect(screen.queryByRole("radio", { name: "Cloud" })).not.toBeNull();
    expect(screen.queryByRole("radio", { name: /This Mac/ })).not.toBeNull();
    expect(screen.queryByRole("radio", { name: /Homelab/ })).not.toBeNull();
    expect(
      screen.getByRole("radio", { name: /This Mac/ }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("scopes route writes to the selected runtime", () => {
    state.targets.data = [HOMELAB_TARGET];
    state.attachStates = { "t-1": "attached" };
    renderPane();

    fireEvent.click(screen.getByRole("radio", { name: /Homelab/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Proliferate gateway/ }));

    expect(upsertMutate).toHaveBeenCalledWith(
      {
        harnessKind: "claude",
        surface: "local",
        targetId: "t-1",
        body: { route: "gateway", slot: "primary" },
      },
      expect.anything(),
    );
  });

  it("marks a runtime without overrides as inherited from defaults", () => {
    state.targets.data = [HOMELAB_TARGET];
    state.attachStates = { "t-1": "attached" };
    state.selections.data = {
      selections: [{
        id: "d-1",
        harnessKind: "claude",
        surface: "local",
        targetId: null,
        slot: "primary",
        route: "gateway",
        apiKeyId: null,
      }],
    };
    renderPane();

    fireEvent.click(screen.getByRole("radio", { name: /Homelab/ }));

    expect(screen.queryByText("Inherited from defaults")).not.toBeNull();
    expect(
      screen
        .getByRole("radio", { name: /Proliferate gateway/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.queryByRole("button", { name: "Use default" })).toBeNull();
  });

  it("marks an override and clears it back to defaults with the targetId", () => {
    state.targets.data = [HOMELAB_TARGET];
    state.attachStates = { "t-1": "attached" };
    state.selections.data = {
      selections: [{
        id: "d-1",
        harnessKind: "claude",
        surface: "local",
        targetId: null,
        slot: "primary",
        route: "gateway",
        apiKeyId: null,
      }],
    };
    state.overrides.data = {
      selections: [{
        id: "o-1",
        harnessKind: "claude",
        surface: "local",
        targetId: "t-1",
        slot: "primary",
        route: "native",
        apiKeyId: null,
      }],
    };
    renderPane();

    fireEvent.click(screen.getByRole("radio", { name: /Homelab/ }));

    expect(screen.queryByText("Override")).not.toBeNull();
    expect(
      screen.getByRole("radio", { name: /Native/ }).getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Use default" }));

    expect(clearMutate).toHaveBeenCalledWith(
      { harnessKind: "claude", surface: "local", targetId: "t-1" },
      expect.anything(),
    );
  });

  it("keeps a detached runtime editable and shows the deferred-apply note", () => {
    state.targets.data = [HOMELAB_TARGET];
    state.attachStates = { "t-1": "detached" };
    renderPane();

    fireEvent.click(screen.getByRole("radio", { name: /Homelab/ }));

    expect(
      screen.queryByText(/Changes are saved and apply when this machine attaches/),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /Proliferate gateway/ }));
    expect(upsertMutate).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: "t-1" }),
      expect.anything(),
    );
  });

  it("hides Run login on a remote runtime scope", () => {
    state.targets.data = [HOMELAB_TARGET];
    state.attachStates = { "t-1": "attached" };
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

    expect(screen.queryByRole("button", { name: "Run login" })).not.toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /Homelab/ }));

    expect(screen.queryByRole("button", { name: "Run login" })).toBeNull();
  });

});
