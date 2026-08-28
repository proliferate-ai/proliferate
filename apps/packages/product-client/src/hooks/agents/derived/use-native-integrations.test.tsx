// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeIntegrationsResponse } from "@anyharness/sdk";
import { useNativeIntegrations } from "#product/hooks/agents/derived/use-native-integrations";

const clientMocks = vi.hoisted(() => ({
  listNativeIntegrations: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAnyHarnessCacheScopeKey: () => "test-scope",
  getAnyHarnessClient: () => ({ agents: clientMocks }),
}));

vi.mock("#product/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (
    selector: (state: { runtimeUrl: string; connectionState: string }) => unknown,
  ) => selector({ runtimeUrl: "http://127.0.0.1:8457", connectionState: "healthy" }),
}));

const response: NativeIntegrationsResponse = {
  agentKind: "codex",
  integrations: [
    {
      id: "mcp:linear",
      agentKind: "codex",
      kind: "mcp_stdio",
      displayName: "linear",
      source: "~/.codex/config.toml · mcp_servers.linear",
      available: true,
      risk: "none",
      enabled: true,
    },
    {
      id: "bundle:computer-use",
      agentKind: "codex",
      kind: "bundle",
      displayName: "Computer Use",
      description: "Drive the desktop through the Codex app.",
      available: true,
      risk: "desktop_control",
      enabled: false,
    },
  ],
  staleSelections: ["mcp:removed-server"],
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useNativeIntegrations", () => {
  beforeEach(() => {
    clientMocks.listNativeIntegrations.mockReset();
  });
  afterEach(cleanup);

  it("orders bundles before raw servers and appends stale selections last", async () => {
    clientMocks.listNativeIntegrations.mockResolvedValue(response);
    const { result } = renderHook(() => useNativeIntegrations("codex", true), { wrapper });

    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    expect(result.current.rows.map((row) => row.id)).toEqual([
      "bundle:computer-use",
      "mcp:linear",
      "mcp:removed-server",
    ]);
  });

  it("maps curated bundles to their registered glyph namespaces and leaves raw ids on the Plug fallback", async () => {
    clientMocks.listNativeIntegrations.mockResolvedValue(response);
    const { result } = renderHook(() => useNativeIntegrations("codex", true), { wrapper });

    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    const namespaces = new Map(
      result.current.rows.map((row) => [row.id, row.iconNamespace]),
    );
    expect(namespaces.get("bundle:computer-use")).toBe("computer-use");
    // The full prefixed id can never collide with a registered brand
    // namespace, so a user-typed "linear" server never paints Linear's logo.
    expect(namespaces.get("mcp:linear")).toBe("mcp:linear");
  });

  it("maps the Claude in Chrome bundle to its own glyph namespace", async () => {
    clientMocks.listNativeIntegrations.mockResolvedValue({
      agentKind: "claude",
      integrations: [
        {
          id: "bundle:claude-chrome",
          agentKind: "claude",
          kind: "bundle",
          displayName: "Claude in Chrome",
          description: "Drive Chrome through the Claude in Chrome extension.",
          available: false,
          unavailableReason: "sign in natively",
          risk: "browser_control",
          enabled: false,
        },
      ],
      staleSelections: [],
    });
    const { result } = renderHook(() => useNativeIntegrations("claude", true), { wrapper });

    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.rows[0]).toMatchObject({
      id: "bundle:claude-chrome",
      iconNamespace: "claude-in-chrome",
      isBundle: true,
      available: false,
      unavailableReason: "sign in natively",
    });
  });

  it("renders a stale selection as an enabled Missing row named after its server", async () => {
    clientMocks.listNativeIntegrations.mockResolvedValue(response);
    const { result } = renderHook(() => useNativeIntegrations("codex", true), { wrapper });

    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    const stale = result.current.rows[2];
    expect(stale).toMatchObject({
      id: "mcp:removed-server",
      displayName: "removed-server",
      enabled: true,
      stale: true,
      available: false,
    });
  });

  it("marks a raw config row's origin as mono-rendered source, not description", async () => {
    clientMocks.listNativeIntegrations.mockResolvedValue(response);
    const { result } = renderHook(() => useNativeIntegrations("codex", true), { wrapper });

    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    const raw = result.current.rows[1];
    expect(raw.secondary).toBe("~/.codex/config.toml · mcp_servers.linear");
    expect(raw.secondaryIsSource).toBe(true);
    const bundle = result.current.rows[0];
    expect(bundle.secondary).toBe("Drive the desktop through the Codex app.");
    expect(bundle.secondaryIsSource).toBe(false);
  });

  it("never issues the read when the caller disables it (the cloud surface)", () => {
    const { result } = renderHook(() => useNativeIntegrations("codex", false), { wrapper });
    expect(clientMocks.listNativeIntegrations).not.toHaveBeenCalled();
    expect(result.current.rows).toEqual([]);
    // A disabled query must not read as "still loading" forever.
    expect(result.current.isLoading).toBe(false);
  });
});
