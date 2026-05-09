import { describe, expect, it } from "vitest";
import type { MeasurementOperationId } from "@/lib/infra/measurement/debug-measurement";
import { uniqueMeasurementOperationIds } from "@/lib/infra/measurement/operation-ids";

function operationId(id: string): MeasurementOperationId {
  return id as MeasurementOperationId;
}

describe("uniqueMeasurementOperationIds", () => {
  it("removes empty ids and preserves the first occurrence order", () => {
    expect(uniqueMeasurementOperationIds([
      null,
      operationId("op-1"),
      undefined,
      operationId("op-2"),
      operationId("op-1"),
    ])).toEqual([
      operationId("op-1"),
      operationId("op-2"),
    ]);
  });
});
