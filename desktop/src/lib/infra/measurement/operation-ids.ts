import type { MeasurementOperationId } from "./debug-measurement-catalog-types";

export function uniqueMeasurementOperationIds(
  operationIds: readonly (MeasurementOperationId | null | undefined)[],
): MeasurementOperationId[] {
  return [...new Set(operationIds.filter((id): id is MeasurementOperationId => !!id))];
}
