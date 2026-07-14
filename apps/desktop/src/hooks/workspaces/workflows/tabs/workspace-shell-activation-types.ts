import type { MeasurementOperationId } from "#product/lib/domain/telemetry/debug-measurement-catalog";

export interface SelectSessionOptionsWithoutGuard {
  latencyFlowId?: string | null;
  measurementOperationId?: MeasurementOperationId | null;
  reuseMeasurementOperation?: boolean;
  allowColdIdleNoStream?: boolean;
  forceCold?: boolean;
}
