/* @vitest-environment jsdom */

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductStorage } from "@proliferate/product-client/host/product-host";

import { SUPPORT_QUEUE_LEGACY_KEY } from "./support-report-queue-migration";
import {
  SUPPORT_QUEUE_PENDING_KEY,
  SUPPORT_QUEUE_PRIMARY_KEY,
} from "./support-report-queue-storage";
import {
  SUPPORT_QUEUE_LEGACY_KEY_INLINE,
  SUPPORT_QUEUE_PENDING_KEY_INLINE,
  SUPPORT_QUEUE_PRIMARY_KEY_INLINE,
  useSupportReportRetentionLifecycle,
} from "./use-support-report-retention";

// Pinning test: the hook inlines these three literals instead of importing
// them from the queue storage/migration modules (importing either would drag
// the whole queue document/storage/migration/canonical graph into the login
// chunk). These canonical constants are imported here, in the test file only,
// so a future rename of any key is caught instead of silently desyncing.
describe("inlined support queue storage keys", () => {
  it("stay equal to the canonical exported constants", () => {
    expect(SUPPORT_QUEUE_PRIMARY_KEY_INLINE).toBe(SUPPORT_QUEUE_PRIMARY_KEY);
    expect(SUPPORT_QUEUE_PENDING_KEY_INLINE).toBe(SUPPORT_QUEUE_PENDING_KEY);
    expect(SUPPORT_QUEUE_LEGACY_KEY_INLINE).toBe(SUPPORT_QUEUE_LEGACY_KEY);
  });
});

const captureException = vi.hoisted(() => vi.fn());
const sweepSupportReportRetention = vi.hoisted(() =>
  vi.fn(async () => ({
    removedJobIds: [],
    retainedJobIds: [],
    removedLegacyDocument: false,
    reconciled: false,
  })),
);
const mockHost = vi.hoisted(() => ({
  storage: null as unknown as ProductStorage,
  desktop: undefined as
    | { diagnostics: { supportSnapshot: unknown } }
    | undefined,
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => mockHost,
}));

vi.mock("#product/hooks/telemetry/facade/use-product-telemetry", () => ({
  useProductTelemetry: () => ({ captureException }),
}));

vi.mock("./support-report-retention", () => ({
  sweepSupportReportRetention,
}));

class MemoryStorage implements ProductStorage {
  readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

beforeEach(() => {
  mockHost.storage = new MemoryStorage();
  mockHost.desktop = undefined;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useSupportReportRetentionLifecycle", () => {
  it("skips the sweep entirely when there is no native bridge and no storage state", async () => {
    renderHook(() => useSupportReportRetentionLifecycle());

    // There is nothing to await on the skip path, so this is a
    // negative-space assertion. A couple of microtask ticks is not enough:
    // the dynamic `import("./support-report-retention")` in the non-skip
    // path resolves over more than two microtask turns (it's still pending
    // at this point even when the guard is bypassed), so asserting after
    // only `await Promise.resolve()` twice would pass whether or not the
    // hook actually skipped. Wait on a real timer instead -- long enough for
    // the dynamic import and the mocked sweep call to have landed if the
    // hook were (incorrectly) proceeding -- then confirm it never was.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sweepSupportReportRetention).not.toHaveBeenCalled();
  });

  it("proceeds when a native supportSnapshot bridge is present, even with empty storage", async () => {
    const reconcileArtifacts = vi.fn();
    mockHost.desktop = { diagnostics: { supportSnapshot: { reconcileArtifacts } } };

    renderHook(() => useSupportReportRetentionLifecycle());

    await waitFor(() => expect(sweepSupportReportRetention).toHaveBeenCalledTimes(1));
    expect(sweepSupportReportRetention).toHaveBeenCalledWith(
      expect.objectContaining({
        storage: mockHost.storage,
        supportSnapshot: { reconcileArtifacts },
      }),
    );
  });

  it.each([
    ["primary", SUPPORT_QUEUE_PRIMARY_KEY],
    ["pending", SUPPORT_QUEUE_PENDING_KEY],
    ["legacy", SUPPORT_QUEUE_LEGACY_KEY],
  ])("proceeds when the %s queue key is present, even with no native bridge", async (_label, key) => {
    (mockHost.storage as MemoryStorage).values.set(key, "irrelevant");

    renderHook(() => useSupportReportRetentionLifecycle());

    await waitFor(() => expect(sweepSupportReportRetention).toHaveBeenCalledTimes(1));
  });

  it("reports a sweep failure without throwing", async () => {
    mockHost.desktop = {
      diagnostics: { supportSnapshot: { reconcileArtifacts: vi.fn() } },
    };
    const failure = new Error("boom");
    sweepSupportReportRetention.mockRejectedValueOnce(failure);

    renderHook(() => useSupportReportRetentionLifecycle());

    await waitFor(() => expect(captureException).toHaveBeenCalledWith(failure));
  });

  it("does not report after unmount (cancellation via isStale)", async () => {
    mockHost.desktop = {
      diagnostics: { supportSnapshot: { reconcileArtifacts: vi.fn() } },
    };
    let resolveSweep: (() => void) | undefined;
    sweepSupportReportRetention.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSweep = () =>
            resolve({
              removedJobIds: [],
              retainedJobIds: [],
              removedLegacyDocument: false,
              reconciled: false,
            });
        }),
    );

    const { unmount } = renderHook(() => useSupportReportRetentionLifecycle());
    await waitFor(() => expect(sweepSupportReportRetention).toHaveBeenCalledTimes(1));
    unmount();
    resolveSweep?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(captureException).not.toHaveBeenCalled();
  });
});
