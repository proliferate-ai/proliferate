/* @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  saveArchive: vi.fn(async () => "diagnostics.zip"),
  readArtifact: vi.fn(),
  deleteArtifact: vi.fn(async () => {}),
  reconcileArtifacts: vi.fn(),
  beginSubmission: vi.fn(),
  finishSubmission: vi.fn(),
}));

const host = vi.hoisted(() => ({
  supportSnapshot: bridge as unknown as null | typeof bridge,
}));

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

function renderConsent() {
  return renderHook(() =>
    useSupportSnapshotConsent({
      clientJobId: "job-1",
      reportOpenedAt: "2026-08-13T00:00:00.000Z",
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  host.supportSnapshot = bridge;
  bridge.beginPreparation.mockResolvedValue(PREPARATION);
  bridge.finishPreparation.mockResolvedValue(ARTIFACT);
  access.resolveSupportSnapshotAccess.mockResolvedValue(resolvedAccess());
  access.collectResolvedSupportSessionEvidence.mockResolvedValue({
    state: "included",
    sessionEvidenceJson: "{}",
    sessionCollection: {
      state: "included",
      workspaceId: "ws-1",
      anyharnessWorkspaceId: "ws-1",
      selectedSessions: 1,
      sessionIncludedBytes: 10,
      eventIncludedBytes: 10,
      rawNotificationIncludedBytes: 0,
      limitUncertainEndpoints: 0,
    },
  });
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

describe("useSupportSnapshotConsent", () => {
  it("starts unchecked and stages nothing while the modal is merely open", () => {
    const rendered = renderConsent();

    expect(rendered.result.current.available).toBe(true);
    expect(rendered.result.current.consent).toBe(false);
    expect(bridge.beginPreparation).not.toHaveBeenCalled();
    expect(bridge.finishPreparation).not.toHaveBeenCalled();
    expect(access.resolveSupportSnapshotAccess).not.toHaveBeenCalled();
  });

  it("reports no snapshot and touches nothing native without consent", async () => {
    const rendered = renderConsent();

    const result = await act(async () => rendered.result.current.prepare());

    expect(result).toEqual({ state: "none" });
    expect(bridge.beginPreparation).not.toHaveBeenCalled();
  });

  it("reports unavailable and renders nothing on a host without the coordinator", async () => {
    host.supportSnapshot = null;
    const rendered = renderConsent();

    act(() => { rendered.result.current.setConsent(true); });
    const result = await act(async () => rendered.result.current.prepare());

    expect(rendered.result.current.available).toBe(false);
    expect(result).toEqual({ state: "none" });
  });

  it("prepares an exact artifact through the bridge on explicit send", async () => {
    const rendered = renderConsent();

    act(() => { rendered.result.current.setConsent(true); });
    const result = await act(async () => rendered.result.current.prepare());

    expect(bridge.beginPreparation).toHaveBeenCalledTimes(1);
    const beginInput = bridge.beginPreparation.mock.calls[0]![0];
    expect(beginInput).toMatchObject({
      clientJobId: "job-1",
      reportOpenedAt: "2026-08-13T00:00:00.000Z",
      consent: {
        version: 1,
        disclosureVersion: "desktop_support_snapshot_customer_content_v1",
        selection: { kind: "active_session" },
      },
    });
    expect(bridge.finishPreparation).toHaveBeenCalledWith({
      preparationId: "prep-1",
      consentEpoch: beginInput.consentEpoch,
      sessionEvidenceJson: "{}",
      sessionCollection: expect.objectContaining({ state: "included" }),
    });
    expect(result).toMatchObject({
      state: "prepared",
      intent: { kind: "prepared", artifact: { artifactId: "artifact-1" } },
    });
  });

  it("defaults to recent activity when the active session mapping is not exact", () => {
    useSessionDirectoryStore.setState({ entriesById: {} as never });
    const rendered = renderConsent();

    act(() => { rendered.result.current.setConsent(true); });

    expect(rendered.result.current.activeSessionAvailable).toBe(false);
    expect(rendered.result.current.scope).toBe("recent_activity");
  });

  it("never substitutes a cloud workspace for the bundled-local binding", () => {
    useSessionSelectionStore.setState({ selectedWorkspaceId: "cloud:remote-1" });
    useSessionDirectoryStore.setState({
      entriesById: {
        "session-1": {
          sessionId: "session-1",
          workspaceId: "cloud:remote-1",
          materializedSessionId: "materialized-1",
        },
      } as never,
    });
    const rendered = renderConsent();

    act(() => { rendered.result.current.setConsent(true); });

    expect(rendered.result.current.activeSessionAvailable).toBe(false);
    expect(rendered.result.current.scope).toBe("recent_activity");
  });

  it("supersedes the consent epoch on a scope change", async () => {
    const rendered = renderConsent();

    act(() => { rendered.result.current.setConsent(true); });
    await act(async () => rendered.result.current.prepare());
    const firstEpoch = bridge.beginPreparation.mock.calls[0]![0].consentEpoch;

    act(() => { rendered.result.current.setScope("recent_activity"); });
    await act(async () => rendered.result.current.prepare());
    const secondEpoch = bridge.beginPreparation.mock.calls[1]![0].consentEpoch;

    expect(rendered.result.current.scope).toBe("recent_activity");
    expect(secondEpoch).not.toBe(firstEpoch);
  });

  it("supersedes the epoch and drops consent when the binding changes", async () => {
    const rendered = renderConsent();

    act(() => { rendered.result.current.setConsent(true); });
    expect(rendered.result.current.consent).toBe(true);

    act(() => {
      useSessionSelectionStore.setState({ selectedWorkspaceId: "ws-2" });
    });

    await waitFor(() => expect(rendered.result.current.consent).toBe(false));
    expect(bridge.beginPreparation).not.toHaveBeenCalled();
  });

  it("surfaces a fatal preparation failure instead of downgrading intent", async () => {
    bridge.finishPreparation.mockRejectedValueOnce(new Error("stage_failed"));
    const rendered = renderConsent();

    act(() => { rendered.result.current.setConsent(true); });
    const failed = await act(async () => rendered.result.current.prepare());

    expect(failed).toEqual({ state: "failed" });
    expect(rendered.result.current.error).not.toBeNull();
    expect(rendered.result.current.consent).toBe(true);

    // Retry on the same live consent succeeds and clears the message.
    const retried = await act(async () => rendered.result.current.prepare());
    expect(retried).toMatchObject({ state: "prepared" });
    expect(rendered.result.current.error).toBeNull();
  });

  it("fails closed when the chosen scope cannot be bound", async () => {
    access.resolveSupportSnapshotAccess.mockResolvedValue({
      state: "ineligible",
      reason: "runtime_mismatch",
    });
    const rendered = renderConsent();

    act(() => { rendered.result.current.setConsent(true); });
    const result = await act(async () => rendered.result.current.prepare());

    expect(result).toEqual({ state: "failed" });
    expect(bridge.beginPreparation).not.toHaveBeenCalled();
  });

});
