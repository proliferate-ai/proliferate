export const EXPECTED_SESSION_STREAM_STALE_CLOSE_ERROR_NAME =
  "ProliferateExpectedSessionStreamStaleCloseError";

export function createExpectedSessionStreamStaleCloseError(): Error {
  const error = new Error("Stale session stream connection closed.");
  error.name = EXPECTED_SESSION_STREAM_STALE_CLOSE_ERROR_NAME;
  return error;
}

export function isExpectedSessionStreamStaleCloseError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  try {
    return (error as { name?: unknown }).name
      === EXPECTED_SESSION_STREAM_STALE_CLOSE_ERROR_NAME;
  } catch {
    return false;
  }
}
