// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentAuthenticationSection } from "./AgentAuthenticationSection";

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
}));
const upsertMutate = vi.hoisted(() => vi.fn());
const clearMutate = vi.hoisted(() => vi.fn());
const createKeyMutate = vi.hoisted(() => vi.fn());

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentGatewayCapabilities: () => state.capabilities,
  useAgentGatewayEnrollment: () => state.enrollment,
  useRouteSelections: () => state.selections,
  useAgentApiKeys: () => state.apiKeys,
  useUpsertRouteSelection: () => ({ mutate: upsertMutate, isPending: false }),
  useClearRouteSelection: () => ({ mutate: clearMutate, isPending: false }),
  useCreateAgentApiKey: () => ({ mutate: createKeyMutate, isPending: false }),
}));

vi.mock("@/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: state.cloudActive }),
}));

vi.mock("@/hooks/access/tauri/use-shell-actions", () => ({
  useTauriShellActions: () => ({ openExternal: vi.fn() }),
}));

function selection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "sel-1",
    harnessKind: "claude",
    surface: "local",
    route: "gateway",
    apiKeyId: null,
    revision: 1,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function renderSection() {
  return render(
    <AgentAuthenticationSection agentKind="claude" displayName="Claude Code" />,
  );
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
});

describe("AgentAuthenticationSection", () => {
  it("asks the user to sign in when cloud is inactive", () => {
    state.cloudActive = false;
    renderSection();

    expect(
      screen.queryByText(/Sign in to Proliferate Cloud/),
    ).not.toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("shows all three routes on the local surface and defaults to native", () => {
    renderSection();

    expect(screen.queryByText("Proliferate gateway")).not.toBeNull();
    expect(screen.queryByText("API key")).not.toBeNull();
    expect(screen.queryByText("Native")).not.toBeNull();

    // Native is the default local route → its radio is the checked one.
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

  it("hides the native route on the cloud surface", () => {
    renderSection();

    fireEvent.click(screen.getByRole("tab", { name: "Cloud" }));

    expect(screen.queryByText("Native")).toBeNull();
  });

  it("upserts the gateway route when selected", () => {
    renderSection();

    fireEvent.click(screen.getByText("Proliferate gateway"));

    expect(upsertMutate).toHaveBeenCalledWith(
      {
        harnessKind: "claude",
        surface: "local",
        body: { route: "gateway", slot: "primary" },
      },
      expect.anything(),
    );
  });

  it("disables the gateway option and explains when the gateway is off", () => {
    state.capabilities.data = {
      gatewayEnabled: false,
      publicBaseUrl: null,
      enrollmentStatus: "disabled",
    };
    renderSection();

    const gatewayRow = screen.getByText("Proliferate gateway").closest("button");
    expect(gatewayRow?.disabled).toBe(true);
    expect(
      screen.queryByText(/managed gateway is currently unavailable/),
    ).not.toBeNull();

    fireEvent.click(screen.getByText("Proliferate gateway"));
    expect(upsertMutate).not.toHaveBeenCalled();
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
    renderSection();

    fireEvent.click(screen.getByText("API key"));
    expect(upsertMutate).not.toHaveBeenCalled();

    // The KeyPicker replaced the raw select: open it and pick by name.
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

  it("keeps the api_key route selected after choosing a key until the refetch resolves", () => {
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
    renderSection();

    fireEvent.click(screen.getByText("API key"));
    fireEvent.click(screen.getByRole("button", { name: /Select an API key/ }));
    fireEvent.click(screen.getByText("Work key"));

    // Mutation resolves, but the invalidated selections query has NOT refetched
    // yet (state.selections.data is still the stale empty list). The optimistic
    // selection must keep the api_key route + key picker in place.
    const lastCall =
      upsertMutate.mock.calls[upsertMutate.mock.calls.length - 1];
    const onSuccess = lastCall?.[1]?.onSuccess as (() => void) | undefined;
    act(() => {
      onSuccess?.();
    });

    expect(screen.queryByText("Work key (sk-...abcd)")).not.toBeNull();
    expect(
      screen.getByRole("radio", { name: /API key/ }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("disables the gateway route while capabilities are still unknown", () => {
    state.capabilities.data = undefined;
    renderSection();

    const gatewayRow = screen.getByRole("radio", {
      name: /Proliferate gateway/,
    }) as HTMLButtonElement;
    expect(gatewayRow.disabled).toBe(true);

    fireEvent.click(gatewayRow);
    expect(upsertMutate).not.toHaveBeenCalled();

    // No "known unavailable" copy while merely loading.
    expect(
      screen.queryByText(/managed gateway is currently unavailable/),
    ).toBeNull();
  });

  it("filters the key pool to the harness's direct provider", () => {
    state.apiKeys.data = {
      keys: [
        {
          id: "key-1",
          provider: "anthropic",
          displayName: "Anthropic key",
          redactedHint: "sk-...abcd",
          status: "active",
          lastValidatedAt: null,
          createdAt: "2026-07-01T00:00:00Z",
        },
        {
          id: "key-2",
          provider: "openai",
          displayName: "OpenAI key",
          redactedHint: "sk-...zzzz",
          status: "active",
          lastValidatedAt: null,
          createdAt: "2026-07-01T00:00:00Z",
        },
      ],
    };
    renderSection();

    fireEvent.click(screen.getByText("API key"));
    fireEvent.click(screen.getByRole("button", { name: /Select an API key/ }));

    // Claude's direct provider is anthropic (from the capabilities registry).
    expect(screen.queryByText("Anthropic key")).not.toBeNull();
    expect(screen.queryByText("OpenAI key")).toBeNull();
  });

  it("offers inline key creation when the pool is empty", () => {
    renderSection();

    fireEvent.click(screen.getByText("API key"));
    fireEvent.click(screen.getByRole("button", { name: /Select an API key/ }));

    expect(screen.queryByText("+ Add new key")).not.toBeNull();
  });

  it("clears the selection from the reset button", () => {
    state.selections.data = { selections: [selection()] };
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));

    expect(clearMutate).toHaveBeenCalledWith(
      { harnessKind: "claude", surface: "local" },
      expect.anything(),
    );
  });

  it("reads the persisted selection for the active surface", () => {
    state.selections.data = {
      selections: [
        selection({ surface: "cloud", route: "api_key", apiKeyId: "key-9" }),
      ],
    };
    state.apiKeys.data = {
      keys: [{
        id: "key-9",
        provider: "anthropic",
        displayName: "Cloud key",
        redactedHint: "sk-...zzzz",
        status: "active",
        lastValidatedAt: null,
        createdAt: "2026-07-01T00:00:00Z",
      }],
    };
    renderSection();

    fireEvent.click(screen.getByRole("tab", { name: "Cloud" }));

    // The picker trigger summarizes the attached key; the secret stays hidden.
    expect(
      screen.queryByRole("button", { name: /Cloud key \(sk-\.\.\.zzzz\)/ }),
    ).not.toBeNull();
  });
});
