import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from "react";
import { recordMeasurementMetric } from "@/lib/infra/measurement/debug-measurement";
import { isMainThreadMeasurementEnabled } from "@/lib/infra/measurement/debug-measurement-env";
import {
  isBootDiagnosticsBrowserFlagEnabled,
  recordBootDiagnostic,
} from "@/lib/infra/measurement/boot-stall-diagnostics";
import { envFlagEnabled, round } from "@/lib/infra/measurement/debug-measurement-utils";
import type { MeasurementSurface } from "@/lib/domain/telemetry/debug-measurement-catalog";

interface DebugProfilerProps {
  id: MeasurementSurface;
  children: ReactNode;
}

export function DebugProfiler({ id, children }: DebugProfilerProps) {
  if (!isDebugProfilerEnabled()) {
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
  phase,
  actualDuration,
  baseDuration,
  startTime,
  commitTime,
) => {
  recordBootProfilerRender({
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  });
  recordMeasurementMetric({
    type: "main_thread",
    surface: id as MeasurementSurface,
    metric: "react_commit",
    durationMs: actualDuration,
    startedAtMs: startTime,
    endedAtMs: commitTime,
  });
};

function isDebugProfilerEnabled(): boolean {
  return isMainThreadMeasurementEnabled()
    || (
      import.meta.env.DEV
      && (
        envFlagEnabled(import.meta.env.VITE_PROLIFERATE_BOOT_DIAGNOSTICS, false)
        || isBootDiagnosticsBrowserFlagEnabled()
      )
    );
}

const PROFILER_RENDER_MILESTONES = new Set([1, 2, 3, 5, 10, 25, 50, 100, 250, 500, 1_000]);
const SLOW_PROFILER_RENDER_MS = 16;
const profilerRenderCounts = new Map<string, number>();

function recordBootProfilerRender({
  id,
  phase,
  actualDuration,
  baseDuration,
  startTime,
  commitTime,
}: {
  id: string;
  phase: string;
  actualDuration: number;
  baseDuration: number;
  startTime: number;
  commitTime: number;
}): void {
  const count = (profilerRenderCounts.get(id) ?? 0) + 1;
  profilerRenderCounts.set(id, count);
  if (actualDuration < SLOW_PROFILER_RENDER_MS && !PROFILER_RENDER_MILESTONES.has(count)) {
    return;
  }

  recordBootDiagnostic("react_profiler.render", {
    surface: id,
    phase,
    count,
    durationMs: round(actualDuration),
    baseDurationMs: round(baseDuration),
    commitDelayMs: round(commitTime - startTime),
  });
}
