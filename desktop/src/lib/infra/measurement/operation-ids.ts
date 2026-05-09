import type { MeasurementOperationId } from "@/lib/infra/measurement/debug-measurement";

export function uniqueMeasurementOperationIds(
  operationIds: readonly (MeasurementOperationId | null | undefined)[],
): MeasurementOperationId[] {
  return [...new Set(operationIds.filter((id): id is MeasurementOperationId => !!id))];
}
