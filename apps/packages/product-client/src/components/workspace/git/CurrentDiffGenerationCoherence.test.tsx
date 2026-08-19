// @vitest-environment jsdom

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnyHarnessRuntime,
  AnyHarnessWorkspace,
  anyHarnessGitDiffKey,
  useAdvanceGitCacheForceEpoch,
  useGitCacheForceEpoch,
} from "@anyharness/sdk-react";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { TurnDiffFileCard } from "#product/components/workspace/chat/transcript/TurnDiffFileCard";
import { GitReviewFileRow } from "#product/components/workspace/git/GitReviewFileRow";
import type { GitPanelReviewFile } from "#product/lib/domain/workspaces/changes/git-panel-diff";
import {
  buildChangesCacheGeneration,
  buildChangesMetadataFingerprint,
} from "#product/lib/domain/workspaces/changes/changes-cache-generation";
import { refreshGitPanelMetadata } from "#product/lib/workflows/workspaces/changes/refresh-git-panel-metadata";
import { useSessionStreamCache } from "#product/hooks/sessions/cache/use-session-stream-cache";
import { observeChangesMetadata } from "#product/hooks/workspaces/cache/changes-cache-observation";

const CACHE_SCOPE_KEY = "generation:test";
const RUNTIME_URL = "http://runtime-generation.test";
const webTestHost = { desktop: null } as ProductHost;
const mocks = vi.hoisted(() => ({ getDiff: vi.fn() }));

vi.mock("../../../../../../../anyharness/sdk-react/src/lib/client-cache.js", () => ({
  getAnyHarnessClient: () => ({ git: { getDiff: mocks.getDiff } }),
}));

vi.mock("#product/hooks/auth/facade/use-product-auth", () => ({
  useProductAuthUserId: () => "test-user",
}));

afterEach(() => {
  cleanup();
  mocks.getDiff.mockReset();
});

