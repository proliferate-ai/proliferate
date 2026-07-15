import { useEffect, useRef } from "react";
import { recordMeasurementMetric } from "#product/lib/infra/measurement/measurement-port";
import { isMainThreadMeasurementEnabled } from "#product/lib/infra/measurement/measurement-port";
import type { MeasurementSurface } from "#product/lib/domain/telemetry/debug-measurement-catalog";

export function useDebugRenderCount(surface: MeasurementSurface): void {
  const renderCountRef = useRef(0);
  const recordedCountRef = useRef(0);
  renderCountRef.current += 1;

  useEffect(() => {
    if (!isMainThreadMeasurementEnabled()) {
      return;
    }
    const count = renderCountRef.current - recordedCountRef.current;
    recordedCountRef.current = renderCountRef.current;
    recordMeasurementMetric({
      type: "main_thread",
      surface,
      metric: "render_count",
      count,
    });
  });
}
