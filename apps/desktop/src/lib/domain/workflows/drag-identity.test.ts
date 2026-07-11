import { describe, expect, it } from "vitest";
import {
  isParallelGroup,
  type WorkflowAgentNode,
  type WorkflowDefinition,
  type WorkflowParallelGroup,
} from "@proliferate/product-domain/workflows/definition";
import {
  cloneStepWithNewId,
  ensureDefinitionIds,
  findStepById,
  laneIndexById,
  nodeIdAt,
  spineEntryIndexById,
} from "./drag-identity";

function baseDefinition(): WorkflowDefinition {
  return {
    version: 1,
    inputs: [],
    integrations: [],
    agents: [
      {
        slot: "intake",
        harness: "claude",
        model: "haiku",
        steps: [
          { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "a" },
          { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "b" },
        ],
      },
      {
        parallel: [
          {
            slot: "review_a",
            harness: "claude",
            model: "haiku",
            steps: [
              { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "ra1" },
              { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "ra2" },
            ],
          },
          {
            slot: "review_b",
            harness: "claude",
            model: "haiku",
            steps: [{ kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "rb1" }],
          },
        ],
      },
    ],
  };
}

describe("drag-identity (WS9b item 4)", () => {
  it("ensureDefinitionIds mints stable ids for every slot/node/group/lane/step", () => {
    const withIds = ensureDefinitionIds(baseDefinition());
    const node = withIds.agents[0] as WorkflowAgentNode;
    expect(node.id).toBeTruthy();
    expect(node.slotId).toBeTruthy();
    expect(node.steps.every((s) => typeof s.id === "string")).toBe(true);
    const group = withIds.agents[1] as WorkflowParallelGroup;
    expect(group.id).toBeTruthy();
    expect(group.parallel.every((lane) => typeof lane.id === "string")).toBe(true);
  });

  it("preserves existing ids and only fills gaps (idempotent)", () => {
    const once = ensureDefinitionIds(baseDefinition());
    const twice = ensureDefinitionIds(once);
    expect(twice).toEqual(once);
  });

  it("cloneStepWithNewId gives the clone a fresh id", () => {
    const withIds = ensureDefinitionIds(baseDefinition());
    const step = (withIds.agents[0] as WorkflowAgentNode).steps[0]!;
    const clone = cloneStepWithNewId(step);
    expect(clone.id).toBeTruthy();
    expect(clone.id).not.toBe(step.id);
  });

  it("resolves a step id to its current address/index and node id", () => {
    const def = ensureDefinitionIds(baseDefinition());
    const laneA = (def.agents[1] as WorkflowParallelGroup).parallel[0]!;
    const targetStep = laneA.steps[1]!;
    const found = findStepById(def, targetStep.id!);
    expect(found).not.toBeNull();
    expect(found!.address).toEqual({ spineIndex: 1, lane: "review_a" });
    expect(found!.stepIndex).toBe(1);
    expect(found!.nodeId).toBe(laneA.id);
  });

  // THE ACCEPTANCE: renaming a lane label mid-drag must not mis-target the drop.
  it("a lane rename mid-drag still resolves the drop to the right node", () => {
    const def = ensureDefinitionIds(baseDefinition());
    const laneA = (def.agents[1] as WorkflowParallelGroup).parallel[0]!;
    // Capture the drag handle at drag-start time (id, not index/slot).
    const draggedStepId = laneA.steps[0]!.id!;

    // Mid-drag, the user renames lane "review_a" -> "renamed_a". Ids are stable;
    // only the editable slot label changes.
    const renamed: WorkflowDefinition = {
      ...def,
      agents: def.agents.map((entry) => {
        if (!isParallelGroup(entry)) return entry;
        return {
          ...entry,
          parallel: entry.parallel.map((lane) =>
            lane.id === laneA.id ? { ...lane, slot: "renamed_a" } : lane,
          ),
        };
      }),
    };

    // Drop lands on the same lane's second step. Resolve BOTH ends by id against
    // the CURRENT (renamed) definition.
    const source = findStepById(renamed, draggedStepId)!;
    const renamedLaneAddress = { spineIndex: 1, lane: "renamed_a" };
    const targetNodeId = nodeIdAt(renamed, renamedLaneAddress);

    // The source resolves to the renamed lane (not the stale "review_a"), and the
    // drop-guard (same node) holds — so the reorder targets the correct node.
    expect(source.address.lane).toBe("renamed_a");
    expect(source.nodeId).toBe(laneA.id);
    expect(targetNodeId).toBe(laneA.id);
    expect(source.nodeId).toBe(targetNodeId);

    // A stale slot-name lookup ("review_a") would resolve to nothing after the
    // rename — proving the index/label approach would have mis-fired.
    expect(nodeIdAt(renamed, { spineIndex: 1, lane: "review_a" })).toBeUndefined();
  });

  it("spineEntryIndexById / laneIndexById survive a reorder", () => {
    const def = ensureDefinitionIds(baseDefinition());
    const groupId = def.agents[1]!.id!;
    const nodeId = def.agents[0]!.id!;
    // Reorder the two spine entries.
    const reordered: WorkflowDefinition = { ...def, agents: [def.agents[1]!, def.agents[0]!] };
    expect(spineEntryIndexById(reordered, groupId)).toBe(0);
    expect(spineEntryIndexById(reordered, nodeId)).toBe(1);
    const laneBId = (def.agents[1] as WorkflowParallelGroup).parallel[1]!.id!;
    expect(laneIndexById(reordered, 0, laneBId)).toBe(1);
  });
});
