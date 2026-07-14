// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopWorkerBridge } from "@proliferate/product-client/host/desktop-bridge";
import type { AuthUser } from "@/lib/domain/auth/auth-user";

const workflowMocks = vi.hoisted(() => ({
  ensureDesktopWorker: vi.fn<
    (
      organizationId: string | null,
      worker: DesktopWorkerBridge,
      deps: { onFailure: (error: unknown) => void },
    ) => Promise<boolean>
  >(),
  teardownDesktopWorker: vi.fn<(worker: DesktopWorkerBridge) => Promise<void>>(),
}));

vi.mock("@/lib/workflows/cloud/ensure-desktop-worker", () => ({
  ensureDesktopWorker: workflowMocks.ensureDesktopWorker,
  teardownDesktopWorker: workflowMocks.teardownDesktopWorker,
}));

function authUser(id: string): AuthUser {
  return { id, email: `${id}@example.com`, display_name: null };
}

const worker = {} as DesktopWorkerBridge;

// The enrollment guard is module-level state, so each test loads the hook
// (and the stores it observes) from a fresh module registry.
async function loadEnrollmentHarness() {
  vi.resetModules();
  const { useAuthStore } = await import("@/stores/auth/auth-store");
  const { useOrganizationStore } = await import("@/stores/organizations/organization-store");
  const { useToastStore } = await import("@/stores/toast/toast-store");
  const { useDesktopWorkerEnrollment } = await import("./use-desktop-worker-enrollment");
  useAuthStore.setState({
    status: "bootstrapping",
    session: null,
    user: null,
    error: null,
  });
  useOrganizationStore.setState({
    activeOrganizationId: null,
    activeOrganizationValidated: false,
  });
  useToastStore.setState({ toasts: [] });
  const rendered = renderHook(() => useDesktopWorkerEnrollment(worker));
  return {
    ...rendered,
    signIn: (id: string) =>
      useAuthStore.setState({ status: "authenticated", user: authUser(id) }),
    signOut: () => useAuthStore.setState({ status: "anonymous", user: null }),
    setOrganization: (organizationId: string | null) =>
      useOrganizationStore.getState().setActiveOrganizationId(organizationId, {
        validated: true,
      }),
    getToasts: () => useToastStore.getState().toasts,
    nudgeRender: () => useAuthStore.setState({ error: "nudge a re-render" }),
  };
}

