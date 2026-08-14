import type {
  DesktopDiagnosticsBridge,
  DesktopSupportSnapshotBridge,
} from "@proliferate/product-client/host/desktop-bridge";
import type { ProductStorage } from "#product/host/product-host";

import { PackagedSupportReportQueueController } from "./support-report-queue-controller";
import type {
  SupportReportQueueCallbacks,
  SupportReportQueueRuntime,
} from "./support-report-queue-runtime";
import { BrowserSupportReportQueueController } from "./support-report-upload-persistence";

/** Select the queue owner from native capability before either owner can hydrate. */
export function createCapabilityAwareSupportReportQueue(input: {
  storage: ProductStorage;
  diagnostics: DesktopDiagnosticsBridge | null;
  supportSnapshot: DesktopSupportSnapshotBridge | null;
  callbacks: SupportReportQueueCallbacks;
}): SupportReportQueueRuntime {
  if (input.supportSnapshot) {
    const diagnostics = input.diagnostics;
    if (!diagnostics) {
      throw new Error("Native support snapshot capability requires diagnostics attachment access.");
    }
    return new PackagedSupportReportQueueController({
      storage: input.storage,
      supportSnapshot: input.supportSnapshot,
      deleteAttachment: (path) => diagnostics.deleteAttachment(path),
      callbacks: input.callbacks,
    });
  }
  return new BrowserSupportReportQueueController({
    storage: input.storage,
    deleteAttachment: (path) => input.diagnostics?.deleteAttachment(path) ?? Promise.resolve(),
    callbacks: input.callbacks,
  });
}
