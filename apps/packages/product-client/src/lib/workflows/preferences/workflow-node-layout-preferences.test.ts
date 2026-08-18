import { beforeEach, describe, expect, it } from "vitest";
import {
  readWorkflowNodeLayout,
  writeWorkflowNodeLayout,
  type WorkflowNodeLayoutDependencies,
} from "#product/lib/workflows/preferences/workflow-node-layout-preferences";

let stored: Record<string, unknown>;
let dependencies: WorkflowNodeLayoutDependencies;

beforeEach(() => {
  stored = {};
  dependencies = {
    readPersistedValue: async (key) => stored[key],
    persistValue: async (key, value) => {
      stored[key] = JSON.parse(JSON.stringify(value));
    },
  };
});

describe("workflow node layout preferences", () => {
  it("round-trips one workflow's placements without touching another's", async () => {
    await writeWorkflowNodeLayout("wf-1", { "step-1": { x: 10, y: 20 } }, dependencies);
    await writeWorkflowNodeLayout("wf-2", { "step-1": { x: 99, y: 99 } }, dependencies);

    expect(await readWorkflowNodeLayout("wf-1", dependencies))
      .toEqual({ "step-1": { x: 10, y: 20 } });
    expect(await readWorkflowNodeLayout("wf-2", dependencies))
      .toEqual({ "step-1": { x: 99, y: 99 } });
    expect(await readWorkflowNodeLayout("wf-unknown", dependencies)).toEqual({});
  });

  it("drops a workflow whose placements are all gone", async () => {
    await writeWorkflowNodeLayout("wf-1", { "step-1": { x: 10, y: 20 } }, dependencies);
    await writeWorkflowNodeLayout("wf-1", {}, dependencies);

    expect(stored.workflow_node_layout).toEqual({});
  });

  it("keeps only coordinates the canvas can place a card at", async () => {
    // Whatever is on disk was written by some earlier version of this app or
    // hand-edited; a card placed off the content box could not be panned to.
    stored.workflow_node_layout = {
      "wf-1": {
        good: { x: 12, y: 34 },
        negative: { x: -50, y: -10 },
        infinite: { x: Number.POSITIVE_INFINITY, y: 0 },
        wrongType: { x: "12", y: 34 },
        notAPlacement: 7,
      },
      "wf-empty": {},
    };

    expect(await readWorkflowNodeLayout("wf-1", dependencies)).toEqual({
      good: { x: 12, y: 34 },
      negative: { x: 0, y: 0 },
    });
    expect(await readWorkflowNodeLayout("wf-empty", dependencies)).toEqual({});
  });

  it("survives a stored value that is not a layout at all", async () => {
    stored.workflow_node_layout = "corrupted";
    expect(await readWorkflowNodeLayout("wf-1", dependencies)).toEqual({});
  });
});
