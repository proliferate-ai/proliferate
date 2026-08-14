import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../../../../..");

function source(file: string): string {
  return readFileSync(resolve(root, file), "utf8");
}

describe("Workflows gen-2 surface boundary", () => {
  it("keeps definition/trigger surfaces cloud-only: no AnyHarness runtime client", () => {
    // These files only ever talk to the definitions/trigger control-plane
    // (`@proliferate/cloud-sdk`) — a workflow run's live state is a
    // run-view concern, not a definitions/trigger one, so none of these
    // should know the AnyHarness runtime exists at all.
    const files = [
      "apps/packages/product-client/src/components/workflows/main/WorkflowsMainSurface.tsx",
      "apps/packages/product-client/src/components/workflows/trigger/WorkflowTriggerDialog.tsx",
      "apps/packages/product-client/src/hooks/workflows/workflows/use-workflow-trigger-actions.ts",
      "apps/packages/product-client/src/hooks/access/cloud/workflows/use-workflow-definitions-v2-access.ts",
      "apps/packages/product-client/src/hooks/access/cloud/workflows/use-workflow-trigger-access.ts",
    ];
    for (const file of files) {
      expect(source(file)).not.toMatch(/@anyharness|@tauri|invoke\(/iu);
    }
  });

  it("keeps run-view surfaces off raw platform primitives", () => {
    // A running workflow's state legitimately lives behind the AnyHarness
    // SDK (see the Workflows ADR's run/node projections), so these files
    // are allowed to import `@anyharness/sdk`(-react). What they must never
    // do is reach past that SDK for a raw Tauri IPC call or a hand-rolled
    // REST path — that bypass is what this guards against.
    const files = [
      "apps/packages/product-client/src/components/workflows/run-view/WorkflowPane.tsx",
      "apps/packages/product-client/src/components/workflows/run-view/WorkflowGraphNodeCard.tsx",
      "apps/packages/product-client/src/components/workflows/run-view/WorkflowDocsList.tsx",
      "apps/packages/product-client/src/components/workflows/run-view/WorkflowResumePopoverPresenter.tsx",
      "apps/packages/product-client/src/hooks/workflows/facade/use-workflow-pane.ts",
      "apps/packages/product-client/src/hooks/workflows/lifecycle/use-workflow-resume-popover.ts",
      "apps/packages/product-client/src/hooks/workflows/ui/use-workflow-doc-open.ts",
    ];
    for (const file of files) {
      expect(source(file)).not.toMatch(/@tauri|invoke\(|\/v1\/workflow-runs/iu);
    }
  });
});
