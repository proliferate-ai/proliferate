import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupportSnapshotPreparation } from "@proliferate/product-client/host/desktop-bridge";
import type {
  BundledLocalSupportConnection,
} from "#product/lib/domain/support/support-snapshot-access-contract";
import type {
  MeasuredSupportWindow,
  SupportSessionEvidenceClient,
  SupportWindowMetaV1,
} from "#product/lib/domain/support/support-session-contract";
import {
  collectSupportSessionEvidence,
  collectResolvedSupportSessionEvidence,
  type CollectSupportSessionEvidenceInput,
} from "#product/lib/workflows/support/support-session-evidence";

const CAPTURED_AT = "2026-08-12T00:00:00.000Z";
const FROM = "2026-08-11T23:45:00.000Z";

const preparation: SupportSnapshotPreparation = {
  preparationId: "preparation-1",
  preparationOperationId: "operation-1",
  capturedAt: CAPTURED_AT,
  window: { sourceTimeFrom: FROM, sourceTimeTo: CAPTURED_AT },
};

const connection = {
  runtimeUrl: "http://127.0.0.1:4477",
  anyharnessWorkspaceId: "runtime-workspace-1",
} as BundledLocalSupportConnection;

function meta(
  presentationOrder: SupportWindowMetaV1["presentationOrder"],
  itemLimit: number,
  responseByteLimit: number,
  returnedItems: number,
  completeness: "complete" | "limit_uncertain" = "complete",
): SupportWindowMetaV1 {
  return {
    schemaVersion: 1,
    selection: "newest_matching",
    presentationOrder,
    itemLimit,
    responseByteLimit,
    returnedItems,
    omittedOversizedItems: 0,
    completeness,
  };
}

function measured(
  items: unknown[],
  window: SupportWindowMetaV1,
  responseBytes: number,
): MeasuredSupportWindow {
  return { value: { window, items }, responseBytes };
}

function session(id: string, updatedAt = "2026-08-11T23:59:00.000Z") {
  return {
    id,
    workspaceId: "runtime-workspace-1",
    updatedAt,
    title: `Session ${id}`,
    liveConfig: { modelId: "must-not-be-collected" },
  };
}

function event(
  seq: number,
  timestamp = "2026-08-11T23:59:30.000Z",
  sessionId = "runtime-session-1",
) {
  return { seq, timestamp, sessionId, event: { type: "output", text: "kept" } };
}

function raw(
  seq: number,
  timestamp = "2026-08-11T23:59:45.000Z",
  sessionId = "runtime-session-1",
) {
  return { seq, timestamp, sessionId, notificationKind: "output", notification: { text: "raw" } };
}

function client(overrides: Partial<SupportSessionEvidenceClient> = {}): SupportSessionEvidenceClient {
  return {
    listSupportWindow: vi.fn().mockResolvedValue(measured(
      [session("runtime-session-1")],
      meta("updated_desc_id_asc", 1, 1_048_576, 1),
      101,
    )),
    listEventsSupportWindow: vi.fn().mockResolvedValue(measured(
      [event(1)],
      meta("seq_asc", 200, 4_194_304, 1),
      202,
    )),
    listRawNotificationsSupportWindow: vi.fn().mockResolvedValue(measured(
      [raw(2)],
      meta("seq_asc", 100, 2_097_152, 1),
      303,
    )),
    ...overrides,
  };
}

function activeInput(
  evidenceClient: SupportSessionEvidenceClient,
): CollectSupportSessionEvidenceInput {
  return {
    preparation,
    connection,
    client: evidenceClient,
    selection: {
      kind: "active_session",
      workspace: {
        kind: "bundled_local",
        workspaceId: "workspace-1",
        anyharnessWorkspaceId: "runtime-workspace-1",
      },
      uiSessionId: "ui-session-1",
      materializedSessionId: "runtime-session-1",
    },
  };
}

function recentInput(
  evidenceClient: SupportSessionEvidenceClient,
): CollectSupportSessionEvidenceInput {
  return {
    ...activeInput(evidenceClient),
    selection: {
      kind: "recent_activity",
      workspace: {
        kind: "bundled_local",
        workspaceId: "workspace-1",
        anyharnessWorkspaceId: "runtime-workspace-1",
      },
    },
  };
}

