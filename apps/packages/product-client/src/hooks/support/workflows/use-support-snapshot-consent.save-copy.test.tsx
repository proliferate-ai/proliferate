/* @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PreparedSupportSnapshotV1,
  SupportSnapshotPreparation,
} from "@proliferate/product-client/host/desktop-bridge";
import { useSupportSnapshotConsent } from "#product/hooks/support/workflows/use-support-snapshot-consent";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

const bridge = vi.hoisted(() => ({
  beginPreparation: vi.fn(),
  finishPreparation: vi.fn(),
  cancelPreparation: vi.fn(async () => {}),
  saveArchive: vi.fn(async () => "diagnostics.zip" as string | null),
  readArtifact: vi.fn(),
  deleteArtifact: vi.fn(async () => {}),
  reconcileArtifacts: vi.fn(),
  beginSubmission: vi.fn(),
  finishSubmission: vi.fn(),
}));

const host = vi.hoisted(() => ({ supportSnapshot: bridge as unknown as null | typeof bridge }));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    desktop: {
      runtime: { getConnection: vi.fn(), restart: vi.fn() },
      diagnostics: { supportSnapshot: host.supportSnapshot },
    },
  }),
}));

const access = vi.hoisted(() => ({
  resolveSupportSnapshotAccess: vi.fn(),
  collectResolvedSupportSessionEvidence: vi.fn(),
}));

vi.mock("#product/lib/access/anyharness/support-snapshot-connection", () => access);

const PREPARATION: SupportSnapshotPreparation = {
  preparationId: "prep-1",
  preparationOperationId: "op-1",
  capturedAt: "2026-08-13T00:00:00.000Z",
  window: {
    sourceTimeFrom: "2026-08-12T23:45:00.000Z",
    sourceTimeTo: "2026-08-13T00:00:00.000Z",
  },
};

const ARTIFACT: PreparedSupportSnapshotV1 = {
  artifactSchemaVersion: 3,
  artifactId: "artifact-1",
  snapshotId: "snapshot-1",
  preparationOperationId: "op-1",
  generatedAt: "2026-08-13T00:00:01.000Z",
  sizeBytes: 2048,
  sha256: "a".repeat(64),
  summary: {
    collectorRecords: 4,
    fallbackRecords: 0,
    sessions: 1,
    omissions: 0,
    truncations: 0,
  },
};

const INCLUDED_EVIDENCE = {
  state: "included" as const,
  sessionEvidenceJson: "{}",
  sessionCollection: {
    state: "included" as const,
    workspaceId: "ws-1",
    anyharnessWorkspaceId: "ws-1",
    selectedSessions: 1,
    sessionIncludedBytes: 10,
    eventIncludedBytes: 10,
    rawNotificationIncludedBytes: 0,
    limitUncertainEndpoints: 0,
  },
};
const CLEANUP_NOT_STARTED = { state: "not_started", reason: "cleanup_unconfirmed" } as const;
const CLEANUP_BLOCKED = { state: "blocked", reason: "cleanup_unconfirmed" } as const;

function resolvedAccess() {
  return {
    state: "resolved" as const,
    selection: {
      kind: "active_session" as const,
      workspace: {
        kind: "bundled_local" as const,
        workspaceId: "ws-1",
        anyharnessWorkspaceId: "ws-1",
      },
      uiSessionId: "session-1",
      materializedSessionId: "materialized-1",
    },
  };
}

function configureDefaults() {
  vi.clearAllMocks();
  host.supportSnapshot = bridge;
  bridge.beginPreparation.mockResolvedValue(PREPARATION);
  bridge.finishPreparation.mockResolvedValue(ARTIFACT);
  bridge.cancelPreparation.mockResolvedValue(undefined);
  bridge.saveArchive.mockResolvedValue("diagnostics.zip");
  bridge.deleteArtifact.mockResolvedValue(undefined);
  access.resolveSupportSnapshotAccess.mockResolvedValue(resolvedAccess());
  access.collectResolvedSupportSessionEvidence.mockResolvedValue(INCLUDED_EVIDENCE);
}

function renderConsent() {
  return renderHook(() => useSupportSnapshotConsent({
    clientJobId: "job-1",
    reportOpenedAt: "2026-08-13T00:00:00.000Z",
  }));
}

function renderConsented() {
  const rendered = renderConsent();
  act(() => { rendered.result.current.setConsent(true); });
  return rendered;
}

type RenderedConsent = ReturnType<typeof renderConsent>;

beforeEach(() => {
  configureDefaults();
  useHarnessConnectionStore.setState({
    runtimeUrl: "http://127.0.0.1:8457",
    runtimeUrlSource: "native_capture",
    connectionState: "healthy",
    error: null,
  });
  useSessionSelectionStore.setState({
    selectedWorkspaceId: "ws-1",
    activeSessionId: "session-1",
  });
  useSessionDirectoryStore.setState({
    entriesById: {
      "session-1": {
        sessionId: "session-1",
        workspaceId: "ws-1",
        materializedSessionId: "materialized-1",
      },
    } as never,
  });
});

afterEach(cleanup);

describe("useSupportSnapshotConsent Save a copy", () => {
  it("returns bounded not-started results without a bridge or live consent", async () => {
    host.supportSnapshot = null;
    const unavailable = renderConsent();
    expect(await unavailable.result.current.saveCopy()).toEqual({
      state: "not_started",
      reason: "unavailable_or_not_consented",
    });
    unavailable.unmount();

    host.supportSnapshot = bridge;
    const unchecked = renderConsent();
    expect(await unchecked.result.current.saveCopy()).toEqual({
      state: "not_started",
      reason: "unavailable_or_not_consented",
    });
    expect(bridge.beginPreparation).not.toHaveBeenCalled();
    expect(bridge.saveArchive).not.toHaveBeenCalled();
  });

  it("maps preparation failure exactly and never archives", async () => {
    bridge.finishPreparation.mockRejectedValueOnce(new Error("stage_failed"));
    const rendered = renderConsented();

    expect(await act(async () => rendered.result.current.saveCopy())).toEqual({
      state: "preparation_failed",
    });
    expect(bridge.saveArchive).not.toHaveBeenCalled();
    expect(bridge.deleteArtifact).not.toHaveBeenCalled();
    expect(rendered.result.current.isBusy).toBe(false);
  });

  it("keeps one Promise and one action through preparation, archive, and cleanup", async () => {
    const evidence = deferred<typeof INCLUDED_EVIDENCE>();
    const archive = deferred<string | null>();
    const deletion = deferred<void>();
    access.collectResolvedSupportSessionEvidence.mockReturnValue(evidence.promise);
    bridge.saveArchive.mockReturnValue(archive.promise);
    bridge.deleteArtifact.mockReturnValue(deletion.promise);
    const rendered = renderConsented();

    const saving = start(() => rendered.result.current.saveCopy());
    expect(rendered.result.current.saveCopy()).toBe(saving);
    await waitFor(() => expect(rendered.result.current.isPreparing).toBe(true));
    expect(rendered.result.current.isBusy).toBe(true);
    expect(await rendered.result.current.prepare()).toEqual({ state: "blocked", reason: "busy" });
    evidence.resolve(INCLUDED_EVIDENCE);

    await waitFor(() => expect(bridge.saveArchive).toHaveBeenCalledTimes(1));
    expect(rendered.result.current.isPreparing).toBe(false);
    expect(rendered.result.current.isBusy).toBe(true);
    expect(rendered.result.current.saveCopy()).toBe(saving);
    archive.resolve("diagnostics.zip");

    await waitFor(() => expect(bridge.deleteArtifact).toHaveBeenCalledTimes(1));
    expect(rendered.result.current.isBusy).toBe(true);
    expect(rendered.result.current.saveCopy()).toBe(saving);
    deletion.resolve();
    expect(await settle(saving)).toEqual({ state: "saved", cleanup: "confirmed" });
    await waitFor(() => expect(rendered.result.current.isBusy).toBe(false));
    expect(bridge.beginPreparation).toHaveBeenCalledTimes(1);
    expect(bridge.finishPreparation).toHaveBeenCalledTimes(1);
    expect(bridge.saveArchive).toHaveBeenCalledWith({
      artifactId: "artifact-1",
      consentEpoch: bridge.beginPreparation.mock.calls[0]![0].consentEpoch,
    });
    expect(bridge.deleteArtifact).toHaveBeenCalledWith("artifact-1");
  });

  it("rejects Save while Send preparation owns the action slot", async () => {
    const evidence = deferred<typeof INCLUDED_EVIDENCE>();
    access.collectResolvedSupportSessionEvidence.mockReturnValue(evidence.promise);
    const rendered = renderConsented();

    const preparing = start(() => rendered.result.current.prepare());
    await waitFor(() => expect(bridge.beginPreparation).toHaveBeenCalledTimes(1));
    expect(await rendered.result.current.saveCopy()).toEqual({
      state: "not_started",
      reason: "busy",
    });
    expect(await rendered.result.current.prepare()).toEqual({ state: "blocked", reason: "busy" });
    expect(bridge.beginPreparation).toHaveBeenCalledTimes(1);
    evidence.resolve(INCLUDED_EVIDENCE);
    expect(await settle(preparing)).toMatchObject({ state: "prepared" });
    expect(bridge.saveArchive).not.toHaveBeenCalled();
  });

  it("awaits one cached cancellation before returning and latches the job", async () => {
    const { cancellation, evidence, rendered, saving } = await startHeldCancellation();

    act(() => { rendered.result.current.cancel(); rendered.result.current.cancel(); });
    evidence.resolve({ state: "cancelled" });
    await expectCancellationPending(rendered, saving);
    cancellation.resolve();

    expect(await settle(saving)).toEqual({ state: "preparation_cancelled" });
    await waitFor(() => expect(rendered.result.current.snapshotActionsBlocked).toBe(true));
    expect(rendered.result.current.isPreparing).toBe(false);
    expect(rendered.result.current.isBusy).toBe(false);
    await expectLatchBlocksSnapshotWork(rendered, saving);
  });

  it("holds spontaneous evidence cancellation until native settlement", async () => {
    const { cancellation, evidence, rendered, saving } = await startHeldCancellation();

    evidence.resolve({ state: "cancelled" });
    await expectCancellationPending(rendered, saving);
    const [{ cancellationSignal }] = access.collectResolvedSupportSessionEvidence.mock.calls[0]!;
    expect(cancellationSignal.aborted).toBe(false);
    act(() => { rendered.result.current.cancel(); });
    expect(cancellationSignal.aborted).toBe(true);
    expect(bridge.cancelPreparation).toHaveBeenCalledTimes(1);
    cancellation.resolve();

    expect(await settle(saving)).toEqual({ state: "preparation_cancelled" });
    expect(rendered.result.current.snapshotActionsBlocked).toBe(true);
  });

  it("cancels an admission that returns after supersession", async () => {
    const admission = deferred<SupportSnapshotPreparation>();
    const cancellation = deferred<void>();
    bridge.beginPreparation.mockReturnValue(admission.promise);
    bridge.cancelPreparation.mockReturnValue(cancellation.promise);
    const rendered = renderConsented();
    const saving = start(() => rendered.result.current.saveCopy());
    await waitFor(() => expect(bridge.beginPreparation).toHaveBeenCalledTimes(1));

    act(() => { rendered.result.current.cancel(); });
    admission.resolve(PREPARATION);
    await expectCancellationPending(rendered, saving);
    cancellation.resolve();
    expect(await settle(saving)).toEqual({ state: "preparation_cancelled" });
    expect(rendered.result.current.snapshotActionsBlocked).toBe(true);
  });

  it.each(["resolve", "reject"] as const)(
    "awaits cancellation when a pending finish races a %s",
    async (finishOutcome) => {
      const finish = deferred<PreparedSupportSnapshotV1>();
      const cancellation = deferred<void>();
      bridge.finishPreparation.mockReturnValue(finish.promise);
      bridge.cancelPreparation.mockReturnValue(cancellation.promise);
      const rendered = renderConsented();
      const saving = start(() => rendered.result.current.saveCopy());
      await waitFor(() => expect(bridge.finishPreparation).toHaveBeenCalledTimes(1));

      act(() => { rendered.result.current.cancel(); });
      if (finishOutcome === "resolve") finish.resolve(ARTIFACT);
      else finish.reject(new Error("late finish failure"));
      await expectCancellationPending(rendered, saving);
      cancellation.resolve();

      expect(await settle(saving)).toEqual({ state: "preparation_cancelled" });
      expect(rendered.result.current.snapshotActionsBlocked).toBe(true);
    },
  );

  it("awaits cancellation after unmount during admitted preparation", async () => {
    const { cancellation, evidence, rendered, saving } = await startHeldCancellation();

    rendered.unmount();
    evidence.resolve({ state: "cancelled" });
    await waitFor(() => expect(bridge.cancelPreparation).toHaveBeenCalledTimes(1));
    let settled = false;
    void saving.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    cancellation.resolve();
    expect(await settle(saving)).toEqual({ state: "preparation_cancelled" });
    expect(bridge.cancelPreparation).toHaveBeenCalledTimes(1);
  });

  it("holds and consumes rejected cancellation without exposing a raw error", async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", listener);
    try {
      const { cancellation, evidence, rendered, saving } = await startHeldCancellation();
      act(() => { rendered.result.current.cancel(); });
      evidence.resolve({ state: "cancelled" });
      await expectCancellationPending(rendered, saving);
      cancellation.reject(new Error("raw cancellation failure"));

      expect(await settle(saving)).toEqual({ state: "preparation_cancelled" });
      expect(rendered.result.current.error).toBeNull();
      expect(rendered.result.current.snapshotActionsBlocked).toBe(true);
      expect(rendered.result.current.isPreparing).toBe(false);
      expect(rendered.result.current.isBusy).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });

  it("keeps Save identity through supersession and suppresses stale errors", async () => {
    const archive = deferred<string | null>();
    bridge.saveArchive.mockReturnValue(archive.promise);
    const rendered = renderConsented();
    const saving = start(() => rendered.result.current.saveCopy());
    await waitFor(() => expect(bridge.saveArchive).toHaveBeenCalledTimes(1));

    act(() => { rendered.result.current.setScope("recent_activity"); });
    expect(rendered.result.current.saveCopy()).toBe(saving);
    act(() => { rendered.result.current.setConsent(false); });
    expect(rendered.result.current.saveCopy()).toBe(saving);
    archive.reject(new Error("raw archive failure"));
    expect(await settle(saving)).toEqual({ state: "save_failed", cleanup: "confirmed" });
    expect(bridge.deleteArtifact).toHaveBeenCalledWith("artifact-1");
    expect(rendered.result.current.error).toBeNull();

    rendered.unmount();
    configureDefaults();
    bridge.saveArchive.mockRejectedValueOnce(new Error("current archive failure"));
    const current = renderConsented();
    expect(await settle(start(() => current.result.current.saveCopy()))).toEqual({
      state: "save_failed",
      cleanup: "confirmed",
    });
    expect(current.result.current.error).toBe(
      "Couldn't save a copy of the diagnostic snapshot.",
    );
  });

  it("finishes exact cleanup after unmount", async () => {
    const deletion = deferred<void>();
    bridge.deleteArtifact.mockReturnValue(deletion.promise);
    const rendered = renderConsented();
    const saving = start(() => rendered.result.current.saveCopy());
    await waitFor(() => expect(bridge.deleteArtifact).toHaveBeenCalledWith("artifact-1"));

    rendered.unmount();
    deletion.resolve();
    expect(await settle(saving)).toEqual({ state: "saved", cleanup: "confirmed" });
    expect(bridge.deleteArtifact).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["saved", "diagnostics.zip", { state: "saved", cleanup: "unconfirmed" }],
    ["cancelled", null, { state: "cancelled", cleanup: "unconfirmed" }],
    ["save_failed", new Error("archive failed"), {
      state: "save_failed",
      cleanup: "unconfirmed",
    }],
  ] as const)("latches every %s / unconfirmed result", async (_name, archive, expected) => {
    if (archive instanceof Error) bridge.saveArchive.mockRejectedValue(archive);
    else bridge.saveArchive.mockResolvedValue(archive);
    bridge.deleteArtifact.mockRejectedValue(new Error("cleanup failed"));
    const rendered = renderConsented();
    const first = start(() => rendered.result.current.saveCopy());

    expect(await settle(first)).toEqual(expected);
    expect(rendered.result.current.isBusy).toBe(false);
    expect(rendered.result.current.snapshotActionsBlocked).toBe(true);
    await expectLatchBlocksSnapshotWork(rendered, first);
  });

  it("lets a newly opened modal use its own fresh latch", async () => {
    bridge.deleteArtifact.mockRejectedValueOnce(new Error("cleanup failed"));
    const first = renderConsented();
    await settle(start(() => first.result.current.saveCopy()));
    expect(first.result.current.snapshotActionsBlocked).toBe(true);
    first.unmount();

    configureDefaults();
    const reopened = renderConsented();
    expect(reopened.result.current.snapshotActionsBlocked).toBe(false);
    expect(await settle(start(() => reopened.result.current.saveCopy()))).toEqual({
      state: "saved",
      cleanup: "confirmed",
    });
    expect(bridge.beginPreparation).toHaveBeenCalledTimes(1);
  });

  it.each(["preparation_failed", "saved", "cancelled", "save_failed"] as const)(
    "releases admission after retryable %s",
    async (terminal) => {
      if (terminal === "preparation_failed") {
        bridge.finishPreparation.mockRejectedValueOnce(new Error("stage failed"));
      } else if (terminal === "cancelled") {
        bridge.saveArchive.mockResolvedValueOnce(null);
      } else if (terminal === "save_failed") {
        bridge.saveArchive.mockRejectedValueOnce(new Error("archive failed"));
      }
      const rendered = renderConsented();
      await settle(start(() => rendered.result.current.saveCopy()));
      expect(rendered.result.current.isBusy).toBe(false);

      const next = await settle(start(() => rendered.result.current.prepare()));
      expect(next).toMatchObject({ state: "prepared" });
      expect(bridge.beginPreparation).toHaveBeenCalledTimes(2);
      expect(bridge.finishPreparation).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["saved", "save_failed"] as const)(
    "uses a distinct Promise and full second sequence after %s",
    async (firstOutcome) => {
      if (firstOutcome === "save_failed") {
        bridge.saveArchive.mockRejectedValueOnce(new Error("archive failed"));
      }
      const rendered = renderConsented();
      const first = start(() => rendered.result.current.saveCopy());
      const firstResult = await settle(first);
      expect(firstResult.state).toBe(firstOutcome);
      expect(rendered.result.current.isBusy).toBe(false);
      if (firstOutcome === "save_failed") {
        expect(rendered.result.current.error).toBe(
          "Couldn't save a copy of the diagnostic snapshot.",
        );
      }

      const second = start(() => rendered.result.current.saveCopy());
      expect(second).not.toBe(first);
      expect(await settle(second)).toEqual({ state: "saved", cleanup: "confirmed" });
      expect(bridge.beginPreparation).toHaveBeenCalledTimes(2);
      expect(bridge.finishPreparation).toHaveBeenCalledTimes(2);
      expect(bridge.saveArchive).toHaveBeenCalledTimes(2);
      expect(bridge.deleteArtifact).toHaveBeenCalledTimes(2);
    },
  );
});

async function expectCancellationPending(rendered: RenderedConsent, saving: Promise<unknown>) {
  await waitFor(() => expect(bridge.cancelPreparation).toHaveBeenCalledTimes(1));
  let settled = false;
  void saving.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(rendered.result.current.isPreparing).toBe(true);
  expect(rendered.result.current.isBusy).toBe(true);
  expect(rendered.result.current.saveCopy()).toBe(saving);
  expect(await rendered.result.current.prepare()).toEqual({ state: "blocked", reason: "busy" });
  expect(bridge.saveArchive).not.toHaveBeenCalled();
  expect(bridge.deleteArtifact).not.toHaveBeenCalled();
}

async function expectLatchBlocksSnapshotWork(
  rendered: RenderedConsent,
  previousSave: Promise<unknown>,
) {
  const before = snapshotCallCounts();
  const later = rendered.result.current.saveCopy();
  expect(later).not.toBe(previousSave);
  expect(await later).toEqual(CLEANUP_NOT_STARTED);
  expect(await rendered.result.current.prepare()).toEqual(CLEANUP_BLOCKED);
  act(() => { rendered.result.current.setConsent(false); });
  expect(rendered.result.current.snapshotActionsBlocked).toBe(true);
  expect(await rendered.result.current.prepare()).toEqual({ state: "none" });
  act(() => { rendered.result.current.setConsent(true); });
  act(() => { rendered.result.current.setScope("recent_activity"); });
  expect(await rendered.result.current.saveCopy()).toEqual(CLEANUP_NOT_STARTED);
  expect(snapshotCallCounts()).toEqual(before);
}

function snapshotCallCounts() {
  return [
    access.resolveSupportSnapshotAccess,
    access.collectResolvedSupportSessionEvidence,
    ...Object.values(bridge),
  ].map((operation) => operation.mock.calls.length);
}

async function startHeldCancellation() {
  const evidence = deferred<{ state: "cancelled" }>();
  const cancellation = deferred<void>();
  access.collectResolvedSupportSessionEvidence.mockReturnValue(evidence.promise);
  bridge.cancelPreparation.mockReturnValue(cancellation.promise);
  const rendered = renderConsented();
  const saving = start(() => rendered.result.current.saveCopy());
  await waitFor(() => expect(bridge.beginPreparation).toHaveBeenCalledTimes(1));
  return { cancellation, evidence, rendered, saving };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function start<T>(action: () => Promise<T>): Promise<T> {
  let promise!: Promise<T>;
  act(() => { promise = action(); });
  return promise;
}

async function settle<T>(promise: Promise<T>): Promise<T> {
  let value!: T;
  await act(async () => { value = await promise; });
  return value;
}
