// @vitest-environment jsdom

import {
  getProliferateClient,
  resetProliferateClient,
  type AgentApiKey,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";
import {
  CloudClientProvider,
  useAgentApiKeys,
  useCreateAgentApiKey,
  usePutAuthSelections,
  useRefreshAgentCatalog,
  useRevokeAgentApiKey,
  useUpsertCatalogOverride,
} from "@proliferate/cloud-sdk-react";
import { agentApiKeysKey } from "@proliferate/cloud-sdk-react/lib/query-keys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentsPlaygroundCloudTransport } from "#product/pages/agents-playground/agents-playground-cloud-client";

const EXISTING_KEY: AgentApiKey = {
  id: "key-1",
  title: "Existing playground key",
  redactedHint: "sk-...old",
  status: "active",
  createdAt: "2026-07-01T00:00:00Z",
};

const REAL_SIGNED_IN_KEY: AgentApiKey = {
  id: "real-key",
  title: "Real signed-in key",
  redactedHint: "sk-...real",
  status: "active",
  createdAt: "2026-07-01T00:00:00Z",
};

afterEach(() => {
  cleanup();
  resetProliferateClient();
});

describe("Agents playground Cloud transport", () => {
  it("keeps the host global client stable while a fixture read refetches through the fake", async () => {
    const transport = createAgentsPlaygroundCloudTransport({
      harnessKind: "claude",
      apiKeys: [EXISTING_KEY],
      selections: [],
    });
    const outerQueryClient = new QueryClient();
    const playgroundQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    outerQueryClient.setQueryData(agentApiKeysKey(), [REAL_SIGNED_IN_KEY]);
    const realRequestJson = vi.fn(() => Promise.reject(
      new Error("The real signed-in transport must not be called."),
    ));
    const realClient = {
      requestJson: realRequestJson,
    } as unknown as ProliferateCloudClient;

    const { rerender } = render(
      <ProviderLifecycleProbe
        outerQueryClient={outerQueryClient}
        playgroundQueryClient={playgroundQueryClient}
        realClient={realClient}
        fixtureClient={transport.client}
        showFixture={false}
      />,
    );
    await waitFor(() => {
      expect(getProliferateClient()).toBe(realClient);
    });

    rerender(
      <ProviderLifecycleProbe
        outerQueryClient={outerQueryClient}
        playgroundQueryClient={playgroundQueryClient}
        realClient={realClient}
        fixtureClient={transport.client}
        showFixture
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Existing playground key")).toBeTruthy();
    });
    expect(getProliferateClient()).toBe(realClient);

    fireEvent.click(screen.getByRole("button", { name: "Add fixture key" }));

    await waitFor(() => {
      expect(screen.getByText("New playground key")).toBeTruthy();
    });
    expect(transport.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /v1/cloud/agent-gateway/keys",
      "POST /v1/cloud/agent-gateway/keys",
      "GET /v1/cloud/agent-gateway/keys",
    ]);
    expect(realRequestJson).not.toHaveBeenCalled();
    expect(outerQueryClient.getQueryData(agentApiKeysKey())).toEqual([REAL_SIGNED_IN_KEY]);
    expect(getProliferateClient()).toBe(realClient);

    rerender(
      <ProviderLifecycleProbe
        outerQueryClient={outerQueryClient}
        playgroundQueryClient={playgroundQueryClient}
        realClient={realClient}
        fixtureClient={transport.client}
        showFixture={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "Add fixture key" })).toBeNull();
    expect(getProliferateClient()).toBe(realClient);
  });

  it("keeps representative writes and invalidations inside the fake subtree", async () => {
    const transport = createAgentsPlaygroundCloudTransport({
      harnessKind: "claude",
      apiKeys: [EXISTING_KEY],
      selections: [],
    });
    const outerQueryClient = new QueryClient();
    const playgroundQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    outerQueryClient.setQueryData(agentApiKeysKey(), [REAL_SIGNED_IN_KEY]);
    const realRequestJson = vi.fn(() => Promise.reject(
      new Error("The real signed-in transport must not be called."),
    ));
    const realClient = {
      requestJson: realRequestJson,
    } as unknown as ProliferateCloudClient;

    render(
      <QueryClientProvider client={outerQueryClient}>
        <CloudClientProvider client={realClient}>
          <QueryClientProvider client={playgroundQueryClient}>
            <CloudClientProvider client={transport.client} syncGlobalClient={false}>
              <MutationProbe />
            </CloudClientProvider>
          </QueryClientProvider>
        </CloudClientProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run fake Cloud mutations" }));

    await waitFor(() => {
      expect(transport.requests).toHaveLength(5);
    });

    expect(transport.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /v1/cloud/agent-gateway/keys",
      "DELETE /v1/cloud/agent-gateway/keys/key-1",
      "PUT /v1/cloud/agent-gateway/selections/claude",
      "POST /v1/cloud/agent-gateway/catalog/claude/refresh",
      "PUT /v1/cloud/agent-gateway/catalog/claude/override",
    ]);
    expect(realRequestJson).not.toHaveBeenCalled();
    expect(outerQueryClient.getQueryData(agentApiKeysKey())).toEqual([REAL_SIGNED_IN_KEY]);

    const snapshot = transport.snapshot();
    expect(snapshot.apiKeys.map((key) => key.title)).toEqual(["New playground key"]);
    expect(snapshot.selections).toEqual([
      expect.objectContaining({
        harnessKind: "claude",
        surface: "local",
        sourceKind: "gateway",
        enabled: true,
      }),
    ]);
    expect(snapshot.catalogs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        harnessKind: "claude",
        surface: "local",
        route: "gateway",
        source: "probe",
        overrideApplied: true,
      }),
    ]));
    expect(snapshot.overrides).toEqual([
      expect.objectContaining({
        harnessKind: "claude",
        patchJson: "{\"update\":{}}",
      }),
    ]);
  });

  it("rejects malformed nested and undeclared routes without changing fixture state", async () => {
    const transport = createAgentsPlaygroundCloudTransport({
      harnessKind: "claude",
      apiKeys: [EXISTING_KEY],
      selections: [],
    });
    const initialState = transport.snapshot();

    await expect(transport.client.requestJson({
      method: "DELETE",
      path: "/v1/cloud/agent-gateway/keys/not-a-real-route/key-1",
    })).rejects.toThrow("Unhandled Agents playground Cloud request");
    await expect(transport.client.requestJson({
      method: "PUT",
      path: "/v1/cloud/agent-gateway/selections/not-a-real-route/claude",
      query: { surface: "local" },
      body: { sources: [{ sourceKind: "gateway", enabled: true }] },
    })).rejects.toThrow("Unhandled Agents playground Cloud request");
    await expect(transport.client.requestJson({
      method: "GET",
      path: "/v1/cloud/agent-gateway/not-declared",
    })).rejects.toThrow("Unhandled Agents playground Cloud request");

    const directClient = transport.client as unknown as Record<
      "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "requestForm" | "streamRequest",
      () => Promise<unknown>
    >;
    for (const method of [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "requestForm",
      "streamRequest",
    ] as const) {
      await expect(directClient[method]()).rejects.toThrow(
        "Agents playground Cloud transport forbids network access.",
      );
    }
    expect(transport.snapshot()).toEqual(initialState);
  });
});