function flushEffects() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("useDesktopWorkerEnrollment", () => {
  beforeEach(() => {
    workflowMocks.ensureDesktopWorker.mockReset();
    workflowMocks.teardownDesktopWorker.mockReset();
    workflowMocks.ensureDesktopWorker.mockResolvedValue(true);
    workflowMocks.teardownDesktopWorker.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("enrolls once when a user authenticates and not again for the same user", async () => {
    const harness = await loadEnrollmentHarness();
    expect(workflowMocks.ensureDesktopWorker).not.toHaveBeenCalled();

    harness.signIn("user-a");
    await waitFor(() => {
      expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(1);
    });

    harness.rerender();
    harness.signIn("user-a");
    await flushEffects();
    expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(1);
    expect(workflowMocks.teardownDesktopWorker).not.toHaveBeenCalled();
  });

  it("does not tear down or enroll on a cold anonymous start", async () => {
    const harness = await loadEnrollmentHarness();
    harness.signOut();
    await flushEffects();
    expect(workflowMocks.ensureDesktopWorker).not.toHaveBeenCalled();
    expect(workflowMocks.teardownDesktopWorker).not.toHaveBeenCalled();
  });

  it("re-enrolls when a different user signs in within the same app process", async () => {
    const harness = await loadEnrollmentHarness();

    harness.signIn("user-a");
    await waitFor(() => {
      expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(1);
    });

    harness.signIn("user-b");
    await waitFor(() => {
      expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(2);
    });
  });

  it("re-enrolls when a different user signs in under the same organization", async () => {
    const harness = await loadEnrollmentHarness();

    harness.setOrganization("org-1");
    harness.signIn("user-a");
    await waitFor(() => {
      expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(1);
    });

    harness.signIn("user-b");
    await waitFor(() => {
      expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(2);
    });
    expect(workflowMocks.teardownDesktopWorker).not.toHaveBeenCalled();
  });

  it("re-enrolls on an org->org change without tearing down itself", async () => {
    // The destructive part of an org->org switch (confirm dialog, closing
    // local sessions, teardownDesktopWorker) runs in the organization switch
    // action before the store changes; the guard only re-enrolls.
    const harness = await loadEnrollmentHarness();

    harness.setOrganization("org-1");
    harness.signIn("user-a");
    await waitFor(() => {
      expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(1);
    });

    harness.setOrganization("org-2");
    await waitFor(() => {
      expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(2);
    });
    expect(workflowMocks.ensureDesktopWorker).toHaveBeenLastCalledWith(
      "org-2",
      worker,
      expect.objectContaining({ onFailure: expect.any(Function) }),
    );
    expect(workflowMocks.teardownDesktopWorker).not.toHaveBeenCalled();
  });

  it("adopts a first organization in place: plain re-enroll, no teardown", async () => {
    const harness = await loadEnrollmentHarness();

    harness.signIn("user-a");
    await waitFor(() => {
      expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(1);
    });

    // Org-less user gains their first organization: the guard key updates
    // and the worker re-enrolls without disturbing anything.
    harness.setOrganization("org-1");
    await waitFor(() => {
      expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(2);
    });
    expect(workflowMocks.teardownDesktopWorker).not.toHaveBeenCalled();

    // Same (user, org) again is a no-op.
    harness.setOrganization("org-1");
    await flushEffects();
    expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(2);
  });

  it("tears down on sign-out and re-enrolls on the next login", async () => {
    const harness = await loadEnrollmentHarness();

    harness.setOrganization("org-1");
    harness.signIn("user-a");
    await waitFor(() => {
      expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(1);
    });

    harness.signOut();
    await waitFor(() => {
      expect(workflowMocks.teardownDesktopWorker).toHaveBeenCalledTimes(1);
    });

    // Guard was reset, so even the same user re-enrolls with a fresh identity.
    harness.signIn("user-a");
    await waitFor(() => {
      expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(2);
    });
  });

  it("tears down only once per sign-out", async () => {
    const harness = await loadEnrollmentHarness();

    harness.signIn("user-a");
    await waitFor(() => {
      expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(1);
    });

    harness.signOut();
    await waitFor(() => {
      expect(workflowMocks.teardownDesktopWorker).toHaveBeenCalledTimes(1);
    });

    harness.nudgeRender();
    await flushEffects();
    expect(workflowMocks.teardownDesktopWorker).toHaveBeenCalledTimes(1);
  });

  it("clears the guard and retries when enrollment fails", async () => {
    vi.useFakeTimers();
    try {
      workflowMocks.ensureDesktopWorker.mockResolvedValueOnce(false);
      const harness = await loadEnrollmentHarness();

      await act(async () => {
        harness.signIn("user-a");
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(1);

      // The failed attempt cleared the guard and scheduled a retry; once the
      // delay elapses the effect re-runs and enrolls again.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the native startup failure to the user", async () => {
    workflowMocks.ensureDesktopWorker.mockImplementationOnce(async (
      _organizationId,
      _worker,
      deps,
    ) => {
      deps.onFailure("worker exited: enrollment contract mismatch");
      return false;
    });
    const harness = await loadEnrollmentHarness();

    harness.signIn("user-a");
    await waitFor(() => {
      expect(harness.getToasts()).toEqual([
        expect.objectContaining({
          message:
            "Cloud integrations worker failed to start: worker exited: enrollment contract mismatch",
          type: "error",
        }),
      ]);
    });
  });

  it("does not show a stale failure after sign-out cancels enrollment", async () => {
    let failOldEnrollment: (() => void) | null = null;
    workflowMocks.ensureDesktopWorker.mockImplementationOnce(
      (_organizationId, _worker, deps) =>
        new Promise<boolean>((resolve) => {
          failOldEnrollment = () => {
            deps.onFailure("old identity failed after sign-out");
            resolve(false);
          };
        }),
    );
    const harness = await loadEnrollmentHarness();

    harness.signIn("user-a");
    await waitFor(() => {
      expect(failOldEnrollment).not.toBeNull();
    });
    harness.signOut();
    await waitFor(() => {
      expect(workflowMocks.teardownDesktopWorker).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      failOldEnrollment?.();
      await flushEffects();
    });
    expect(harness.getToasts()).toEqual([]);
  });
});
