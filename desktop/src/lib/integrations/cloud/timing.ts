import {
  isAnyHarnessTimingEnabled,
  recordMeasurementMetric,
  type MeasurementCloudCategory,
  type MeasurementOperationId,
} from "@/lib/infra/debug-measurement";

export interface CloudMeasurementOptions {
  measurementOperationId?: MeasurementOperationId | null;
}

export async function measureCloudRequest<T>(input: {
  operationId?: MeasurementOperationId | null;
  category: MeasurementCloudCategory;
  method: "GET" | "PATCH";
  run: () => Promise<T>;
}): Promise<T> {
  if (!isAnyHarnessTimingEnabled()) {
    return input.run();
  }

  const startedAt = performance.now();
  try {
    const result = await input.run();
    recordMeasurementMetric({
      type: "request",
      transport: "cloud",
      category: input.category,
      operationId: input.operationId ?? undefined,
      method: input.method,
      status: 200,
      durationMs: performance.now() - startedAt,
    });
    return result;
  } catch (error) {
    recordMeasurementMetric({
      type: "request",
      transport: "cloud",
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
