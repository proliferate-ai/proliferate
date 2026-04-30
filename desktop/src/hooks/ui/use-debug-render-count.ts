import { useEffect, useRef } from "react";
import {
  isMainThreadMeasurementEnabled,
  recordMeasurementMetric,
  type MeasurementSurface,
} from "@/lib/infra/debug-measurement";

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
