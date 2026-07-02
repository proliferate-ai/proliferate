// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenCodeAuthSection } from "./OpenCodeAuthSection";

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
  {
    id: "xai",
    label: "xAI",
    envKey: "XAI_API_KEY",
    keyUrl: "https://console.x.ai",
    harnesses: ["grok"],
    recommendedFor: ["grok"],
  },
]);

const state = vi.hoisted(() => ({
  cloudActive: true,
  capabilities: {
    data: {
      gatewayEnabled: true,
      publicBaseUrl: "https://gateway.example",
      enrollmentStatus: "synced",
      providers: PROVIDERS,
    } as
      | {
        gatewayEnabled: boolean;
        publicBaseUrl: string | null;
        enrollmentStatus: string;
        providers: typeof PROVIDERS;
      }
      | undefined,
    isLoading: false,
  },
  enrollment: { data: undefined },
  selections: {
    data: { selections: [] as Array<Record<string, unknown>> },
    isLoading: false,
  },
  apiKeys: { data: { keys: [] as Array<Record<string, unknown>> } },
}));
const upsertMutate = vi.hoisted(() => vi.fn());
const clearMutate = vi.hoisted(() => vi.fn());
const createKeyMutate = vi.hoisted(() => vi.fn());
const openExternal = vi.hoisted(() => vi.fn());

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
  useTauriShellActions: () => ({ openExternal }),
}));

function selection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "sel-1",
    harnessKind: "opencode",
    surface: "local",
    slot: "gateway",
    route: "gateway",
    apiKeyId: null,
    revision: 1,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function renderSection() {
  return render(<OpenCodeAuthSection displayName="OpenCode" />);
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
  state.capabilities.isLoading = false;
  state.selections.data = { selections: [] };
  state.selections.isLoading = false;
  state.apiKeys.data = { keys: [] };
});

describe("OpenCodeAuthSection", () => {
  it("asks the user to sign in when cloud is inactive", () => {
    state.cloudActive = false;
    renderSection();

    expect(screen.queryByText(/Sign in to Proliferate Cloud/)).not.toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("renders a gateway toggle plus one row per opencode-capable provider", () => {
    renderSection();

    expect(screen.queryByText("Proliferate gateway")).not.toBeNull();
    // anthropic + openai serve opencode; xai (grok-only here) is filtered out.
    expect(screen.queryByText("Anthropic")).not.toBeNull();
    expect(screen.queryByText("OpenAI")).not.toBeNull();
    expect(screen.queryByText("xAI")).toBeNull();
    // Registry-driven recommendation badge.
    expect(screen.queryByText("Recommended")).not.toBeNull();
  });

  it("toggling the gateway on upserts the gateway slot", () => {
    renderSection();

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

  it("toggling the gateway off clears only the gateway slot", () => {
    state.selections.data = { selections: [selection()] };
    renderSection();

    fireEvent.click(screen.getByRole("switch", { name: "Proliferate gateway" }));

    expect(clearMutate).toHaveBeenCalledWith(
      { harnessKind: "opencode", surface: "local", slot: "gateway" },
      expect.anything(),
    );
    expect(upsertMutate).not.toHaveBeenCalled();
  });

  it("enabling a provider waits for a key pick, then upserts that slot", () => {
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

    fireEvent.click(screen.getByRole("switch", { name: "Anthropic key" }));
    expect(upsertMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Select an API key/ }));
    fireEvent.click(screen.getByText("Work key"));

    expect(upsertMutate).toHaveBeenCalledWith(
      {
        harnessKind: "opencode",
        surface: "local",
        body: { route: "api_key", apiKeyId: "key-1", slot: "anthropic" },
      },
      expect.anything(),
    );
  });

  it("disabling a provider clears its slot", () => {
    state.selections.data = {
      selections: [
        selection({ id: "sel-2", slot: "anthropic", route: "api_key", apiKeyId: "key-1" }),
      ],
    };
    renderSection();

    fireEvent.click(screen.getByRole("switch", { name: "Anthropic key" }));

    expect(clearMutate).toHaveBeenCalledWith(
      { harnessKind: "opencode", surface: "local", slot: "anthropic" },
      expect.anything(),
    );
  });

  it("gateway and provider toggles are independent (both can be on)", () => {
    state.selections.data = {
      selections: [
        selection(),
        selection({ id: "sel-2", slot: "anthropic", route: "api_key", apiKeyId: "key-1" }),
      ],
    };
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

    const gatewaySwitch = screen.getByRole("switch", { name: "Proliferate gateway" });
    const anthropicSwitch = screen.getByRole("switch", { name: "Anthropic key" });
    expect(gatewaySwitch.getAttribute("aria-checked")).toBe("true");
    expect(anthropicSwitch.getAttribute("aria-checked")).toBe("true");
  });

  it("links to the provider's key console via the registry url", () => {
    renderSection();

    fireEvent.click(screen.getAllByRole("button", { name: /Get an API key/ })[0]);

    expect(openExternal).toHaveBeenCalledWith(
      "https://console.anthropic.com/settings/keys",
    );
  });
});
