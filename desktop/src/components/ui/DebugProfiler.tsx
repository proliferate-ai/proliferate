import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from "react";
import { recordMeasurementMetric } from "@/lib/infra/measurement/debug-measurement";
import { isMainThreadMeasurementEnabled } from "@/lib/infra/measurement/debug-measurement-env";
import type { MeasurementSurface } from "@/lib/domain/telemetry/debug-measurement-catalog";

interface DebugProfilerProps {
  id: MeasurementSurface;
  children: ReactNode;
}

export function DebugProfiler({ id, children }: DebugProfilerProps) {
  if (!isMainThreadMeasurementEnabled()) {
    return <>{children}</>;
  }

  return (
    <Profiler id={id} onRender={handleRender}>
      {children}
    </Profiler>
  );
}

const handleRender: ProfilerOnRenderCallback = (
  id,
  _phase,
  actualDuration,
) => {
  recordMeasurementMetric({
    type: "main_thread",
    surface: id as MeasurementSurface,
    metric: "react_commit",
    durationMs: actualDuration,
  });
};
