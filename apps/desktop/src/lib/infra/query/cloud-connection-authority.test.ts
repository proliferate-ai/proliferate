import { QueryClient } from "@tanstack/react-query";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import { describe, expect, it } from "vitest";
import { cloudWorkspaceConnectionAuthorityKey } from "@/hooks/access/cloud/query-keys";
import { buildCloudConnectionAuthorityScopeKey } from "./cloud-connection-authority";

describe("cloud connection authority scope", () => {
  it("does not share connection data across client replacement or client loss", () => {
    const clientA = {} as ProliferateCloudClient;
    const clientB = {} as ProliferateCloudClient;
    const baseScopeKey = "https://api.example.test::user:user-1";
    const scopeA = buildCloudConnectionAuthorityScopeKey(baseScopeKey, clientA);
    const scopeB = buildCloudConnectionAuthorityScopeKey(baseScopeKey, clientB);
    const unavailableScope = buildCloudConnectionAuthorityScopeKey(baseScopeKey, null);
    const queryClient = new QueryClient();

    queryClient.setQueryData(
      cloudWorkspaceConnectionAuthorityKey("workspace-1", scopeA),
      { runtimeUrl: "https://runtime-a.example.test" },
    );

    expect(scopeB).not.toBe(scopeA);
    expect(unavailableScope).not.toBe(scopeA);
    expect(queryClient.getQueryData(
      cloudWorkspaceConnectionAuthorityKey("workspace-1", scopeB),
    )).toBeUndefined();
    expect(queryClient.getQueryData(
      cloudWorkspaceConnectionAuthorityKey("workspace-1", unavailableScope),
    )).toBeUndefined();
  });
});
