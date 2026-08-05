export const EXPECTED_CONTROL_PLANE_PROBE_TIMEOUT_ERROR_NAME =
  "ProliferateExpectedControlPlaneProbeTimeoutError";

export function createExpectedControlPlaneProbeTimeoutError(): Error {
  const error = new Error("Control plane probe timed out.");
  error.name = EXPECTED_CONTROL_PLANE_PROBE_TIMEOUT_ERROR_NAME;
  return error;
}

export function isExpectedControlPlaneProbeTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  try {
    return (error as { name?: unknown }).name
      === EXPECTED_CONTROL_PLANE_PROBE_TIMEOUT_ERROR_NAME;
  } catch {
    return false;
  }
}
