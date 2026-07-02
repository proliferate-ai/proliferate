// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentAuthState } from "@proliferate/cloud-sdk";
import { useDirectRuntimeConnectionStore } from "@/stores/compute/direct-runtime-connection-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useDirectAuthStateSync } from "./use-direct-auth-state-sync";

const mocks = vi.hoisted(() => ({
  applyAgentAuthState: vi.fn(),
  useAgentAuthStates: vi.fn(),
  useCloudAvailabilityState: vi.fn(),
  useCloudTargets: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentAuthStates: mocks.useAgentAuthStates,
}));

vi.mock("@/hooks/access/cloud/targets/use-cloud-targets", () => ({
  useCloudTargets: mocks.useCloudTargets,
}));

vi.mock("@/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: mocks.useCloudAvailabilityState,
}));

vi.mock("@/lib/access/anyharness/agent-auth", () => ({
  applyAgentAuthState: mocks.applyAgentAuthState,
}));

const LOOPBACK_URL = "http://127.0.0.1:8457";
const TUNNEL_URL = "http://127.0.0.1:52001";
const REATTACHED_TUNNEL_URL = "http://127.0.0.1:52002";

interface StateDocEntry {
  data: AgentAuthState | undefined;
  dataUpdatedAt: number;
}

const stateDocs = new Map<string, StateDocEntry>();

function docKey(targetId: string | null): string {
  return targetId ?? "loopback";
}

function setStateDoc(
  targetId: string | null,
  data: AgentAuthState | undefined,
  dataUpdatedAt = 1,
) {
  stateDocs.set(docKey(targetId), { data, dataUpdatedAt });
}

function doc(revision: number, marker: string): AgentAuthState {
  return {
    revision,
    user_id: "user-1",
    selections:
      revision <= 0
        ? []
        : [{ harness: "claude", route: "native", slot: "primary", provider: marker }],
  } as AgentAuthState;
}

function arrange(options: {
  cloudActive?: boolean;
  targets?: Array<{ id: string; kind: string; status: string }>;
} = {}) {
  mocks.applyAgentAuthState.mockResolvedValue(undefined);
  mocks.useCloudAvailabilityState.mockReturnValue({
    cloudActive: options.cloudActive ?? true,
  });
  mocks.useCloudTargets.mockReturnValue({ data: options.targets ?? [] });
  mocks.useAgentAuthStates.mockImplementation(
    (_surface: string, targetIds: ReadonlyArray<string | null>) =>
      targetIds.map(
        (targetId) =>
          stateDocs.get(docKey(targetId)) ?? { data: undefined, dataUpdatedAt: 0 },
      ),
  );
  useHarnessConnectionStore.setState({
    runtimeUrl: LOOPBACK_URL,
    connectionState: "healthy",
    error: null,
  });
}

