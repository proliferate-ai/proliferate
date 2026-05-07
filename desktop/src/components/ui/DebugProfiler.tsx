import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from "react";
import {
  isMainThreadMeasurementEnabled,
  recordMeasurementMetric,
  type MeasurementSurface,
} from "@/lib/infra/measurement/debug-measurement";

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