describe("current diff generation coherence", () => {
  it("replaces sidebar evidence without presenting prior data or errors", async () => {
    const background = deferred<ReturnType<typeof diffResponse>>();
    const second = deferred<ReturnType<typeof diffResponse>>();
    mocks.getDiff
      .mockResolvedValueOnce(diffResponse("generation one", {
        additions: 99,
        deletions: 88,
        binary: true,
        truncated: true,
      }))
      .mockReturnValueOnce(background.promise)
      .mockReturnValueOnce(second.promise);
    const queryClient = createQueryClient();
    const firstFile = reviewFile("src/sidebar.ts", 3, 2);
    const view = renderWithProviders(
      sidebarRow(firstFile, "generation-1"),
      queryClient,
    );
    await waitFor(() => expect(view.container.textContent).toContain("generation one"));
    expect(view.container.textContent).toContain("99");
    expect(view.container.textContent).toContain("88");
    expect(view.container.textContent).toContain("Diff truncated because it is too large");

    const firstKey = anyHarnessGitDiffKey(
      CACHE_SCOPE_KEY,
      "workspace-1",
      firstFile.path,
      "unstaged",
      null,
      null,
      "generation-1",
    );
    const firstQuery = queryClient.getQueryCache().find({ queryKey: firstKey, exact: true });
    act(() => {
      void queryClient.invalidateQueries({
        queryKey: firstKey,
        exact: true,
      });
    });
    await waitFor(() => expect(mocks.getDiff).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Loading diff")).toBeTruthy();
    expect(view.container.textContent).not.toContain("generation one");
    act(() => background.resolve(diffResponse("generation one", {
      additions: 99,
      deletions: 88,
      binary: true,
      truncated: true,
    })));
    await waitFor(() => expect(view.container.textContent).toContain("generation one"));

    act(() => {
      firstQuery?.setState({
        data: {
          ...diffResponse("generation one", { additions: 99, deletions: 88, binary: true }),
          patch: null,
        },
        dataUpdatedAt: Date.now(),
        error: null,
        fetchStatus: "idle",
        isInvalidated: false,
        status: "success",
      });
    });
    await waitFor(() => expect(screen.getByText("Binary file changed")).toBeTruthy());
    act(() => {
      firstQuery?.setState({
        error: new Error("generation one error"),
        errorUpdatedAt: Date.now(),
        fetchStatus: "idle",
        status: "error",
      });
    });
    await waitFor(() => expect(screen.getByText("generation one error")).toBeTruthy());

    const secondFile = reviewFile("src/sidebar.ts", 7, 6);
    view.rerender(providers(
      sidebarRow(secondFile, "generation-2"),
      queryClient,
    ));
    await waitFor(() => expect(mocks.getDiff).toHaveBeenCalledTimes(3));
    expect(screen.getByText("Loading diff")).toBeTruthy();
    expect(view.container.textContent).not.toContain("generation one");
    expect(view.container.textContent).not.toContain("generation one error");
    expect(view.container.textContent).not.toContain("99");
    expect(view.container.textContent).not.toContain("88");
    expect(view.container.textContent).not.toContain("Binary file changed");
    expect(view.container.textContent).not.toContain("Diff truncated because it is too large");

    act(() => second.resolve(diffResponse("generation two", {
      additions: 8,
      deletions: 5,
    })));
    await waitFor(() => expect(view.container.textContent).toContain("generation two"));
    expect(mocks.getDiff).toHaveBeenCalledTimes(3);
    expect(view.container.textContent?.match(/generation two/g)).toHaveLength(1);
  });

  it("keeps deferred and policy-blocked sidebar generations free of prior data", async () => {
    mocks.getDiff.mockResolvedValueOnce(diffResponse("old sidebar"));
    const queryClient = createQueryClient();
    const firstFile = reviewFile("src/deferred.ts", 1, 1);
    const view = renderWithProviders(sidebarRow(firstFile, "generation-1"), queryClient);
    await waitFor(() => expect(view.container.textContent).toContain("old sidebar"));

    const nextFile = reviewFile("src/deferred.ts", 4, 3);
    view.rerender(providers(
      sidebarRow(nextFile, "generation-2", { fetchDiff: false }),
      queryClient,
    ));
    expect(screen.getByText("Waiting to load diff")).toBeTruthy();
    expect(view.container.textContent).not.toContain("old sidebar");
    expect(mocks.getDiff).toHaveBeenCalledTimes(1);

    view.rerender(providers(
      sidebarRow(nextFile, "generation-3", { collapsed: true }),
      queryClient,
    ));
    expect(view.container.textContent).not.toContain("old sidebar");
    expect(mocks.getDiff).toHaveBeenCalledTimes(1);

    const blockedFile = reviewFile("src/deferred.ts", 5_001, 0);
    view.rerender(providers(
      sidebarRow(blockedFile, "generation-4"),
      queryClient,
    ));
    expect(screen.getByText("Too large to render inline")).toBeTruthy();
    expect(view.container.textContent).not.toContain("old sidebar");
    expect(mocks.getDiff).toHaveBeenCalledTimes(1);
  });

  it("keeps a transcript-collapsed generation empty, then fetches once on expansion", async () => {
    const second = deferred<ReturnType<typeof diffResponse>>();
    mocks.getDiff
      .mockResolvedValueOnce(diffResponse("old transcript"))
      .mockReturnValueOnce(second.promise);
    const queryClient = createQueryClient();
    const firstFile = reviewFile("src/transcript.ts", 2, 1);
    const view = renderWithProviders(
      turnCard(firstFile, "generation-1", true),
      queryClient,
    );
    await waitFor(() => expect(view.container.textContent).toContain("old transcript"));

    const secondFile = reviewFile("src/transcript.ts", 5, 3);
    view.rerender(providers(
      turnCard(secondFile, "generation-2", false),
      queryClient,
    ));
    expect(view.container.textContent).not.toContain("old transcript");
    expect(mocks.getDiff).toHaveBeenCalledTimes(1);

    view.rerender(providers(
      turnCard(secondFile, "generation-2", true),
      queryClient,
    ));
    await waitFor(() => expect(mocks.getDiff).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Loading diff")).toBeTruthy();
    expect(view.container.textContent).not.toContain("old transcript");

    act(() => second.resolve(diffResponse("new transcript", {
      additions: 6,
      deletions: 4,
    })));
    await waitFor(() => expect(view.container.textContent).toContain("new transcript"));
    expect(mocks.getDiff).toHaveBeenCalledTimes(2);
  });

  it.each(["manual", "stream"] as const)(
    "moves identical-numstat evidence across the %s force boundary",
    async (boundary) => {
      const second = deferred<ReturnType<typeof diffResponse>>();
      mocks.getDiff
        .mockResolvedValueOnce(diffResponse("generation one"))
        .mockReturnValueOnce(second.promise);
      const queryClient = createQueryClient();
      const view = renderWithProviders(<ForceBoundarySidebar boundary={boundary} />, queryClient);
      await waitFor(() => expect(view.container.textContent).toContain("generation one"));

      fireEvent.click(screen.getByRole("button", { name: `Advance ${boundary} boundary` }));
      await waitFor(() => expect(mocks.getDiff).toHaveBeenCalledTimes(2));
      expect(screen.getByText("Loading diff")).toBeTruthy();
      expect(view.container.textContent).not.toContain("generation one");

      act(() => second.resolve(diffResponse("generation two")));
      await waitFor(() => expect(view.container.textContent).toContain("generation two"));
      expect(mocks.getDiff).toHaveBeenCalledTimes(2);
    },
  );

  it("treats M1 to M2 to M1 as three observations without rotating unchanged polls", async () => {
    const second = deferred<ReturnType<typeof diffResponse>>();
    const third = deferred<ReturnType<typeof diffResponse>>();
    mocks.getDiff
      .mockResolvedValueOnce(diffResponse("first M1"))
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const queryClient = createQueryClient();
    const m1 = reviewFile("src/aba.ts", 2, 1);
    const m2: GitPanelReviewFile = {
      ...m1,
      currentDiff: { ...m1.currentDiff!, status: "added" },
    };
    const view = renderWithProviders(
      <ObservedMetadataSidebar file={m1} />,
      queryClient,
    );
    await waitFor(() => expect(view.container.textContent).toContain("first M1"));

    view.rerender(providers(
      <ObservedMetadataSidebar file={{ ...m1, currentDiff: { ...m1.currentDiff! } }} />,
      queryClient,
    ));
    expect(mocks.getDiff).toHaveBeenCalledTimes(1);

    view.rerender(providers(<ObservedMetadataSidebar file={m2} />, queryClient));
    await waitFor(() => expect(mocks.getDiff).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Loading diff")).toBeTruthy();
    expect(view.container.textContent).not.toContain("first M1");
    act(() => second.resolve(diffResponse("observed M2")));
    await waitFor(() => expect(view.container.textContent).toContain("observed M2"));

    view.rerender(providers(
      <ObservedMetadataSidebar file={{ ...m1, currentDiff: { ...m1.currentDiff! } }} />,
      queryClient,
    ));
    await waitFor(() => expect(mocks.getDiff).toHaveBeenCalledTimes(3));
    expect(screen.getByText("Loading diff")).toBeTruthy();
    expect(view.container.textContent).not.toContain("first M1");
    expect(view.container.textContent).not.toContain("observed M2");
    act(() => third.resolve(diffResponse("final M1")));
    await waitFor(() => expect(view.container.textContent).toContain("final M1"));
    expect(queryClient.getQueryCache().getAll().filter((query) => (
      query.queryKey.includes("src/aba.ts")
    ))).toHaveLength(3);

    view.unmount();
    const remount = renderWithProviders(<ObservedMetadataSidebar file={m1} />, queryClient);
    expect(remount.container.textContent).toContain("final M1");
    expect(remount.container.textContent).not.toContain("first M1");
    expect(mocks.getDiff).toHaveBeenCalledTimes(3);
  });
});

function ObservedMetadataSidebar({ file }: { file: GitPanelReviewFile }) {
  const queryClient = useQueryClient();
  const semanticFingerprint = buildChangesMetadataFingerprint({ files: [file.currentDiff!] });
  const observationToken = observeChangesMetadata({
    queryClient,
    scopeKey: "observed-metadata-sidebar:workspace-1",
    forceEpoch: 0,
    semanticFingerprint,
  });
  const cacheGeneration = buildChangesCacheGeneration({
    kind: "working_tree",
    semanticFingerprint,
    observationToken,
    forceEpoch: 0,
  });
  return sidebarRow(file, cacheGeneration);
}

function ForceBoundarySidebar({ boundary }: { boundary: "manual" | "stream" }) {
  const queryClient = useQueryClient();
  const forceEpoch = useGitCacheForceEpoch({ workspaceId: "workspace-1" });
  const advanceForceEpoch = useAdvanceGitCacheForceEpoch({ workspaceId: "workspace-1" });
  const streamCache = useSessionStreamCache();
  const file = reviewFile("src/boundary.ts", 2, 1);
  const semanticFingerprint = buildChangesMetadataFingerprint({ files: [file.currentDiff!] });
  const observationToken = observeChangesMetadata({
    queryClient,
    scopeKey: "force-boundary-sidebar:workspace-1",
    forceEpoch,
    semanticFingerprint,
  });
  const cacheGeneration = buildChangesCacheGeneration({
    kind: "working_tree",
    semanticFingerprint,
    observationToken,
    forceEpoch,
  });
  const advanceBoundary = () => {
    if (boundary === "manual") {
      void refreshGitPanelMetadata({
        refreshes: [async () => ({ isError: false })],
        advanceForceEpoch,
      });
      return;
    }
    streamCache.invalidateGitStatus({ workspaceId: "workspace-1" });
  };

  return (
    <>
      <button type="button" onClick={advanceBoundary}>
        Advance {boundary} boundary
      </button>
      {sidebarRow(file, cacheGeneration)}
    </>
  );
}

function sidebarRow(
  file: GitPanelReviewFile,
  cacheGeneration: string,
  overrides: { fetchDiff?: boolean; collapsed?: boolean } = {},
) {
  return (
    <GitReviewFileRow
      id={`review-${file.path}`}
      workspaceId="workspace-1"
      sectionScope="unstaged"
      file={file}
      baseRef={null}
      cacheGeneration={cacheGeneration}
      metadataPending={false}
      layout="unified"
      wrapLongLines={false}
      collapsed={overrides.collapsed ?? false}
      isRuntimeReady
      fetchDiff={overrides.fetchDiff ?? true}
      onToggleCollapsed={() => {}}
      onDiffFetchSettled={() => {}}
      openFile={async () => undefined}
      contentSearchOrderKey={0}
    />
  );
}

function turnCard(file: GitPanelReviewFile, cacheGeneration: string, isExpanded: boolean) {
  return (
    <TurnDiffFileCard
      file={file}
      fileCount={2}
      turnId="turn-1"
      workspaceId="workspace-1"
      baseRef="origin/main"
      cacheGeneration={cacheGeneration}
      isRuntimeReady
      runtimeBlockedReason={null}
      metadataPending={false}
      metadataErrorMessage={null}
      fallbackAdditions={file.currentDiff?.additions ?? 0}
      fallbackDeletions={file.currentDiff?.deletions ?? 0}
      isExpanded={isExpanded}
      onToggleExpand={() => {}}
      onOpenFile={() => {}}
    />
  );
}

function reviewFile(path: string, additions: number, deletions: number): GitPanelReviewFile {
  return {
    key: `:${path}:modified`,
    path,
    oldPath: null,
    displayPath: path,
    currentDiff: {
      key: `:${path}:modified`,
      path,
      oldPath: null,
      displayPath: path,
      status: "modified",
      includedState: "excluded",
      additions,
      deletions,
      binary: false,
    },
  };
}

function diffResponse(
  label: string,
  overrides: Partial<{
    additions: number;
    deletions: number;
    binary: boolean;
    truncated: boolean;
  }> = {},
) {
  return {
    path: "src/file.ts",
    scope: "working_tree" as const,
    additions: overrides.additions ?? 2,
    deletions: overrides.deletions ?? 1,
    binary: overrides.binary ?? false,
    truncated: overrides.truncated ?? false,
    patch: `@@ -1 +1 @@\n-before\n+${label}`,
  };
}

function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithProviders(ui: ReactElement, queryClient: QueryClient) {
  return render(providers(ui, queryClient));
}

function providers(ui: ReactElement, queryClient: QueryClient) {
  return (
    <QueryClientProvider client={queryClient}>
      <AnyHarnessRuntime runtimeUrl={RUNTIME_URL} cacheScopeKey={CACHE_SCOPE_KEY}>
        <AnyHarnessWorkspace
          workspaceId="workspace-1"
          resolveConnection={async () => ({
            runtimeUrl: RUNTIME_URL,
            anyharnessWorkspaceId: "workspace-1",
          })}
        >
          <ProductHostProvider host={webTestHost}>{ui}</ProductHostProvider>
        </AnyHarnessWorkspace>
      </AnyHarnessRuntime>
    </QueryClientProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
