// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopWorkerBridge } from "@proliferate/product-client/host/desktop-bridge";
import type { AuthState } from "@proliferate/product-client/host/product-host";

interface EnrollmentAuthProps {
  authStatus: AuthState["status"];
  authUserId: string | null;
}

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

// Toasts now render through the unified Sonner product toast; the legacy
// store delegates to it, so capture calls here instead of reading store state.
const toastMocks = vi.hoisted(() => ({
  showProductToast: vi.fn<(message: string, kind?: "error" | "info") => void>(),
  showProductErrorToast: vi.fn<(input: Record<string, unknown>) => void>(),
  dismissToast: vi.fn<(id?: string) => void>(),
}));

vi.mock("#product/components/feedback/product-toast", () => ({
  showProductToast: toastMocks.showProductToast,
  showProductErrorToast: toastMocks.showProductErrorToast,
}));

vi.mock("#product/primitives/utils/show-toast", () => ({
  dismissToast: toastMocks.dismissToast,
}));

vi.mock("#product/lib/workflows/cloud/ensure-desktop-worker", () => ({
  ensureDesktopWorker: workflowMocks.ensureDesktopWorker,
  teardownDesktopWorker: workflowMocks.teardownDesktopWorker,
}));

const worker = {} as DesktopWorkerBridge;

