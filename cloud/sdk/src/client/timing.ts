export type CloudMeasurementCategory =
  | "cloud.workspace.list"
  | "cloud.workspace.display_name.update";

export interface CloudMeasurementOptions {
  measurementOperationId?: string | null;
  signal?: AbortSignal;
}

export interface CloudRequestMeasurement {
  category: CloudMeasurementCategory;
  operationId?: string | null;
  method: "GET" | "PATCH";
  status: number | "network_error";
  durationMs: number;
}

export interface CloudRequestMeasurementRuntime {
  isEnabled: () => boolean;
  record: (measurement: CloudRequestMeasurement) => void;
}

let measurementRuntime: CloudRequestMeasurementRuntime | null = null;

export function configureCloudRequestMeasurement(
  runtime: CloudRequestMeasurementRuntime | null,
): void {
  measurementRuntime = runtime;
}

export async function measureCloudRequest<T>(input: {
  operationId?: string | null;
  category: CloudMeasurementCategory;
  method: "GET" | "PATCH";
  run: () => Promise<T>;
}): Promise<T> {
  if (!measurementRuntime?.isEnabled()) {
    return input.run();
  }

  const startedAt = performance.now();
  try {
    const result = await input.run();
    measurementRuntime.record({
      category: input.category,
      operationId: input.operationId ?? undefined,
      method: input.method,
      status: 200,
      durationMs: performance.now() - startedAt,
    });
    return result;
  } catch (error) {
    measurementRuntime.record({
      category: input.category,
      operationId: input.operationId ?? undefined,
      method: input.method,
      status: statusFromError(error),
      durationMs: performance.now() - startedAt,
    });
    throw error;
  }
}

function statusFromError(error: unknown): number | "network_error" {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : "network_error";
}

