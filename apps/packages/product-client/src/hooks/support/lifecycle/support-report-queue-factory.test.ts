import { describe, expect, it, vi } from "vitest";
import type {
  DesktopDiagnosticsBridge,
  DesktopSupportSnapshotBridge,
} from "@proliferate/product-client/host/desktop-bridge";
import type { ProductStorage } from "#product/host/product-host";

import { createCapabilityAwareSupportReportQueue } from "./support-report-queue-factory";
import { SUPPORT_QUEUE_LEGACY_KEY } from "./support-report-queue-migration";
import {
  SUPPORT_QUEUE_PENDING_KEY,
  SUPPORT_QUEUE_PRIMARY_KEY,
} from "./support-report-queue-storage";

class TraceStorage implements ProductStorage {
  readonly trace: string[] = [];

  async getItem(key: string): Promise<string | null> {
    this.trace.push(`get:${key}`);
    return null;
  }

  async setItem(key: string): Promise<void> {
    this.trace.push(`set:${key}`);
  }

  async removeItem(key: string): Promise<void> {
    this.trace.push(`remove:${key}`);
  }
}

describe("support queue capability split", () => {
  it("hydrates only V1 and never calls native snapshot methods when capability is null", async () => {
    const storage = new TraceStorage();
    const diagnostics = diagnosticsBridge(null);
    const queue = createCapabilityAwareSupportReportQueue({
      storage,
      diagnostics,
      supportSnapshot: null,
      callbacks: callbacks(),
    });

    await queue.initialize();

    expect(storage.trace).toEqual([`get:${SUPPORT_QUEUE_LEGACY_KEY}`]);
    expect(diagnostics.deleteAttachment).not.toHaveBeenCalled();
  });

  it("hydrates V2 and reconciles only after all queue reads when capability exists", async () => {
    const storage = new TraceStorage();
    const supportSnapshot = snapshotBridge(storage.trace);
    const queue = createCapabilityAwareSupportReportQueue({
      storage,
      diagnostics: diagnosticsBridge(supportSnapshot),
      supportSnapshot,
      callbacks: callbacks(),
    });

    await queue.initialize();

    expect(storage.trace).toEqual([
      `get:${SUPPORT_QUEUE_LEGACY_KEY}`,
      `get:${SUPPORT_QUEUE_PRIMARY_KEY}`,
      `get:${SUPPORT_QUEUE_PENDING_KEY}`,
      `get:${SUPPORT_QUEUE_PRIMARY_KEY}`,
      `get:${SUPPORT_QUEUE_PENDING_KEY}`,
      "native:reconcile",
    ]);
  });
});

function diagnosticsBridge(
  supportSnapshot: DesktopSupportSnapshotBridge | null,
): DesktopDiagnosticsBridge {
  return {
    reportRenderError: vi.fn(async () => false),
    saveJson: vi.fn(async () => null),
    stageAttachment: vi.fn(async () => null),
    readAttachment: vi.fn(async () => ""),
    deleteAttachment: vi.fn(async () => {}),
    supportSnapshot,
  };
}

function snapshotBridge(trace: string[]): DesktopSupportSnapshotBridge {
  return {
    beginPreparation: vi.fn(),
    finishPreparation: vi.fn(),
    cancelPreparation: vi.fn(),
    saveArchive: vi.fn(),
    readArtifact: vi.fn(),
    deleteArtifact: vi.fn(),
    reconcileArtifacts: vi.fn(async () => {
      trace.push("native:reconcile");
      return [];
    }),
    beginSubmission: vi.fn(),
    finishSubmission: vi.fn(),
  };
}

function callbacks() {
  return {
    onControllerError: vi.fn(),
    onCleanupError: vi.fn(),
    onSnapshotUnavailable: vi.fn(),
  };
}