function attachTarget(
  targetId: string,
  authToken: string | null,
  baseUrl = TUNNEL_URL,
) {
  act(() => {
    useDirectRuntimeConnectionStore.getState().dispatchConnectionEvent(targetId, {
      type: "attached",
      baseUrl,
      authToken,
    });
  });
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useDirectAuthStateSync", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    stateDocs.clear();
    useDirectRuntimeConnectionStore.getState().resetConnections();
    useHarnessConnectionStore.getState().resetConnectionState();
  });

  it("pushes the default document to the healthy loopback runtime", async () => {
    arrange();
    setStateDoc(null, doc(1, "default"));

    renderHook(() => useDirectAuthStateSync());

    await waitFor(() => {
      expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(1);
    });
    expect(mocks.applyAgentAuthState).toHaveBeenCalledWith(
      { runtimeUrl: LOOPBACK_URL, authToken: null },
      doc(1, "default"),
    );
  });

  it("never pushes a revision-0 document", async () => {
    arrange();
    setStateDoc(null, doc(0, "default"));

    renderHook(() => useDirectAuthStateSync());
    await flushEffects();

    expect(mocks.applyAgentAuthState).not.toHaveBeenCalled();
  });

  it("does nothing while cloud is inactive", async () => {
    arrange({ cloudActive: false });
    setStateDoc(null, doc(1, "default"));

    renderHook(() => useDirectAuthStateSync());
    await flushEffects();

    expect(mocks.applyAgentAuthState).not.toHaveBeenCalled();
  });

  it("defers a target push until that runtime attaches", async () => {
    arrange({ targets: [{ id: "t1", kind: "ssh", status: "online" }] });
    setStateDoc(null, doc(1, "default"));
    setStateDoc("t1", doc(2, "t1-doc"));

    renderHook(() => useDirectAuthStateSync());

    await waitFor(() => {
      expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(1);
    });
    expect(mocks.applyAgentAuthState).toHaveBeenCalledWith(
      { runtimeUrl: LOOPBACK_URL, authToken: null },
      doc(1, "default"),
    );

    attachTarget("t1", "bearer-1");

    await waitFor(() => {
      expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(2);
    });
    expect(mocks.applyAgentAuthState).toHaveBeenLastCalledWith(
      { runtimeUrl: TUNNEL_URL, authToken: "bearer-1" },
      doc(2, "t1-doc"),
    );
  });

  it("keeps per-runtime fingerprints isolated", async () => {
    arrange({ targets: [{ id: "t1", kind: "ssh", status: "online" }] });
    // Zero-override runtime: both runtimes receive the identical inherited
    // document, and each must still get its own push.
    setStateDoc(null, doc(1, "shared"));
    setStateDoc("t1", doc(1, "shared"));

    const { rerender } = renderHook(() => useDirectAuthStateSync());
    attachTarget("t1", "bearer-1");

    await waitFor(() => {
      expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(2);
    });

    // Unchanged documents re-render without re-pushing either runtime.
    rerender();
    await flushEffects();
    expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(2);

    // A per-target override re-pushes only that runtime.
    setStateDoc("t1", doc(2, "t1-override"), 2);
    rerender();
    await waitFor(() => {
      expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(3);
    });
    expect(mocks.applyAgentAuthState).toHaveBeenLastCalledWith(
      { runtimeUrl: TUNNEL_URL, authToken: "bearer-1" },
      doc(2, "t1-override"),
    );
  });

  it("re-pushes an unchanged document after a detach and re-attach", async () => {
    arrange({ targets: [{ id: "t1", kind: "ssh", status: "online" }] });
    setStateDoc(null, doc(1, "default"));
    setStateDoc("t1", doc(1, "shared"));

    renderHook(() => useDirectAuthStateSync());
    attachTarget("t1", "bearer-1");
    await waitFor(() => {
      expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(2);
    });

    // A re-imaged + re-enrolled box keeps its target id but comes back with
    // state.json wiped; the observed detach must forget the fingerprint so
    // the re-attach re-delivers the document.
    act(() => {
      useDirectRuntimeConnectionStore.getState().dispatchConnectionEvent("t1", {
        type: "detached",
      });
    });
    await flushEffects();
    attachTarget("t1", "bearer-2");

    await waitFor(() => {
      expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(3);
    });
    expect(mocks.applyAgentAuthState).toHaveBeenLastCalledWith(
      { runtimeUrl: TUNNEL_URL, authToken: "bearer-2" },
      doc(1, "shared"),
    );
  });

  it("retries when a trigger fired while the failing push was in flight", async () => {
    arrange();
    let rejectPush!: (error: Error) => void;
    mocks.applyAgentAuthState.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectPush = reject;
        }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setStateDoc(null, doc(1, "default"));

    const { rerender } = renderHook(() => useDirectAuthStateSync());
    await waitFor(() => {
      expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(1);
    });

    // A refetch of the identical document while the push is in flight is
    // skipped as a duplicate, not double-pushed.
    setStateDoc(null, doc(1, "default"), 2);
    rerender();
    await flushEffects();
    expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(1);

    // The failure must replay the suppressed trigger, not consume it.
    await act(async () => {
      rejectPush(new Error("push failed"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(2);
    });
    warn.mockRestore();
  });

  it("pushes to a re-attached connection while the old push is in flight", async () => {
    arrange({ targets: [{ id: "t1", kind: "ssh", status: "online" }] });
    let rejectOldTunnelPush!: (error: Error) => void;
    mocks.applyAgentAuthState.mockImplementation(
      (connection: { runtimeUrl: string }) => {
        if (connection.runtimeUrl === TUNNEL_URL) {
          return new Promise((_resolve, reject) => {
            rejectOldTunnelPush = reject;
          });
        }
        return Promise.resolve(undefined);
      },
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setStateDoc(null, doc(1, "default"));
    setStateDoc("t1", doc(1, "shared"));

    renderHook(() => useDirectAuthStateSync());
    attachTarget("t1", "bearer-1");
    await waitFor(() => {
      expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(2);
    });

    // The tunnel drops mid-push; a session flow re-ensures it at a new local
    // port. The re-attached connection must be served without waiting for
    // the doomed original push to settle.
    act(() => {
      useDirectRuntimeConnectionStore.getState().dispatchConnectionEvent("t1", {
        type: "connect_started",
      });
    });
    await flushEffects();
    attachTarget("t1", "bearer-1", REATTACHED_TUNNEL_URL);

    await waitFor(() => {
      expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(3);
    });
    expect(mocks.applyAgentAuthState).toHaveBeenLastCalledWith(
      { runtimeUrl: REATTACHED_TUNNEL_URL, authToken: "bearer-1" },
      doc(1, "shared"),
    );

    // The orphaned push settling later must not force a fourth push.
    await act(async () => {
      rejectOldTunnelPush(new Error("tunnel dropped"));
      await Promise.resolve();
    });
    await flushEffects();
    expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("retries a failed push on the next state change", async () => {
    arrange();
    mocks.applyAgentAuthState.mockRejectedValueOnce(new Error("push failed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setStateDoc(null, doc(1, "default"));

    const { rerender } = renderHook(() => useDirectAuthStateSync());

    await waitFor(() => {
      expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(1);
    });
    await flushEffects();

    // The failed fingerprint was not recorded, so the next data refresh
    // pushes again.
    setStateDoc(null, doc(1, "default"), 2);
    rerender();
    await waitFor(() => {
      expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(2);
    });
    warn.mockRestore();
  });
});
