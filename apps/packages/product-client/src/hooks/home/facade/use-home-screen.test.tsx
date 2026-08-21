// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
  ErrorContext,
  ProductStorage,
} from "@proliferate/product-client/host/product-host";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHomeScreen } from "#product/hooks/home/facade/use-home-screen";
import type { ProductStorageContext } from "#product/lib/infra/persistence/product-storage";

const HOME_MODEL_PROBE_DISMISSED_STORAGE_KEY =
  "proliferate.home.modelProbeCardDismissed";

const mocks = vi.hoisted(() => ({
  storageContext: null as ProductStorageContext | null,
  readyAgents: [{ kind: "claude" }, { kind: "codex" }],
  agentsLoading: false,
  isReconciling: true,
  readIsStaleCallbacks: [] as Array<() => boolean>,
  navigate: vi.fn(),
  openAddRepoFlow: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useRepositories: () => ({
    data: { repositories: [] },
    isPending: false,
  }),
}));

vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({
    readyAgents: mocks.readyAgents,
    isLoading: mocks.agentsLoading,
    isReconciling: mocks.isReconciling,
  }),
}));

vi.mock("#product/hooks/agents/lifecycle/use-auth-setup-onboarding-step", () => ({
  useAuthSetupOnboardingStep: () => "hidden",
}));

vi.mock("#product/hooks/agents/lifecycle/use-auth-setup-onboarding-evidence", () => ({
  useAuthSetupOnboardingEvidence: () => null,
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: false }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-add-repo", () => ({
  useAddRepo: () => ({ isAddingRepo: false }),
}));

vi.mock("#product/stores/ui/add-repo-flow-store", () => ({
  useAddRepoFlowStore: (selector: (state: { openFlow: () => void }) => unknown) =>
    selector({ openFlow: mocks.openAddRepoFlow }),
}));

vi.mock("#product/hooks/workspaces/derived/use-standard-repo-projection", () => ({
  useStandardRepoProjection: () => ({
    localWorkspaces: [],
    repoRoots: [],
    isLoading: false,
  }),
}));

vi.mock("#product/stores/preferences/user-preferences-store", () => ({
  useUserPreferencesStore: (
    selector: (state: { defaultChatAgentKind: string }) => unknown,
  ) => selector({ defaultChatAgentKind: "claude" }),
}));

vi.mock("#product/stores/preferences/workspace-ui-store", () => ({
  useWorkspaceUiStore: (
    selector: (state: { hiddenRepoRootIds: string[] }) => unknown,
  ) => selector({ hiddenRepoRootIds: [] }),
}));

vi.mock("#product/hooks/persistence/facade/use-product-storage-context", () => ({
  useProductStorageContext: () => {
    if (!mocks.storageContext) {
      throw new Error("Test storage context was not installed");
    }
    return mocks.storageContext;
  },
}));

vi.mock(
  "#product/lib/infra/persistence/product-storage",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("#product/lib/infra/persistence/product-storage")
    >();
    return {
      ...actual,
      readPersistedString: vi.fn(
        (...args: Parameters<typeof actual.readPersistedString>) => {
          const options = args[2];
          if (options?.isStale) {
            mocks.readIsStaleCallbacks.push(options.isStale);
          }
          return actual.readPersistedString(...args);
        },
      ),
    };
  },
);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function installStorage(args: {
  getItem: ProductStorage["getItem"];
  setItem?: ProductStorage["setItem"];
}) {
  const captureException = vi.fn<
    (error: unknown, context?: ErrorContext) => void
  >();
  const storage: ProductStorage = {
    getItem: vi.fn(args.getItem),
    setItem: vi.fn(args.setItem ?? (async () => {})),
    removeItem: vi.fn(async () => {}),
  };
  mocks.storageContext = { storage, captureException };
  return { storage, captureException };
}

async function resolveDeferredRead(
  deferred: Deferred<string | null>,
  value: string | null,
) {
  await act(async () => {
    deferred.resolve(value);
    await deferred.promise;
  });
}

