import type {
  AnyHarnessRequestOptions,
  AnyHarnessTimingCategory,
  } from "@anyharness/sdk";
import { beginMeasurementRequest } from "./debug-measurement";
import { isAnyHarnessTimingEnabled } from "./debug-measurement-env";
import type { MeasurementOperationId } from "./debug-measurement-catalog-types";

const MEASUREMENT_HEADER = "x-proliferate-measurement-operation-id";

export function getMeasurementRequestOptions(input: {
  operationId?: MeasurementOperationId | null;
  category: AnyHarnessTimingCategory;
  headers?: HeadersInit;
}): AnyHarnessRequestOptions | undefined {
  if (!isAnyHarnessTimingEnabled()) {
    return input.headers ? { headers: input.headers } : undefined;
  }

  const options: AnyHarnessRequestOptions = {
    headers: input.headers,
    timingCategory: input.category,
  };
  if (input.operationId) {
    options.measurementOperationId = input.operationId;
    options.headers = mergeMeasurementHeader(input.headers, input.operationId);
    options.timingLifecycle = {
      onRequestStart: () => beginMeasurementRequest(input.operationId),
    };
  }
  return options;
}

function mergeMeasurementHeader(
  headers: HeadersInit | undefined,
  operationId: MeasurementOperationId,
): Headers {
  const next = new Headers(headers);
  next.set(MEASUREMENT_HEADER, operationId);
  return next;
}
