// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

const LOCAL_EXECUTOR_POLL_MS = 10_000;

const mocks = vi.hoisted(() => ({
  claimRuns: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("#product/hooks/access/cloud/automations/use-local-automation-run-claims", () => ({
  useLocalAutomationRunClaims: () => ({
    claimRuns: mocks.claimRuns,
    heartbeatRun: vi.fn(),
    markCreatingWorkspace: vi.fn(),
    attachWorkspace: vi.fn(),
    markProvisioningWorkspace: vi.fn(),
    markCreatingSession: vi.fn(),
    attachSession: vi.fn(),
    markDispatching: vi.fn(),
    markDispatched: vi.fn(),
    markFailed: vi.fn(),
  }),
}));

vi.mock("#product/hooks/access/anyharness/automations/use-local-automation-runtime-client", () => ({
  useLocalAutomationRuntimeClientFactory: () => vi.fn(),
}));

vi.mock("#product/hooks/automations/cache/use-local-automation-executor-cache", () => ({
  useLocalAutomationExecutorCache: () => ({
    invalidateAfterLocalAutomationRun: vi.fn(async () => undefined),
  }),
}));

// Only the candidate builder is overridden — the poller only needs a
// non-empty candidate list to enter its polling loop. Every scenario below
// keeps `claimRuns` returning zero runs (or rejecting), so
// `findCandidateForClaim` / `buildLocalAutomationWorktreePlan` are never
// reached and can stay real.
vi.mock("#product/lib/domain/automations/local-executor/plan", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("#product/lib/domain/automations/local-executor/plan")
  >()),
  buildLocalAutomationRepoCandidates: () => [
    { identity: "repo-1", repoRoot: { path: "/repo" } },
  ],
}));

vi.mock("#product/hooks/persistence/facade/use-product-storage-context", () => ({
  useProductStorageContext: () => ({
    storage: {
      getItem: async () => null,
      setItem: async () => undefined,
      removeItem: async () => undefined,
    },
    captureException: () => undefined,
  }),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({
    data: { repoRoots: ["/repo"], localWorkspaces: [] },
  }),
}));

// `localExecutorMounted` / `executorIdPromise` are module-scoped singleton
// guards (the poller is meant to run once for the whole app), so each test
// loads the hook from a fresh module registry to isolate that state.
async function loadClaimPollerHarness() {
  vi.resetModules();
  mocks.emit.mockReset();
  setRendererDiagnosticsSink({ emit: mocks.emit });
  const { useLocalAutomationClaimPoller } = await import(
    "#product/hooks/automations/lifecycle/use-local-automation-claim-poller"
  );
  return renderHook(() =>
    useLocalAutomationClaimPoller({ enabled: true, runtimeUrl: "http://runtime.local:1" }),
  );
}

async function advancePoll(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useLocalAutomationClaimPoller failure streak", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    cleanup();
    await vi.runOnlyPendingTimersAsync().catch(() => undefined);
    vi.useRealTimers();
    resetRendererDiagnosticsSinkForTest();
  });

  it("emits on the first failure (a streak edge) and stays silent through repeats", async () => {
    mocks.claimRuns.mockReset();
    mocks.claimRuns.mockRejectedValue(new Error("runtime unreachable"));
    await loadClaimPollerHarness();

    await advancePoll(0); // first tick, mounts immediately
    expect(mocks.emit).toHaveBeenCalledTimes(1);
    expect(mocks.emit.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      name: "renderer.automation.claim_poll_failed",
      fields: expect.objectContaining({
        error_name: expect.objectContaining({ value: "Error" }),
        consecutive_failures: expect.objectContaining({ value: 1 }),
      }),
    }));

    await advancePoll(LOCAL_EXECUTOR_POLL_MS); // second consecutive failure
    expect(mocks.emit).toHaveBeenCalledTimes(1);

    await advancePoll(LOCAL_EXECUTOR_POLL_MS); // third consecutive failure
    expect(mocks.emit).toHaveBeenCalledTimes(1);
  });

  it("emits claim_poll_recovered with the streak length, then opens a fresh streak on the next failure", async () => {
    mocks.claimRuns.mockReset();
    mocks.claimRuns.mockRejectedValue(new Error("runtime unreachable"));
    await loadClaimPollerHarness();

    await advancePoll(0); // failure 1 (edge, emits)
    await advancePoll(LOCAL_EXECUTOR_POLL_MS); // failure 2
    await advancePoll(LOCAL_EXECUTOR_POLL_MS); // failure 3
    expect(mocks.emit).toHaveBeenCalledTimes(1);

    mocks.claimRuns.mockResolvedValue({ runs: [] });
    await advancePoll(LOCAL_EXECUTOR_POLL_MS); // recovers
    expect(mocks.emit).toHaveBeenCalledTimes(2);
    expect(mocks.emit.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      name: "renderer.automation.claim_poll_recovered",
      fields: expect.objectContaining({
        consecutive_failures: expect.objectContaining({ value: 3 }),
      }),
    }));

    // A stable, already-recovered success tick must not re-emit.
    await advancePoll(LOCAL_EXECUTOR_POLL_MS);
    expect(mocks.emit).toHaveBeenCalledTimes(2);

    // The next failure opens a brand-new streak: it is an edge again.
    mocks.claimRuns.mockRejectedValue(new Error("runtime unreachable"));
    await advancePoll(LOCAL_EXECUTOR_POLL_MS);
    expect(mocks.emit).toHaveBeenCalledTimes(3);
    expect(mocks.emit.mock.calls[2]?.[0]).toEqual(expect.objectContaining({
      name: "renderer.automation.claim_poll_failed",
      fields: expect.objectContaining({
        consecutive_failures: expect.objectContaining({ value: 1 }),
      }),
    }));
  });
});
