const telemetryHandledErrors = new WeakSet<Error>();

export function markTelemetryHandled(error: Error): Error {
  telemetryHandledErrors.add(error);
  return error;
}

export function isTelemetryHandled(error: unknown): boolean {
  return error instanceof Error && telemetryHandledErrors.has(error);
}
