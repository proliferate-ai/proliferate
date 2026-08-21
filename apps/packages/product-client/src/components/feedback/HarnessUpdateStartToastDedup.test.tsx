// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary } from "@anyharness/sdk";
import {
  HARNESS_UPDATE_TOAST_ID,
  HarnessUpdateToastPresenter,
} from "#product/components/feedback/HarnessUpdateToastPresenter";
import { useHarnessInstallAction } from "#product/hooks/agents/workflows/use-harness-install-action";

/**
 * Item 4 of spec-d: a manual harness update used to raise its own "started"
 * toast from use-harness-install-action.ts's scoped-reconcile branch, on top
 * of the in-progress toast HarnessUpdateToastPresenter raises once the same
 * reconcile job's status flips to queued/running. In production both read
 * the same reconcile-status query cache entry; this test stands a shared
 * fake store in for that cache entry so the wiring is real (neither
 * use-harness-install-action.ts's call into useToastStore, nor the toast
 * store/product-toast shim beneath it, is mocked — only the leaf toast
 * primitive is), and proves one job raises exactly one start toast.
 */

const reconcileStore = vi.hoisted(() => {
  let snapshot: Record<string, unknown> | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => snapshot,
    set(next: Record<string, unknown> | null) {
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

const reconcileAgentsCall = vi.hoisted(() => vi.fn());
const showToastSpy = vi.hoisted(() => vi.fn());
const dismissToastSpy = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("#product/primitives/utils/show-toast", () => ({
  showToast: showToastSpy,
  dismissToast: dismissToastSpy,
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigateMock }));
vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: false }),
}));

vi.mock("#product/hooks/agents/workflows/use-agent-installation-actions", () => ({
  useAgentInstallationActions: () => ({
    installAgent: vi.fn(),
    isInstallingAgent: false,
    isReconcilingAgents: false,
    isAgentSeedHydrating: false,
    supportsScopedReconcile: true,
    reconcileSnapshot: useSyncExternalStore(
      reconcileStore.subscribe,
      reconcileStore.get,
      reconcileStore.get,
    ),
    reconcileAgents: async (options: unknown) => {
      reconcileAgentsCall(options);
      // Simulate the reconcile-status poll flipping to "queued" once the
      // mutation resolves, the way the real SDK query would on its next tick.
      reconcileStore.set({
        jobId: "job-1",
        status: "queued",
        installedOnly: false,
        reinstall: true,
        results: [],
        progress: { components: [] },
      });
      return {};
    },
  }),
}));

vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({
    reconcileSnapshot: useSyncExternalStore(
      reconcileStore.subscribe,
      reconcileStore.get,
      reconcileStore.get,
    ),
    readyAgents: [],
    installingAgents: [],
    isLoading: false,
  }),
}));

const agent = {
  kind: "codex",
  displayName: "Codex",
  installState: "install_required",
  readiness: "install_required",
} as AgentSummary;

function InstallButtonHost() {
  const action = useHarnessInstallAction(agent);
  return (
    <button type="button" onClick={() => action?.onInstall()}>
      install
    </button>
  );
}

function Harness() {
  return (
    <>
      <InstallButtonHost />
      <HarnessUpdateToastPresenter includeCloud={false} />
    </>
  );
}

function startToastCalls() {
  return showToastSpy.mock.calls.filter(([input]) => {
    const record = input as { id?: string };
    return record?.id === HARNESS_UPDATE_TOAST_ID;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  reconcileStore.set(null);
});

afterEach(() => {
  cleanup();
});

describe("manual update start-toast dedup", () => {
  it("raises exactly one start toast for one job across the install action and the presenter", async () => {
    render(<Harness />);

    await act(async () => {
      screen.getByRole("button", { name: "install" }).click();
      await vi.waitFor(() => expect(reconcileAgentsCall).toHaveBeenCalledOnce());
    });

    expect(startToastCalls()).toHaveLength(1);
    // The old manual "started" toast never reaches the primitive either.
    expect(showToastSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/Updating Codex/) }),
    );
  });
});
