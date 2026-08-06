export interface DevAssistantPerformanceRecord {
  kind: "react-commit";
  id: string;
  phase: string;
  durationMs: number;
  baseDurationMs: number;
  startTimeMs: number;
  commitTimeMs: number;
  recordedAtMs?: number;
}

const ASSISTANT_PERFORMANCE_OUTPUT_ID =
  "proliferate-assistant-performance-data";

let devAssistantPerformanceQueryEnabled: boolean | null = null;

export function recordDevAssistantPerformance(
  record: DevAssistantPerformanceRecord,
): void {
  if (!isDevAssistantPerformanceEnabled()) return;

  const debugGlobal = globalThis as typeof globalThis & {
    __PROLIFERATE_ASSISTANT_PERFORMANCE__?: DevAssistantPerformanceRecord[];
    __PROLIFERATE_ASSISTANT_PERFORMANCE_CONSOLE__?: boolean;
  };
  installDevAssistantPerformanceBridge();
  const records = debugGlobal.__PROLIFERATE_ASSISTANT_PERFORMANCE__ ?? [];
  const nextRecord = { ...record, recordedAtMs: performance.now() };
  records.push(nextRecord);
  if (records.length > 2_000) {
    records.splice(0, 1_000);
  }
  debugGlobal.__PROLIFERATE_ASSISTANT_PERFORMANCE__ = records;
  if (debugGlobal.__PROLIFERATE_ASSISTANT_PERFORMANCE_CONSOLE__ === true) {
    console.debug("[assistant-performance]", nextRecord);
  }
}

export function flushDevAssistantPerformanceBridge(): void {
  const debugGlobal = globalThis as typeof globalThis & {
    __PROLIFERATE_ASSISTANT_PERFORMANCE__?: DevAssistantPerformanceRecord[];
  };
  const output = document.getElementById(ASSISTANT_PERFORMANCE_OUTPUT_ID);
  if (output) {
    output.textContent = JSON.stringify(
      debugGlobal.__PROLIFERATE_ASSISTANT_PERFORMANCE__ ?? [],
    );
  }
}

export function isDevAssistantPerformanceEnabled(): boolean {
  if (typeof window === "undefined") return false;

  const hostname = window.location.hostname;
  const isLocalDevelopmentOrigin = hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "127.0.0.1"
    || hostname === "::1";
  if (!isLocalDevelopmentOrigin) return false;

  const debugGlobal = globalThis as typeof globalThis & {
    __PROLIFERATE_ASSISTANT_PERFORMANCE_ENABLED__?: boolean;
  };
  if (debugGlobal.__PROLIFERATE_ASSISTANT_PERFORMANCE_ENABLED__ === true) {
    return true;
  }
  if (devAssistantPerformanceQueryEnabled === null) {
    devAssistantPerformanceQueryEnabled =
      new URLSearchParams(window.location.search).get(
        "debugAssistantPerformance",
      ) === "1";
  }
  return devAssistantPerformanceQueryEnabled;
}

function installDevAssistantPerformanceBridge(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(ASSISTANT_PERFORMANCE_OUTPUT_ID)) return;

  const output = document.createElement("script");
  output.id = ASSISTANT_PERFORMANCE_OUTPUT_ID;
  output.type = "application/json";
  output.hidden = true;
  output.textContent = "[]";
  document.head.append(output);
}