describe("useHomeScreen agent-settings routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readyAgents = [{ kind: "claude" }, { kind: "codex" }];
    mocks.agentsLoading = false;
    mocks.isReconciling = false;
    mocks.storageContext = null;
  });
  afterEach(() => cleanup());

  it("opens the pane of the harness it was handed, not always Claude", () => {
    // The terminal "no agents are supported" notice justifies itself by
    // showing WHICH agents are unsupported. Sending every caller to the
    // Claude pane makes that false whenever Claude is not the one: that pane
    // only reports it has not been observed.
    installStorage({ getItem: async () => null });
    const { result } = renderHook(() => useHomeScreen());
    act(() => result.current.handleHomeAction("agent-settings", { harnessKind: "cursor" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/settings?section=agent-cursor");

    // No harness named, and an unmappable one, both keep the old default.
    act(() => result.current.handleHomeAction("agent-settings"));
    act(() => result.current.handleHomeAction("agent-settings", { harnessKind: "nope" }));
    expect(mocks.navigate).toHaveBeenLastCalledWith("/settings?section=agent-claude");
  });
});

describe("useHomeScreen model-probe dismissal hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readyAgents = [{ kind: "claude" }, { kind: "codex" }];
    mocks.agentsLoading = false;
    mocks.isReconciling = true;
    mocks.readIsStaleCallbacks.length = 0;
    mocks.storageContext = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("withholds the probe inputs until a deferred sentinel read settles", async () => {
    const read = createDeferred<string | null>();
    mocks.agentsLoading = true;
    const { storage } = installStorage({ getItem: () => read.promise });
    const { result } = renderHook(() => useHomeScreen());

    expect(result.current.modelProbeInputs).toBeUndefined();
    expect(storage.getItem).toHaveBeenCalledWith(
      HOME_MODEL_PROBE_DISMISSED_STORAGE_KEY,
    );

    await resolveDeferredRead(read, "1");

    expect(result.current.modelProbeInputs).toEqual({
      dismissed: true,
      agentsLoading: true,
      isReconciling: true,
      harnessKinds: ["claude", "codex"],
    });
  });

  it.each([
    { label: "a missing value", raw: null },
    { label: "an empty value", raw: "" },
    { label: "an unrecognized value", raw: "0" },
  ])("settles $label to visible", async ({ raw }) => {
    installStorage({ getItem: async () => raw });
    const { result } = renderHook(() => useHomeScreen());

    await waitFor(() => {
      expect(result.current.modelProbeInputs?.dismissed).toBe(false);
    });
  });

  it("settles a captured read rejection to visible", async () => {
    const readError = new Error("storage read failed");
    const { captureException } = installStorage({
      getItem: async () => Promise.reject(readError),
    });
    const { result } = renderHook(() => useHomeScreen());

    await waitFor(() => {
      expect(result.current.modelProbeInputs?.dismissed).toBe(false);
    });
    expect(captureException).toHaveBeenCalledWith(
      readError,
      expect.objectContaining({
        tags: {
          domain: "product_storage",
          action: "read",
          key: HOME_MODEL_PROBE_DISMISSED_STORAGE_KEY,
        },
      }),
    );
  });

  it.each([
    { label: "a late missing value", lateValue: null },
    { label: "a late sentinel", lateValue: "1" },
  ])("keeps a current dismissal after $label", async ({ lateValue }) => {
    const read = createDeferred<string | null>();
    const { storage } = installStorage({ getItem: () => read.promise });
    const { result } = renderHook(() => useHomeScreen());

    act(() => {
      result.current.dismissModelProbeCard();
    });

    expect(result.current.modelProbeInputs?.dismissed).toBe(true);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith(
      HOME_MODEL_PROBE_DISMISSED_STORAGE_KEY,
      "1",
    );

    await resolveDeferredRead(read, lateValue);

    expect(result.current.modelProbeInputs?.dismissed).toBe(true);
  });

  it("marks an unmounted read stale so its late value is ignored", async () => {
    const read = createDeferred<string | null>();
    const { captureException } = installStorage({ getItem: () => read.promise });
    const { result, unmount } = renderHook(() => useHomeScreen());

    expect(result.current.modelProbeInputs).toBeUndefined();
    expect(mocks.readIsStaleCallbacks).toHaveLength(1);
    expect(mocks.readIsStaleCallbacks[0]?.()).toBe(false);

    unmount();
    expect(mocks.readIsStaleCallbacks[0]?.()).toBe(true);

    await resolveDeferredRead(read, "1");

    expect(captureException).not.toHaveBeenCalled();
  });

  it("keeps the dismissed UI state when the best-effort write rejects", async () => {
    const writeError = new Error("storage write failed");
    const { captureException } = installStorage({
      getItem: async () => null,
      setItem: async () => Promise.reject(writeError),
    });
    const { result } = renderHook(() => useHomeScreen());

    await waitFor(() => {
      expect(result.current.modelProbeInputs?.dismissed).toBe(false);
    });

    act(() => {
      result.current.dismissModelProbeCard();
    });

    expect(result.current.modelProbeInputs?.dismissed).toBe(true);
    await waitFor(() => {
      expect(captureException).toHaveBeenCalledWith(
        writeError,
        expect.objectContaining({
          tags: {
            domain: "product_storage",
            action: "write",
            key: HOME_MODEL_PROBE_DISMISSED_STORAGE_KEY,
          },
        }),
      );
    });
    expect(result.current.modelProbeInputs?.dismissed).toBe(true);
  });
});
