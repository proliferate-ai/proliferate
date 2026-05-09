import type { MeasurementOperationId } from "@/lib/infra/measurement/debug-measurement";
import type { SessionActivationGuard } from "@/hooks/sessions/session-activation-guard";

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
