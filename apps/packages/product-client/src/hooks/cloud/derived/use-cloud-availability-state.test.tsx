// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthState } from "@proliferate/product-client/host/product-host";

const mocks = vi.hoisted(() => ({
  authStatus: vi.fn<() => AuthState["status"]>(),
  logStartupDebug: vi.fn(),
}));

vi.mock("#product/hooks/auth/facade/use-product-auth", () => ({
  useProductAuthStatus: mocks.authStatus,
}));

vi.mock("#product/hooks/capabilities/derived/use-app-capabilities", () => ({
  useAppCapabilities: () => ({
    controlPlaneReachable: true,
    cloudComputeEnabled: true,
  }),
}));

vi.mock("#product/lib/infra/measurement/measurement-port", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("#product/lib/infra/measurement/measurement-port")
  >()),
  logStartupDebug: mocks.logStartupDebug,
}));

// The dedupe guard (`lastLoggedCloudAvailabilityState`) is module-scoped —
// many concurrent consumers share one log, and a component-local ref cannot
// see another instance's last-logged value. Each test loads the hook from a
// fresh module registry so an earlier test's guard state can't leak in.
async function loadCloudAvailabilityHook() {
  vi.resetModules();
  const { useCloudAvailabilityState } = await import(
    "#product/hooks/cloud/derived/use-cloud-availability-state"
  );
  return useCloudAvailabilityState;
}

describe("useCloudAvailabilityState derived-state dedupe", () => {
  afterEach(() => {
    cleanup();
  });

  it("emits once for the same derived state across two concurrent hook mounts", async () => {
    mocks.logStartupDebug.mockClear();
    const useCloudAvailabilityState = await loadCloudAvailabilityHook();
    mocks.authStatus.mockReturnValue("loading");

    // This is the real shape of the original flood: many components mount
    // their own instance of the hook and each independently computes the
    // same startup-time derived state (909 of 1,196 records in the
    // 2026-08-13 dogfood run were exact duplicates across instances).
    const first = renderHook(() => useCloudAvailabilityState());
    const second = renderHook(() => useCloudAvailabilityState());

    expect(mocks.logStartupDebug).toHaveBeenCalledTimes(1);
    expect(mocks.logStartupDebug).toHaveBeenCalledWith(
      "cloud.availability.derived_state",
      expect.objectContaining({ authStatus: "loading" }),
    );

    first.unmount();
    second.unmount();
  });

  it("emits on every genuine transition: A -> B -> A logs three times", async () => {
    mocks.logStartupDebug.mockClear();
    const useCloudAvailabilityState = await loadCloudAvailabilityHook();
    mocks.authStatus.mockReturnValue("loading");
    const { rerender, unmount } = renderHook(() => useCloudAvailabilityState());
    expect(mocks.logStartupDebug).toHaveBeenCalledTimes(1);

    mocks.authStatus.mockReturnValue("anonymous");
    rerender();
    expect(mocks.logStartupDebug).toHaveBeenCalledTimes(2);

    mocks.authStatus.mockReturnValue("loading");
    rerender();
    expect(mocks.logStartupDebug).toHaveBeenCalledTimes(3);

    expect(mocks.logStartupDebug.mock.calls.map(([, fields]) => (
      (fields as { authStatus: string }).authStatus
    ))).toEqual(["loading", "anonymous", "loading"]);

    unmount();
  });
});
