// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { buildWorkspaceCollections } from "#product/lib/domain/workspaces/cloud/collections";
import { workspaceCollectionsKey } from "#product/hooks/workspaces/cache/query-keys";
import { useWorkspaceSelectionCache } from "./use-workspace-selection-cache";

const RUNTIME_URL = "http://127.0.0.1:8706";

// Authenticated session whose cloud plane is inactive — the dev-bypass shape
// (VITE_DEV_DISABLE_AUTH): auth reports a user id, but the collections query
// scopes its cache key by `cloudActive ? authUserId : null`.
vi.mock("#product/hooks/auth/facade/use-product-auth", () => ({
  useProductAuthStatus: () => "authenticated",
  useProductAuthUserId: () => "local-dev-user",
}));
vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: false }),
}));
vi.mock("@anyharness/sdk-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAnyHarnessCacheScopeKey: () => "scope",
}));

describe("useWorkspaceSelectionCache", () => {
  it("reads collections under the same user scope the collections query writes (authenticated but cloud-inactive)", () => {
    const queryClient = new QueryClient();
    const collections = buildWorkspaceCollections([], [], []);
    // The collections query (use-workspaces.ts) writes with
    // `cloudActive ? authUserId : null` — null scope when cloud is inactive.
    queryClient.setQueryData(
      workspaceCollectionsKey(RUNTIME_URL, false, null),
      collections,
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useWorkspaceSelectionCache(), { wrapper });

    // Regression: reading under the bare authenticated user id missed the
    // null-scoped entry, so every workspace selection failed "Workspace not
    // found." under the dev auth bypass.
    const snapshot = result.current.getWorkspaceSelectionSnapshot(RUNTIME_URL);
    expect(snapshot.workspaceCollections).toBe(collections);
  });
});
