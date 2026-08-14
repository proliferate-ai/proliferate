import { describe, expect, it } from "vitest";

import {
  buildRendererProducerRecord,
  prevalidateRendererDiagnostic,
} from "./renderer-diagnostic-filter";

describe("renderer diagnostic optional accessor filtering", () => {
  it("never executes optional accessors and marks their replacement structural", () => {
    let getterCalls = 0;
    const input = {
      name: "renderer.test.optional_accessors",
      severity: "warn",
      privacy: "sensitive",
    } as Record<string, unknown>;
    for (const key of ["message", "fields", "errorClassification"]) {
      Object.defineProperty(input, key, {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error(`${key} getter executed`);
        },
      });
    }

    const prevalidated = prevalidateRendererDiagnostic(input as never);
    expect(prevalidated).not.toBeNull();
    const built = buildRendererProducerRecord(prevalidated!, {
      producerBootId: "00000000-0000-4000-8000-000000000001",
      producerSequence: 1,
      release: "test",
      environment: "test",
      operationId: "00000000-0000-4000-8000-000000000002",
      sourceTimestamp: "2026-08-11T12:00:00.000Z",
    });

    expect(getterCalls).toBe(0);
    expect(built?.record.detailed?.message).toBe("[accessor]");
    expect(built?.record.error_classification).toBeUndefined();
    expect(built?.record.arguments).toEqual([]);
    expect(built?.record.redaction).toBe("structural");
  });
});
