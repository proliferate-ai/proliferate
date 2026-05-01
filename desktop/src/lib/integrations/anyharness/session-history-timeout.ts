function createSessionHistoryAbortError(): Error {
  const error = new Error("Session history request timed out");
  error.name = "AbortError";
  return error;
}

export function waitForSessionHistoryTimeout<T>(
  promise: Promise<T>,
  signal: AbortSignal | null,
): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(createSessionHistoryAbortError());
  }

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(createSessionHistoryAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}
