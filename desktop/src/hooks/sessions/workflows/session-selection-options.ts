import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import type { SessionActivationGuard } from "@/hooks/sessions/workflows/session-activation-guard";

export interface SelectSessionOptionsWithoutGuard {
  latencyFlowId?: string | null;
  allowColdIdleNoStream?: boolean;
  measurementOperationId?: MeasurementOperationId | null;
  reuseMeasurementOperation?: boolean;
  forceCold?: boolean;
}

export type SessionLatencyFlowOptions = SelectSessionOptionsWithoutGuard & {
  guard?: SessionActivationGuard;
};
