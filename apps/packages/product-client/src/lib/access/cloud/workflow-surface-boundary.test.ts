import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../../../../..");

describe("shared Workflow surface boundary", () => {
  it("uses only injected open-session callbacks and contains no raw runtime/Tauri clients", () => {
    const files = [
      "apps/packages/product-surfaces/src/workflows/WorkflowRunsSurface.tsx",
      "apps/packages/product-ui/src/workflows/WorkflowRunDetail.tsx",
      "apps/packages/product-ui/src/workflows/WorkflowRunForm.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(resolve(root, file), "utf8");
      expect(source).not.toMatch(/@anyharness|\/v1\/workflow-runs|invoke\(|@tauri/iu);
    }
  });
});
