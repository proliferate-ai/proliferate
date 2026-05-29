import {
  configureCloudRequestMeasurement,
} from "@proliferate/cloud-sdk/client/timing";
import { recordMeasurementMetric } from "@/lib/infra/measurement/debug-measurement";
import type { MeasurementOperationId } from "@/lib/infra/measurement/debug-measurement-catalog-types";
import { isAnyHarnessTimingEnabled } from "@/lib/infra/measurement/debug-measurement-env";

configureCloudRequestMeasurement({
  isEnabled: isAnyHarnessTimingEnabled,
  record: (measurement) => {
    recordMeasurementMetric({
      type: "request",
      transport: "cloud",
      category: measurement.category,
      operationId: measurement.operationId as MeasurementOperationId | undefined,
      method: measurement.method,
      status: measurement.status,
      durationMs: measurement.durationMs,
    });
  },
});

export * from "@proliferate/cloud-sdk/client/timing";
