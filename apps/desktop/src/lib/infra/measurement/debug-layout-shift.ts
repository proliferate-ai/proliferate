import { isLatencyDebugLoggingEnabled } from "./debug-latency";
import {
  diagnosticField,
  recordRendererDiagnostic,
} from "@proliferate/product-client/internal/lib/infra/diagnostics/renderer-diagnostics-port";

interface LayoutShiftAttribution {
  node: Node | null;
  previousRect: DOMRectReadOnly;
  currentRect: DOMRectReadOnly;
}

interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
  sources?: readonly LayoutShiftAttribution[];
}

/**
 * Dev-only jank probe (VITE_PROLIFERATE_DEBUG_LATENCY=1): logs every
 * unexpected layout shift with its score and the shifted element, so
 * transcript smoothness is verifiable from logs instead of eyeballing
 * recordings. Shifts caused by recent user input are excluded, matching CLS
 * semantics.
 */
export function startLayoutShiftObserver(): () => void {
  if (
    !isLatencyDebugLoggingEnabled()
    || typeof PerformanceObserver === "undefined"
    || !PerformanceObserver.supportedEntryTypes?.includes("layout-shift")
  ) {
    return () => {};
  }

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as LayoutShiftEntry[]) {
      if (entry.hadRecentInput || entry.value < 0.0005) {
        continue;
      }
      const source = entry.sources?.[0];
      const node = source?.node;
      const label = node instanceof Element
        ? `${node.tagName.toLowerCase()}${node.className && typeof node.className === "string" ? `.${node.className.split(" ")[0]}` : ""}`
        : "unknown";
      recordRendererDiagnostic({
        name: "renderer.measurement.layout_shift",
        severity: "debug",
        kind: "progress",
        privacy: "sensitive",
        fields: {
          score: diagnosticField(Number(entry.value.toFixed(4)), "operational"),
          element: diagnosticField(label, "sensitive"),
          from: diagnosticField(
            source ? rectSummary(source.previousRect) : "unknown",
            "operational",
          ),
          to: diagnosticField(
            source ? rectSummary(source.currentRect) : "unknown",
            "operational",
          ),
        },
      });
      console.info("[layout-shift]", {
        score: Number(entry.value.toFixed(4)),
        element: label,
        from: source ? rectSummary(source.previousRect) : null,
        to: source ? rectSummary(source.currentRect) : null,
      });
    }
  });
  observer.observe({ type: "layout-shift", buffered: false });
  return () => observer.disconnect();
}

function rectSummary(rect: DOMRectReadOnly): string {
  return `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
}