interface ProviderLifecycleProbeProps {
  outerQueryClient: QueryClient;
  playgroundQueryClient: QueryClient;
  realClient: ProliferateCloudClient;
  fixtureClient: ProliferateCloudClient;
  showFixture: boolean;
}

function ProviderLifecycleProbe({
  outerQueryClient,
  playgroundQueryClient,
  realClient,
  fixtureClient,
  showFixture,
}: ProviderLifecycleProbeProps) {
  return (
    <QueryClientProvider client={outerQueryClient}>
      <CloudClientProvider client={realClient}>
        {showFixture ? (
          <QueryClientProvider client={playgroundQueryClient}>
            <CloudClientProvider client={fixtureClient} syncGlobalClient={false}>
              <FixtureReadMutationProbe />
            </CloudClientProvider>
          </QueryClientProvider>
        ) : (
          <span>Host provider only</span>
        )}
      </CloudClientProvider>
    </QueryClientProvider>
  );
}

function FixtureReadMutationProbe() {
  const keysQuery = useAgentApiKeys();
  const createKey = useCreateAgentApiKey();

  return (
    <>
      {keysQuery.data?.map((key) => <span key={key.id}>{key.title}</span>)}
      <button
        type="button"
        disabled={!keysQuery.isSuccess}
        onClick={() => createKey.mutate({
          title: "New playground key",
          value: "sk-new-secret",
        })}
      >
        Add fixture key
      </button>
    </>
  );
}

function MutationProbe() {
  const createKey = useCreateAgentApiKey();
  const revokeKey = useRevokeAgentApiKey();
  const putSelections = usePutAuthSelections();
  const refreshCatalog = useRefreshAgentCatalog();
  const upsertOverride = useUpsertCatalogOverride();

  async function runMutations() {
    await createKey.mutateAsync({ title: "New playground key", value: "sk-new-secret" });
    await revokeKey.mutateAsync("key-1");
    await putSelections.mutateAsync({
      harnessKind: "claude",
      surface: "local",
      body: {
        sources: [{ sourceKind: "gateway", enabled: true }],
      },
    });
    await refreshCatalog.mutateAsync({
      harnessKind: "claude",
      body: { surface: "local", route: "gateway" },
    });
    await upsertOverride.mutateAsync({
      harnessKind: "claude",
      body: { patchJson: "{\"update\":{}}" },
    });
  }

  return (
    <button type="button" onClick={() => void runMutations()}>
      Run fake Cloud mutations
    </button>
  );
}