// The enrollment guard is module-level state, so each test loads the hook
// (and the stores it observes) from a fresh module registry. Normalized auth
// (status + user id) now arrives as props from the lifecycle root, so the
// harness drives it through rerender rather than the auth store.
async function loadEnrollmentHarness() {
  vi.resetModules();
  const { ProductHostProvider } = await import(
    "@proliferate/product-client/host/ProductHostProvider"
  );
  const { makeTestProductHost } = await import(
    "#product/test/product-host-fixtures"
  );
  const { useOrganizationStore } = await import("#product/stores/organizations/organization-store");
  const { useDesktopWorkerEnrollment } = await import("#product/hooks/cloud/lifecycle/use-desktop-worker-enrollment");
  useOrganizationStore.setState({
    activeOrganizationId: null,
    activeOrganizationValidated: false,
  });
  toastMocks.showProductToast.mockClear();
  toastMocks.showProductErrorToast.mockClear();
  toastMocks.dismissToast.mockClear();
  // The enrollment hook reads captureException through the product telemetry
  // facade (host boundary), so the harness mounts a ProductHostProvider.
  // Both provider and hook come from the same post-reset module registry so
  // they share one ProductHostContext instance.
  const host = makeTestProductHost();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ProductHostProvider host={host}>{children}</ProductHostProvider>
  );
  const props: EnrollmentAuthProps = { authStatus: "loading", authUserId: null };
  const rendered = renderHook(
    ({ authStatus, authUserId }: EnrollmentAuthProps) =>
      useDesktopWorkerEnrollment(worker, authStatus, authUserId),
    { initialProps: props, wrapper },
  );
  const setProps = (next: EnrollmentAuthProps) => {
    props.authStatus = next.authStatus;
    props.authUserId = next.authUserId;
    rendered.rerender({ ...props });
  };
  return {
    ...rendered,
    rerender: () => rendered.rerender({ ...props }),
    signIn: (id: string) =>
      setProps({ authStatus: "authenticated", authUserId: id }),
    signOut: () => setProps({ authStatus: "anonymous", authUserId: null }),
    setOrganization: (organizationId: string | null) =>
      useOrganizationStore.getState().setActiveOrganizationId(organizationId, {
        validated: true,
      }),
    getToastCalls: () => toastMocks.showProductToast.mock.calls,
    getErrorToastCalls: () => toastMocks.showProductErrorToast.mock.calls,
    nudgeRender: () => rendered.rerender({ ...props }),
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

  it("shows one persistent actionable startup notification", async () => {
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
      expect(harness.getErrorToastCalls()).toEqual([
        [
          expect.objectContaining({
            id: "desktop-worker-startup-failure",
            headline: "Cloud integrations unavailable",
            consequence:
              "Proliferate will keep trying in the background. Retry now, or dismiss this notice.",
            cause: "worker exited: enrollment contract mismatch",
            retry: expect.any(Function),
            onDismiss: expect.any(Function),
          }),
        ],
      ]);
    });
    expect(harness.getToastCalls()).toEqual([]);
  });

  it("explains how to recover when an earlier worker owns the credentials", async () => {
    workflowMocks.ensureDesktopWorker.mockImplementationOnce(async (
      _organizationId,
      _worker,
      deps,
    ) => {
      deps.onFailure(
        "Cannot replace worker credentials while a Proliferate Worker is still running.",
      );
      return false;
    });
    const harness = await loadEnrollmentHarness();

    harness.signIn("user-a");
    await waitFor(() => {
      expect(harness.getErrorToastCalls()).toEqual([
        [
          expect.objectContaining({
            headline: "Cloud integrations unavailable",
            consequence:
              "An earlier Proliferate Worker is still running. Quit other Proliferate apps; if none are open, restart your computer, then retry.",
          }),
        ],
      ]);
    });
  });

  it("keeps retrying without raising the same notification again", async () => {
    vi.useFakeTimers();
    try {
      workflowMocks.ensureDesktopWorker.mockImplementation(async (
        _organizationId,
        _worker,
        deps,
      ) => {
        deps.onFailure("worker is still unavailable");
        return false;
      });
      const harness = await loadEnrollmentHarness();

      await act(async () => {
        harness.signIn("user-a");
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(1);
      expect(harness.getErrorToastCalls()).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(2);
      expect(harness.getErrorToastCalls()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes the notification when a retry fails for a different cause", async () => {
    vi.useFakeTimers();
    try {
      workflowMocks.ensureDesktopWorker
        .mockImplementationOnce(async (_organizationId, _worker, deps) => {
          deps.onFailure("control plane unavailable");
          return false;
        })
        .mockImplementationOnce(async (_organizationId, _worker, deps) => {
          deps.onFailure("worker process exited");
          return false;
        });
      const harness = await loadEnrollmentHarness();

      await act(async () => {
        harness.signIn("user-a");
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(harness.getErrorToastCalls()).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(harness.getErrorToastCalls()).toHaveLength(2);
      expect(harness.getErrorToastCalls()[1]?.[0]).toEqual(
        expect.objectContaining({ cause: "worker process exited" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not resurface a dismissed failure during background retries", async () => {
    vi.useFakeTimers();
    try {
      workflowMocks.ensureDesktopWorker.mockImplementation(async (
        _organizationId,
        _worker,
        deps,
      ) => {
        deps.onFailure("worker is still unavailable");
        return false;
      });
      const harness = await loadEnrollmentHarness();

      await act(async () => {
        harness.signIn("user-a");
        await vi.advanceTimersByTimeAsync(0);
      });
      const notice = harness.getErrorToastCalls()[0]?.[0] as {
        onDismiss: () => void;
      };
      act(() => notice.onDismiss());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(2);
      expect(harness.getErrorToastCalls()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resurfaces a dismissed notification when the failure cause changes", async () => {
    vi.useFakeTimers();
    try {
      workflowMocks.ensureDesktopWorker
        .mockImplementationOnce(async (_organizationId, _worker, deps) => {
          deps.onFailure("control plane unavailable");
          return false;
        })
        .mockImplementationOnce(async (_organizationId, _worker, deps) => {
          deps.onFailure("worker process exited");
          return false;
        });
      const harness = await loadEnrollmentHarness();

      await act(async () => {
        harness.signIn("user-a");
        await vi.advanceTimersByTimeAsync(0);
      });
      const notice = harness.getErrorToastCalls()[0]?.[0] as {
        onDismiss: () => void;
      };
      act(() => notice.onDismiss());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(harness.getErrorToastCalls()).toHaveLength(2);
      expect(harness.getErrorToastCalls()[1]?.[0]).toEqual(
        expect.objectContaining({ cause: "worker process exited" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes an active notification when a previously dismissed cause returns", async () => {
    vi.useFakeTimers();
    try {
      workflowMocks.ensureDesktopWorker
        .mockImplementationOnce(async (_organizationId, _worker, deps) => {
          deps.onFailure("control plane unavailable");
          return false;
        })
        .mockImplementationOnce(async (_organizationId, _worker, deps) => {
          deps.onFailure("worker process exited");
          return false;
        })
        .mockImplementationOnce(async (_organizationId, _worker, deps) => {
          deps.onFailure("control plane unavailable");
          return false;
        });
      const harness = await loadEnrollmentHarness();

      await act(async () => {
        harness.signIn("user-a");
        await vi.advanceTimersByTimeAsync(0);
      });
      const firstNotice = harness.getErrorToastCalls()[0]?.[0] as {
        onDismiss: () => void;
      };
      act(() => firstNotice.onDismiss());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(harness.getErrorToastCalls()[1]?.[0]).toEqual(
        expect.objectContaining({ cause: "worker process exited" }),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(harness.getErrorToastCalls()).toHaveLength(3);
      expect(harness.getErrorToastCalls()[2]?.[0]).toEqual(
        expect.objectContaining({ cause: "control plane unavailable" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries immediately from the notification and clears it on recovery", async () => {
    workflowMocks.ensureDesktopWorker
      .mockImplementationOnce(async (_organizationId, _worker, deps) => {
        deps.onFailure("worker is still unavailable");
        return false;
      })
      .mockResolvedValueOnce(true);
    const harness = await loadEnrollmentHarness();

    harness.signIn("user-a");
    await waitFor(() => {
      expect(harness.getErrorToastCalls()).toHaveLength(1);
    });
    const notice = harness.getErrorToastCalls()[0]?.[0] as {
      retry: () => void;
    };
    act(() => notice.retry());

    await waitFor(() => {
      expect(workflowMocks.ensureDesktopWorker).toHaveBeenCalledTimes(2);
      expect(toastMocks.dismissToast).toHaveBeenCalledWith(
        "desktop-worker-startup-failure",
      );
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
    expect(harness.getErrorToastCalls()).toEqual([]);
  });
});
