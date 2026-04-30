import { afterEach, describe, expect, it, vi } from "vitest";

import {
  finishMeasurementOperation,
  resetDebugMeasurementForTest,
  startMeasurementOperation,
} from "@/lib/infra/debug-measurement";
import { measureCloudRequest } from "@/lib/integrations/cloud/timing";

describe("cloud timing", () => {
  afterEach(() => {
    resetDebugMeasurementForTest();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("emits only sanitized cloud timing fields", async () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING", "1");
    const table = vi.spyOn(console, "table").mockImplementation(() => undefined);
    const operationId = startMeasurementOperation({
      kind: "workspace_open",
      surfaces: ["workspace-shell"],
    });
    expect(operationId).not.toBeNull();

    await measureCloudRequest({
      operationId,
      category: "cloud.workspace.list",
      method: "GET",
      run: async () => ({ ok: true }),
    });
    finishMeasurementOperation(operationId!, "completed");

    const row = (table.mock.calls[0]?.[0] as Array<Record<string, unknown>>)[0];
    expect(row.requestCount).toBe(1);
    expect(Object.values(row).join(" ")).not.toContain("/v1/cloud/workspaces");
  });
});