describe("support session evidence collection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(CAPTURED_AT));
  });

  afterEach(() => vi.useRealTimers());

  it("pins the active session and accounts exact response bytes", async () => {
    const evidenceClient = client();
    const result = await collectSupportSessionEvidence(activeInput(evidenceClient));
    expect(evidenceClient.listSupportWindow).toHaveBeenCalledWith(
      "runtime-workspace-1",
      expect.objectContaining({ mode: "exact", sessionId: "runtime-session-1", limit: 1 }),
    );
    expect(result).toMatchObject({
      state: "included",
      sessionCollection: {
        selectedSessions: 1,
        sessionIncludedBytes: 101,
        eventIncludedBytes: 202,
        rawNotificationIncludedBytes: 303,
      },
      envelope: { totalReadBytes: 606 },
    });
    if (result.state === "included") {
      expect(JSON.parse(result.sessionEvidenceJson)).toEqual(result.envelope);
      expect(new TextEncoder().encode(result.sessionEvidenceJson).length).toBeLessThanOrEqual(
        8_388_608,
      );
      expect(JSON.parse(result.sessionEvidenceJson).sessions[0].events.payload)
        .toEqual([{ index: 0, value: event(1) }]);
      expect(JSON.parse(result.sessionEvidenceJson).sessions[0].summary.payload)
        .not.toHaveProperty("liveConfig");
      const calls = [
        vi.mocked(evidenceClient.listSupportWindow).mock.calls[0][1].request.signal,
        vi.mocked(evidenceClient.listEventsSupportWindow).mock.calls[0][1].request.signal,
        vi.mocked(evidenceClient.listRawNotificationsSupportWindow).mock.calls[0][1].request.signal,
      ];
      expect(calls[1]).toBe(calls[0]);
      expect(calls[2]).toBe(calls[0]);
    }
  });

  it("keeps an active shell when the exact summary window is limit-uncertain and empty", async () => {
    const result = await collectSupportSessionEvidence(activeInput(client({
      listSupportWindow: vi.fn().mockResolvedValue(measured(
        [],
        meta("updated_desc_id_asc", 1, 1_048_576, 0, "limit_uncertain"),
        81,
      )),
    })));
    expect(result).toMatchObject({
      state: "included",
      envelope: {
        totalReadBytes: 586,
        sessions: [{
          sessionId: "runtime-session-1",
          summary: {
            state: "limit_uncertain",
            reason: "session_window_limit_uncertain",
            includedBytes: 0,
            window: { completeness: "limit_uncertain", returnedItems: 0 },
          },
          events: { state: "included" },
          rawNotifications: { state: "included" },
        }],
      },
    });
  });

  it("keeps active events/raw when the summary endpoint is unavailable", async () => {
    const result = await collectSupportSessionEvidence(activeInput(client({
      listSupportWindow: vi.fn().mockRejectedValue(new Error("missing")),
    })));
    expect(result).toMatchObject({
      state: "included",
      envelope: {
        sessions: [{
          summary: { state: "omitted", reason: "session_unavailable", includedBytes: 0 },
          events: { state: "included" },
          rawNotifications: { state: "included" },
        }],
      },
    });
  });

  it("retains partial independent endpoint failures", async () => {
    const result = await collectSupportSessionEvidence(activeInput(client({
      listEventsSupportWindow: vi.fn().mockRejectedValue(new Error("events unavailable")),
    })));
    expect(result).toMatchObject({
      state: "included",
      envelope: {
        totalReadBytes: 404,
        sessions: [{
          events: {
            state: "omitted",
            reason: "session_unavailable",
            includedBytes: 0,
            payload: [],
          },
          rawNotifications: { state: "included", includedBytes: 303 },
        }],
      },
    });
  });

  it("shares one ten-thousand-value budget across all endpoints in a session", async () => {
    const events = Array.from({ length: 38 }, (_, index) => ({
      ...event(index + 1),
      values: new Array(index === 37 ? 218 : 256).fill(null),
    }));
    const result = await collectSupportSessionEvidence(activeInput(client({
      listEventsSupportWindow: vi.fn().mockResolvedValue(measured(
        events,
        meta("seq_asc", 200, 4_194_304, events.length),
        202,
      )),
    })));
    expect(result).toMatchObject({
      state: "included",
      envelope: {
        totalReadBytes: 606,
        sessions: [{
          summary: { state: "included" },
          events: { state: "included" },
          rawNotifications: {
            state: "omitted",
            reason: "session_invalid",
            includedBytes: 0,
          },
        }],
      },
    });
  });

  it("filters out-of-window and malformed seq values while preserving server metadata", async () => {
    const items = [
      event(3),
      event(Number.NaN),
      event(4, "2026-08-12T00:00:01.000Z"),
      event(3),
      event(5, "2026-08-11T23:59:31+00:00"),
      event(6, "2026-08-11T23:44:59.999Z"),
      { timestamp: "2026-08-11T23:59:31.000Z", sessionId: "runtime-session-1" },
      event(7),
    ];
    const result = await collectSupportSessionEvidence(activeInput(client({
      listEventsSupportWindow: vi.fn().mockResolvedValue(measured(
        items,
        meta("seq_asc", 200, 4_194_304, items.length),
        777,
      )),
    })));
    expect(result).toMatchObject({
      state: "included",
      envelope: {
        sessions: [{
          events: {
            includedBytes: 777,
            window: { returnedItems: 8 },
            payload: [
              { index: 0, value: { seq: 3 } },
              { index: 1, value: { seq: 7 } },
            ],
          },
        }],
      },
    });
  });

  it("keeps exact zero-session response bytes only in totalReadBytes", async () => {
    const result = await collectSupportSessionEvidence(recentInput(client({
      listSupportWindow: vi.fn().mockResolvedValue(measured(
        [],
        meta("updated_desc_id_asc", 3, 1_048_576, 0),
        41,
      )),
    })));
    expect(result).toMatchObject({
      state: "included",
      sessionCollection: { selectedSessions: 0, sessionIncludedBytes: 0 },
      envelope: { totalReadBytes: 41, sessions: [] },
    });
  });

  it("rejects malformed recent session order and source-time bounds", async () => {
    for (const sessions of [
      [session("b"), session("a")],
      [session("a", "2026-08-11T23:44:59.999Z")],
      [session("a", "2026-08-11T23:59:00+00:00")],
    ]) {
      const result = await collectSupportSessionEvidence(recentInput(client({
        listSupportWindow: vi.fn().mockResolvedValue(measured(
          sessions,
          meta("updated_desc_id_asc", 3, 1_048_576, sessions.length),
          41,
        )),
      })));
      expect(result).toEqual({
        state: "omitted",
        sessionEvidenceJson: null,
        sessionCollection: { state: "omitted", reason: "session_invalid" },
      });
    }
  });

  it("makes zero AnyHarness calls for a recent selection with no bundled-local workspace", async () => {
    const evidenceClient = client();
    const result = await collectResolvedSupportSessionEvidence({
      preparation,
      access: {
        state: "none",
        binding: { kind: "none", reason: "no_selected_bundled_local_workspace" },
      },
      client: evidenceClient,
    });
    expect(result).toEqual({
      state: "omitted",
      sessionEvidenceJson: null,
      sessionCollection: {
        state: "omitted",
        reason: "no_selected_bundled_local_workspace",
      },
    });
    expect(evidenceClient.listSupportWindow).not.toHaveBeenCalled();
    expect(evidenceClient.listEventsSupportWindow).not.toHaveBeenCalled();
    expect(evidenceClient.listRawNotificationsSupportWindow).not.toHaveBeenCalled();
  });

  it("honors cancellation before a zero-workspace recent collection", async () => {
    const controller = new AbortController();
    controller.abort();
    const evidenceClient = client();
    await expect(collectResolvedSupportSessionEvidence({
      preparation,
      access: {
        state: "none",
        binding: { kind: "none", reason: "no_selected_bundled_local_workspace" },
      },
      client: evidenceClient,
      cancellationSignal: controller.signal,
    })).resolves.toEqual({ state: "cancelled" });
    expect(evidenceClient.listSupportWindow).not.toHaveBeenCalled();
  });

  it("cancels an active stale binding before any AnyHarness call", async () => {
    const evidenceClient = client();
    await expect(collectResolvedSupportSessionEvidence({
      preparation,
      access: { state: "ineligible", reason: "session_mapping_stale" },
      client: evidenceClient,
    })).resolves.toEqual({ state: "cancelled" });
    expect(evidenceClient.listSupportWindow).not.toHaveBeenCalled();
    expect(evidenceClient.listEventsSupportWindow).not.toHaveBeenCalled();
    expect(evidenceClient.listRawNotificationsSupportWindow).not.toHaveBeenCalled();
  });

  it("counts a recent session-list response once across three summaries", async () => {
    const sessions = [session("a"), session("b"), session("c")].map((value, index) => ({
      ...value,
      updatedAt: `2026-08-11T23:${59 - index}:00.000Z`,
    }));
    const result = await collectSupportSessionEvidence(recentInput(client({
      listSupportWindow: vi.fn().mockResolvedValue(measured(
        sessions,
        meta("updated_desc_id_asc", 3, 1_048_576, 3, "limit_uncertain"),
        99,
      )),
    })));
    expect(result).toMatchObject({
      state: "included",
      sessionCollection: {
        selectedSessions: 3,
        sessionIncludedBytes: 99,
        limitUncertainEndpoints: 1,
      },
      envelope: {
        sessions: [
          { index: 0, summary: { state: "limit_uncertain", includedBytes: 99 } },
          { index: 1, summary: { state: "limit_uncertain", includedBytes: 0 } },
          { index: 2, summary: { state: "limit_uncertain", includedBytes: 0 } },
        ],
      },
    });
  });

  it.each([0, 1] as const)(
    "enforces the exact 8 MiB total response boundary plus %i byte",
    async (extraByte) => {
      const sessions = [session("a"), session("b"), session("c")].map((value, index) => ({
        ...value,
        updatedAt: `2026-08-11T23:${59 - index}:00.000Z`,
      }));
      const eventBytes: Record<string, number> = {
        a: 4_194_304,
        b: 1_048_573 + extraByte,
        c: 1,
      };
      const rawBytes: Record<string, number> = { a: 2_097_152, b: 1, c: 1 };
      const evidenceClient = client({
        listSupportWindow: vi.fn().mockResolvedValue(measured(
          sessions,
          meta("updated_desc_id_asc", 3, 1_048_576, 3),
          1_048_576,
        )),
        listEventsSupportWindow: vi.fn().mockImplementation(async (sessionId: string) => measured(
          [event(1, "2026-08-11T23:59:30.000Z", sessionId)],
          meta("seq_asc", 200, 4_194_304, 1),
          eventBytes[sessionId],
        )),
        listRawNotificationsSupportWindow: vi.fn().mockImplementation(async (sessionId: string) => measured(
          [raw(2, "2026-08-11T23:59:45.000Z", sessionId)],
          meta("seq_asc", 100, 2_097_152, 1),
          rawBytes[sessionId],
        )),
      });
      const result = await collectSupportSessionEvidence(recentInput(evidenceClient));
      if (extraByte === 0) {
        expect(result).toMatchObject({
          state: "included",
          envelope: { totalReadBytes: 8_388_608 },
          sessionCollection: {
            sessionIncludedBytes: 1_048_576,
            eventIncludedBytes: 5_242_878,
            rawNotificationIncludedBytes: 2_097_154,
          },
        });
      } else {
        expect(result).toEqual({
          state: "omitted",
          sessionEvidenceJson: null,
          sessionCollection: { state: "omitted", reason: "session_invalid" },
        });
      }
    },
  );

  it("enforces a real shared five-second deadline even when calls ignore AbortSignal", async () => {
    const never = new Promise<MeasuredSupportWindow>(() => undefined);
    const promise = collectSupportSessionEvidence(activeInput(client({
      listSupportWindow: vi.fn().mockReturnValue(never),
      listEventsSupportWindow: vi.fn().mockReturnValue(never),
      listRawNotificationsSupportWindow: vi.fn().mockReturnValue(never),
    })));
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(promise).resolves.toMatchObject({
      state: "included",
      envelope: {
        sessions: [{
          summary: { reason: "session_timeout" },
          events: { reason: "session_timeout" },
          rawNotifications: { reason: "session_timeout" },
        }],
      },
    });
  });

  it("cancels a superseded consent/selection epoch", async () => {
    const controller = new AbortController();
    const evidenceClient = client({
      listSupportWindow: vi.fn().mockImplementation(async (
        _workspace: string,
        options: Parameters<SupportSessionEvidenceClient["listSupportWindow"]>[1],
      ) => {
        controller.abort();
        throw options.request.signal.reason;
      }),
    });
    await expect(collectSupportSessionEvidence({
      ...activeInput(evidenceClient),
      cancellationSignal: controller.signal,
    })).resolves.toEqual({ state: "cancelled" });
  });

  it("does not fan out recent endpoint calls after the selection epoch changes", async () => {
    let current = true;
    const evidenceClient = client({
      listSupportWindow: vi.fn().mockImplementation(async () => {
        current = false;
        return measured(
          [session("runtime-session-1")],
          meta("updated_desc_id_asc", 3, 1_048_576, 1),
          101,
        );
      }),
    });
    await expect(collectSupportSessionEvidence({
      ...recentInput(evidenceClient),
      isSelectionCurrent: () => current,
    })).resolves.toEqual({ state: "cancelled" });
    expect(evidenceClient.listEventsSupportWindow).not.toHaveBeenCalled();
    expect(evidenceClient.listRawNotificationsSupportWindow).not.toHaveBeenCalled();
  });

  it("closes malformed/trapped endpoint values without losing measured read bytes", async () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const result = await collectSupportSessionEvidence(activeInput(client({
      listEventsSupportWindow: vi.fn().mockResolvedValue({
        value: revoked.proxy,
        responseBytes: 88,
      }),
    })));
    expect(result).toMatchObject({
      state: "included",
      envelope: {
        totalReadBytes: 492,
        sessions: [{ events: { state: "omitted", reason: "session_invalid" } }],
      },
    });
  });
});
