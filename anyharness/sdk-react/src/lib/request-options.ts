import type { AnyHarnessRequestOptions } from "@anyharness/sdk";

export function requestOptionsWithSignal(
  requestOptions: AnyHarnessRequestOptions | undefined,
  signal: AbortSignal,
): AnyHarnessRequestOptions {
  return {
    ...requestOptions,
    signal: composeAbortSignals(signal, requestOptions?.signal),
  };
}

function composeAbortSignals(
  querySignal: AbortSignal,
  requestSignal: AbortSignal | undefined,
): AbortSignal {
  if (!requestSignal || requestSignal === querySignal) {
    return querySignal;
  }
  if (querySignal.aborted) {
    return querySignal;
  }
  if (requestSignal.aborted) {
    return requestSignal;
  }

  const abortSignalAny = (
    AbortSignal as typeof AbortSignal & {
      any?: (signals: AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof abortSignalAny === "function") {
    return abortSignalAny([querySignal, requestSignal]);
  }

  const controller = new AbortController();
  const abortFromQuery = () => abortFrom(querySignal);
  const abortFromRequest = () => abortFrom(requestSignal);
  const cleanup = () => {
    querySignal.removeEventListener("abort", abortFromQuery);
    requestSignal.removeEventListener("abort", abortFromRequest);
  };
  const abortFrom = (source: AbortSignal) => {
    cleanup();
    controller.abort(source.reason);
  };

  querySignal.addEventListener("abort", abortFromQuery, { once: true });
  requestSignal.addEventListener("abort", abortFromRequest, { once: true });
  return controller.signal;
}
