import {
  MAX_PERFORMANCE_MEASURE_REPORTS,
  MAX_PERFORMANCE_MEASURE_SUMMARIES,
  type BootDiagnosticRecorder,
  type PerformanceMeasureDiagnosticSummary,
} from "./boot-stall-diagnostics-types";
import {
  stackWithoutBootDiagnosticFrames,
  summarizeBootValue,
} from "./boot-stall-diagnostics-format";
import { now } from "./debug-measurement-utils";

interface PreparedPerformanceMeasureCall {
  args: unknown[];
  fallbackEntry: PerformanceMeasure | null;
  skipNative: boolean;
}

let originalPerformanceMeasure: Performance["measure"] | null = null;
let performanceMeasureCallCount = 0;
let performanceMeasureDetailStripCount = 0;
const performanceMeasureSummaries = new Map<string, PerformanceMeasureDiagnosticSummary>();

export function installBootDiagnosticsPerformanceMeasureProbe(
  recordBootDiagnostic: BootDiagnosticRecorder,
): void {
  if (
    originalPerformanceMeasure !== null
    || typeof performance === "undefined"
    || typeof performance.measure !== "function"
  ) {
    return;
  }

  originalPerformanceMeasure = performance.measure;
  const measureWithDiagnostics = function bootDiagnosticsPerformanceMeasure(
    ...args: unknown[]
  ): PerformanceMeasure {
    performanceMeasureCallCount += 1;
    const preparedCall = preparePerformanceMeasureCall(args, recordBootDiagnostic);
    if (preparedCall.skipNative && preparedCall.fallbackEntry) {
      return preparedCall.fallbackEntry;
    }
    return (originalPerformanceMeasure as (...measureArgs: unknown[]) => PerformanceMeasure)
      .apply(performance, preparedCall.args);
  } as Performance["measure"];

  try {
    performance.measure = measureWithDiagnostics;
  } catch (error) {
    originalPerformanceMeasure = null;
    recordBootDiagnostic("performance.measure_probe.install_failed", {
      error: summarizeBootValue(error),
    });
  }
}

export function uninstallBootDiagnosticsPerformanceMeasureProbe(): void {
  if (originalPerformanceMeasure !== null && typeof performance !== "undefined") {
    performance.measure = originalPerformanceMeasure;
    originalPerformanceMeasure = null;
  }
}

export function resetBootDiagnosticsPerformanceMeasures(): void {
  performanceMeasureSummaries.clear();
  performanceMeasureCallCount = 0;
  performanceMeasureDetailStripCount = 0;
}

export function getBootPerformanceMeasureStats(): {
  calls: number;
  detailStripped: number;
  top: PerformanceMeasureDiagnosticSummary[];
} {
  return {
    calls: performanceMeasureCallCount,
    detailStripped: performanceMeasureDetailStripCount,
    top: Array.from(performanceMeasureSummaries.values())
      .sort((left, right) =>
        (right.detailStripped * 8 + right.nativeSkipped * 4 + right.calls)
        - (left.detailStripped * 8 + left.nativeSkipped * 4 + left.calls)
      )
      .slice(0, 20)
      .map((summary) => ({ ...summary })),
  };
}

function preparePerformanceMeasureCall(
  args: unknown[],
  recordBootDiagnostic: BootDiagnosticRecorder,
): PreparedPerformanceMeasureCall {
  const name = typeof args[0] === "string" ? args[0] : "[unknown]";
  const options = args[1];
  if (!isPerformanceMeasureOptionsWithDetail(options)) {
    recordPerformanceMeasureSummary(name, {
      detailSummary: null,
      nativeSkipped: false,
      stack: null,
      strippedDetail: false,
    });
    return {
      args,
      fallbackEntry: null,
      skipNative: false,
    };
  }

  const stack = stackWithoutBootDiagnosticFrames(new Error().stack ?? "");
  const detailSummary = summarizePerformanceMeasureDetail(options.detail);
  const skipNative = isReactDevToolsPerformanceDetail(options.detail);
  performanceMeasureDetailStripCount += 1;
  recordPerformanceMeasureSummary(name, {
    detailSummary,
    nativeSkipped: skipNative,
    stack: stack || null,
    strippedDetail: true,
  });

  if (performanceMeasureDetailStripCount <= MAX_PERFORMANCE_MEASURE_REPORTS) {
    recordBootDiagnostic("performance.measure.detail_stripped", {
      name,
      detailSummary,
      nativeSkipped: skipNative,
      stack: stack || null,
    });
  }

  if (skipNative) {
    return {
      args,
      fallbackEntry: createSyntheticPerformanceMeasure(name, options, detailSummary),
      skipNative: true,
    };
  }

  const sanitizedOptions = {
    ...options,
    detail: detailSummary,
  };
  return {
    args: [args[0], sanitizedOptions, ...args.slice(2)],
    fallbackEntry: null,
    skipNative: false,
  };
}

function isPerformanceMeasureOptionsWithDetail(
  value: unknown,
): value is PerformanceMeasureOptions & { detail: unknown } {
  return typeof value === "object"
    && value !== null
    && "detail" in value
    && (value as PerformanceMeasureOptions).detail !== undefined
    && (value as PerformanceMeasureOptions).detail !== null;
}

function recordPerformanceMeasureSummary(
  name: string,
  {
    detailSummary,
    nativeSkipped,
    stack,
    strippedDetail,
  }: {
    detailSummary: unknown;
    nativeSkipped: boolean;
    stack: string | null;
    strippedDetail: boolean;
  },
): void {
  let summary = performanceMeasureSummaries.get(name);
  if (!summary) {
    if (performanceMeasureSummaries.size >= MAX_PERFORMANCE_MEASURE_SUMMARIES) {
      return;
    }
    summary = {
      name,
      calls: 0,
      detailStripped: 0,
      nativeSkipped: 0,
      lastDetailSummary: null,
      lastStack: null,
    };
    performanceMeasureSummaries.set(name, summary);
  }

  summary.calls += 1;
  if (strippedDetail) {
    summary.detailStripped += 1;
    if (nativeSkipped) {
      summary.nativeSkipped += 1;
    }
    summary.lastDetailSummary = detailSummary;
    summary.lastStack = stack;
  }
}

function isReactDevToolsPerformanceDetail(value: unknown): boolean {
  return typeof value === "object"
    && value !== null
    && "devtools" in value;
}

function createSyntheticPerformanceMeasure(
  name: string,
  options: PerformanceMeasureOptions,
  detail: unknown,
): PerformanceMeasure {
  const startTime = typeof options.start === "number" ? options.start : now();
  const endTime = typeof options.end === "number" ? options.end : startTime;
  const duration = typeof options.duration === "number"
    ? options.duration
    : Math.max(0, endTime - startTime);
  const entry = {
    detail,
    duration,
    entryType: "measure",
    name,
    startTime,
    toJSON() {
      return {
        detail,
        duration,
        entryType: "measure",
        name,
        startTime,
      };
    },
  };
  return entry as PerformanceMeasure;
}

function summarizePerformanceMeasureDetail(value: unknown): unknown {
  if (
    value === null
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return {
      type: "string",
      length: value.length,
      preview: value.length > 160 ? `${value.slice(0, 160)}...` : value,
    };
  }

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
    };
  }

  if (typeof value === "object") {
    return {
      type: Object.prototype.toString.call(value),
      constructorName: value.constructor?.name ?? null,
    };
  }

  return {
    type: typeof value,
    value: String(value),
  };
}
