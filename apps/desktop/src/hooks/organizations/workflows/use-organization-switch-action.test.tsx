// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  collectRunningLocalSessionIds: vi.fn(() => ["session-1", "session-2"]),
  dismissSession: vi.fn().mockResolvedValue(undefined),
  getSessionRecords: vi.fn(() => ({ records: true })),
  setActiveOrganizationId: vi.fn(),
  teardownDesktopWorker: vi.fn().mockResolvedValue(undefined),
  worker: { stop: vi.fn() },
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ desktop: { worker: mocks.worker } }),
}));
vi.mock("@/hooks/telemetry/facade/use-product-telemetry", () => ({
  useProductTelemetry: () => ({
    captureException: mocks.captureException,
  }),
}));
vi.mock("@/hooks/organizations/workflows/use-organization-selection-actions", () => ({
  useOrganizationSelectionActions: () => ({
    setActiveOrganizationId: mocks.setActiveOrganizationId,
  }),
}));
vi.mock("@/hooks/sessions/workflows/use-session-dismiss-actions", () => ({
  useSessionDismissActions: () => ({ dismissSession: mocks.dismissSession }),
}));
vi.mock("@/lib/domain/sessions/running-local-sessions", () => ({
  collectRunningLocalSessionIds: mocks.collectRunningLocalSessionIds,
}));
vi.mock("@/lib/workflows/cloud/ensure-desktop-worker", () => ({
  teardownDesktopWorker: mocks.teardownDesktopWorker,
}));
vi.mock("@/stores/sessions/session-records", () => ({
  getSessionRecords: mocks.getSessionRecords,
}));

import { useOrganizationSwitchAction } from "./use-organization-switch-action";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collectRunningLocalSessionIds.mockReturnValue([
    "session-1",
    "session-2",
  ]);
  mocks.dismissSession.mockResolvedValue(undefined);
  mocks.teardownDesktopWorker.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("useOrganizationSwitchAction", () => {
  it("injects product telemetry while rotating the Desktop worker identity", async () => {
    const { result } = renderHook(() => useOrganizationSwitchAction());

    await act(async () => {
      await result.current.switchOrganization("org-2");
    });

    expect(mocks.dismissSession.mock.calls).toEqual([
      ["session-1"],
      ["session-2"],
    ]);
    expect(mocks.teardownDesktopWorker).toHaveBeenCalledWith(mocks.worker, {
      captureException: mocks.captureException,
    });
    expect(mocks.setActiveOrganizationId).toHaveBeenCalledWith("org-2");
  });

  it("does not publish the organization until worker teardown settles", async () => {
    let finishTeardown: (() => void) | null = null;
    mocks.collectRunningLocalSessionIds.mockReturnValue([]);
    mocks.teardownDesktopWorker.mockImplementation(
      () => new Promise<void>((resolve) => {
        finishTeardown = resolve;
      }),
    );
    const { result } = renderHook(() => useOrganizationSwitchAction());

    let switching: Promise<void> | undefined;
    act(() => {
      switching = result.current.switchOrganization("org-2");
    });
    expect(mocks.setActiveOrganizationId).not.toHaveBeenCalled();

    await act(async () => {
      finishTeardown?.();
      await switching;
    });
    expect(mocks.setActiveOrganizationId).toHaveBeenCalledWith("org-2");
  });
});
