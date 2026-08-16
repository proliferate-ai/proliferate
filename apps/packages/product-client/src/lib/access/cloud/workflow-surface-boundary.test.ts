import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../../../../..");

function source(file: string): string {
  return readFileSync(resolve(root, file), "utf8");
}

describe("Workflows gen-2 surface boundary", () => {
  it("keeps definition-authoring surfaces cloud-only: no AnyHarness runtime client", () => {
    // These files only ever talk to the definitions control-plane
    // (`@proliferate/cloud-sdk`), so none of them should know the AnyHarness
    // runtime exists, nor hand-roll a run-scoped REST path. The placement
    // pickers are the deliberate exception: `placement.repoConfigId` carries
    // the RUNTIME repo-root id end to end, so the files hosting a picker
    // (trigger dialog, builder surface) read repo roots through
    // `@anyharness/sdk-react` and are guarded in the next test instead.
    const files = [
      "apps/packages/product-client/src/components/workflows/main/WorkflowsMainSurface.tsx",
      "apps/packages/product-client/src/components/workflows/builder-v2/WorkflowBuilderDetailsCard.tsx",
      "apps/packages/product-client/src/components/workflows/builder-v2/WorkflowBuilderNodeCard.tsx",
      "apps/packages/product-client/src/components/workflows/builder-v2/WorkflowBuilderDocInspector.tsx",
      "apps/packages/product-client/src/components/workflows/builder-v2/WorkflowBuilderInputsPanel.tsx",
      "apps/packages/product-client/src/components/workflows/builder-v2/WorkflowBuilderPromptField.tsx",
      "apps/packages/product-client/src/components/workflows/builder-v2/WorkflowBuilderChainCanvas.tsx",
      "apps/packages/product-client/src/components/workflows/builder-v2/WorkflowBuilderRail.tsx",
      "apps/packages/product-client/src/hooks/workflows/facade/use-workflow-builder.ts",
      "apps/packages/product-client/src/hooks/access/cloud/workflows/use-workflow-definitions-v2-access.ts",
      "apps/packages/product-client/src/hooks/access/cloud/workflows/use-workflow-trigger-access.ts",
    ];
    for (const file of files) {
      expect(source(file)).not.toMatch(/@anyharness|@tauri|invoke\(|\/v1\/workflow-runs/iu);
    }
  });

  it("keeps runtime-facing surfaces off raw platform primitives", () => {
    // These files legitimately import `@anyharness/sdk`(-react): a running
    // workflow's state lives behind the AnyHarness SDK (the ADR's run/node
    // projections), the trigger/builder placement pickers read runtime repo
    // roots (`placement.repoConfigId` is a runtime repo-root id), and the
    // trigger actions write runs through the SDK projection writer. What
    // none of them may do is reach past that SDK for a raw Tauri IPC call
    // or a hand-rolled run-scoped REST path — that bypass is what this
    // guards against.
    const files = [
      "apps/packages/product-client/src/components/workflows/run-view/WorkflowPane.tsx",
      "apps/packages/product-client/src/components/workflows/run-view/WorkflowGraphNodeCard.tsx",
      "apps/packages/product-client/src/components/workflows/run-view/WorkflowDocsList.tsx",
      "apps/packages/product-client/src/components/workflows/run-view/WorkflowResumePopoverPresenter.tsx",
      "apps/packages/product-client/src/components/workflows/trigger/WorkflowTriggerDialog.tsx",
      "apps/packages/product-client/src/components/workflows/builder-v2/WorkflowBuilderSurface.tsx",
      "apps/packages/product-client/src/hooks/workflows/facade/use-workflow-pane.ts",
      "apps/packages/product-client/src/hooks/workflows/workflows/use-workflow-trigger-actions.ts",
      "apps/packages/product-client/src/hooks/workflows/lifecycle/use-workflow-resume-popover.ts",
      "apps/packages/product-client/src/hooks/workflows/ui/use-workflow-doc-open.ts",
    ];
    for (const file of files) {
      expect(source(file)).not.toMatch(/@tauri|invoke\(|\/v1\/workflow-runs/iu);
    }
  });
});
