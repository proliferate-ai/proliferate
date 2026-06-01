import {
  INTERNAL_LOG_RENDERER_EVENT_URL,
  MAX_FETCH_SUMMARY_ENTRIES,
  type BootDiagnosticRecorder,
  type BootDiagnosticDump,
  type FetchDiagnosticSummary,
} from "./boot-stall-diagnostics-types";
import {
  summarizeBootValue,
  summarizeFetchRequest,
} from "./boot-stall-diagnostics-format";
import { now, round } from "./debug-measurement-utils";

let originalFetch: typeof window.fetch | null = null;
const fetchSummaries = new Map<string, FetchDiagnosticSummary>();

export function installBootDiagnosticsFetchProbe(deps: {
  recordBootDiagnostic: BootDiagnosticRecorder;
  getNextSeq: () => number;
}): void {
  if (originalFetch !== null || typeof window.fetch !== "function") {
    return;
  }

  originalFetch = window.fetch;
  window.fetch = async function bootDiagnosticsFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const requestSeq = deps.getNextSeq();
    const startedAt = now();
    const request = summarizeFetchRequest(input, init);
    if (request.url === INTERNAL_LOG_RENDERER_EVENT_URL) {
      return originalFetch!.call(window, input, init);
    }

    recordFetchSummaryStart(request);
    deps.recordBootDiagnostic("fetch.start", {
      requestSeq,
      ...request,
    });

    try {
      const response = await originalFetch!.call(window, input, init);
      const durationMs = round(now() - startedAt);
      recordFetchSummaryEnd(request, response.status, durationMs);
      deps.recordBootDiagnostic("fetch.end", {
        requestSeq,
        ...request,
        status: response.status,
        durationMs,
      });
      return response;
    } catch (error) {
      const durationMs = round(now() - startedAt);
      recordFetchSummaryError(request, error, durationMs);
      deps.recordBootDiagnostic("fetch.error", {
        requestSeq,
        ...request,
        durationMs,
        error: summarizeBootValue(error),
      });
      throw error;
    }
  };
}

export function uninstallBootDiagnosticsFetchProbe(): void {
  if (originalFetch !== null) {
    window.fetch = originalFetch;
    originalFetch = null;
  }
}

export function resetBootDiagnosticsFetch(): void {
  fetchSummaries.clear();
}

export function getFetchDiagnosticTotals(): Pick<
  BootDiagnosticDump["fetches"],
  "starts" | "ends" | "errors" | "inFlight"
> {
  let starts = 0;
  let ends = 0;
  let errors = 0;
  let inFlight = 0;
  for (const summary of fetchSummaries.values()) {
    starts += summary.starts;
    ends += summary.ends;
    errors += summary.errors;
    inFlight += summary.inFlight;
  }
  return { starts, ends, errors, inFlight };
}

export function getTopFetchSummaries(): FetchDiagnosticSummary[] {
  return Array.from(fetchSummaries.values())
    .sort((left, right) =>
      (right.starts + right.errors * 4 + right.inFlight * 2 + right.maxDurationMs / 100)
      - (left.starts + left.errors * 4 + left.inFlight * 2 + left.maxDurationMs / 100)
    )
    .slice(0, 20)
    .map((summary) => ({ ...summary }));
}

function recordFetchSummaryStart(request: Record<string, unknown>): void {
  const summary = getFetchSummary(request);
  if (!summary) {
    return;
  }

  summary.starts += 1;
  summary.inFlight += 1;
}

function recordFetchSummaryEnd(
  request: Record<string, unknown>,
  status: number,
  durationMs: number,
): void {
  const summary = getFetchSummary(request);
  if (!summary) {
    return;
  }

  summary.ends += 1;
  summary.inFlight = Math.max(0, summary.inFlight - 1);
  summary.lastStatus = status;
  summary.lastDurationMs = durationMs;
  summary.maxDurationMs = Math.max(summary.maxDurationMs, durationMs);
}

function recordFetchSummaryError(
  request: Record<string, unknown>,
  error: unknown,
  durationMs: number,
): void {
  const summary = getFetchSummary(request);
  if (!summary) {
    return;
  }

  summary.errors += 1;
  summary.inFlight = Math.max(0, summary.inFlight - 1);
  summary.lastDurationMs = durationMs;
  summary.maxDurationMs = Math.max(summary.maxDurationMs, durationMs);
  summary.lastError = summarizeBootValue(error);
}

function getFetchSummary(request: Record<string, unknown>): FetchDiagnosticSummary | null {
  const method = typeof request.method === "string" ? request.method : "GET";
  const url = typeof request.url === "string" ? request.url : "[unknown-url]";
  const key = `${method} ${url}`;
  const existing = fetchSummaries.get(key);
  if (existing) {
    return existing;
  }

  if (fetchSummaries.size >= MAX_FETCH_SUMMARY_ENTRIES) {
    return null;
  }

  const summary: FetchDiagnosticSummary = {
    key,
    method,
    url,
    starts: 0,
    ends: 0,
    errors: 0,
    inFlight: 0,
    lastStatus: null,
    lastDurationMs: null,
    maxDurationMs: 0,
    lastError: null,
  };
  fetchSummaries.set(key, summary);
  return summary;
}
