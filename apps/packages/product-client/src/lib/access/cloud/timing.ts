import {
  configureCloudRequestMeasurement,
} from "@proliferate/cloud-sdk/client/timing";
import { recordMeasurementMetric } from "#product/lib/infra/measurement/measurement-port";
import type { MeasurementOperationId } from "#product/lib/infra/measurement/measurement-port";
import { isAnyHarnessTimingEnabled } from "#product/lib/infra/measurement/measurement-port";

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
