// @vitest-environment jsdom

import type { AgentApiKey, ProliferateCloudClient } from "@proliferate/cloud-sdk";
import {
  CloudClientProvider,
  useCreateAgentApiKey,
  usePutAuthSelections,
  useRefreshAgentCatalog,
  useRevokeAgentApiKey,
  useUpsertCatalogOverride,
} from "@proliferate/cloud-sdk-react";
import { agentApiKeysKey } from "@proliferate/cloud-sdk-react/lib/query-keys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

describe("Agents playground Cloud transport", () => {
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
            <CloudClientProvider client={transport.client}>
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
});

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
