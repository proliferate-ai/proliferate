import { describe, expect, it } from "vitest";

import {
  isParallelGroup,
  parseWorkflowDefinition,
  serializeWorkflowDefinition,
  type WorkflowAgentNode,
  type WorkflowDefinition,
} from "./definition";
import { validateWorkflowDefinition } from "./validation";
import {
  addLaneToGroup,
  getSpineNode,
  nextAgentSlot,
  parallelizeSpineEntry,
  removeLaneFromGroup,
  removeSpineEntry,
  withSpineNode,
} from "./spine-editing";

function node(slot: string): WorkflowAgentNode {
  return { slot, harness: "claude", model: "sonnet", steps: [] };
}

function flatDefinition(): WorkflowDefinition {
  return {
    version: 1,
    inputs: [],
    integrations: [],
    agents: [node("triage"), node("fix")],
  };
}

describe("spine-editing: addressing", () => {
  it("resolves a standalone node by lane '-' and a lane node by slot", () => {
    const agents = [
      node("triage"),
      { parallel: [node("review-a"), node("review-b")] },
    ];
    expect(getSpineNode(agents, { spineIndex: 0, lane: "-" })?.slot).toBe("triage");
    expect(getSpineNode(agents, { spineIndex: 1, lane: "review-b" })?.slot).toBe("review-b");
    expect(getSpineNode(agents, { spineIndex: 1, lane: "-" })).toBeNull();
    expect(getSpineNode(agents, { spineIndex: 5, lane: "-" })).toBeNull();
  });

  it("withSpineNode patches only the addressed node", () => {
    const agents = [node("triage"), { parallel: [node("a"), node("b")] }];
    const next = withSpineNode(agents, { spineIndex: 1, lane: "b" }, (n) => ({ ...n, model: "opus" }));
    expect(isParallelGroup(next[1]!) && next[1]!.parallel.map((n) => n.model)).toEqual(["sonnet", "opus"]);
    expect(next[0]).toEqual(node("triage"));
  });

  it("nextAgentSlot counts every node across standalone entries and lanes", () => {
    const agents = [node("agent_1"), { parallel: [node("agent_2"), node("agent_3")] }];
    expect(nextAgentSlot(agents)).toBe("agent_4");
  });
});

describe("spine-editing: parallelize / add / remove lanes (D-031a)", () => {
  it("wraps a standalone node into a 2-lane group", () => {
    const agents = [node("triage"), node("fix")];
    const next = parallelizeSpineEntry(agents, 1, node("fix_2"));
    expect(next).toHaveLength(2);
    expect(isParallelGroup(next[1]!) && next[1]!.parallel.map((n) => n.slot)).toEqual(["fix", "fix_2"]);
  });

  it("is a no-op parallelizing an entry that's already a group", () => {
    const agents = [{ parallel: [node("a"), node("b")] }];
    const next = parallelizeSpineEntry(agents, 0, node("c"));
    expect(next).toEqual(agents);
  });

  it("adds a third lane to an existing group", () => {
    const agents = [{ parallel: [node("a"), node("b")] }];
    const next = addLaneToGroup(agents, 0, node("c"));
    expect(isParallelGroup(next[0]!) && next[0]!.parallel.map((n) => n.slot)).toEqual(["a", "b", "c"]);
  });

  it("removes a lane, keeping the group when 2+ lanes remain", () => {
    const agents = [{ parallel: [node("a"), node("b"), node("c")] }];
    const next = removeLaneFromGroup(agents, 0, "b");
    expect(isParallelGroup(next[0]!) && next[0]!.parallel.map((n) => n.slot)).toEqual(["a", "c"]);
  });

  it("dissolves the group back into a standalone node at 1 remaining lane", () => {
    const agents = [node("triage"), { parallel: [node("a"), node("b") ] }];
    const next = removeLaneFromGroup(agents, 1, "b");
    expect(isParallelGroup(next[1]!)).toBe(false);
    expect(next[1]).toEqual(node("a"));
  });

  it("removeSpineEntry deletes a whole standalone node or an entire group", () => {
    const agents = [node("triage"), { parallel: [node("a"), node("b")] }, node("ship")];
    expect(removeSpineEntry(agents, 1)).toEqual([node("triage"), node("ship")]);
  });
});

describe("spine-editing: round-trips through parse/serialize + the phase-1 validator", () => {
  it("a flat definition mutated through these helpers stays valid and round-trips", () => {
    const definition = flatDefinition();
    const mutated: WorkflowDefinition = {
      ...definition,
      agents: withSpineNode(definition.agents, { spineIndex: 0, lane: "-" }, (n) => ({
        ...n,
        model: "opus",
      })),
    };
    const wire = serializeWorkflowDefinition(mutated);
    const reparsed = parseWorkflowDefinition(wire);
    expect(reparsed).toEqual(mutated);
    expect(validateWorkflowDefinition(reparsed)).toEqual([]);
  });

  it("parallelizing a node produces a definition the validator accepts and that round-trips", () => {
    const definition = flatDefinition();
    const agents = parallelizeSpineEntry(definition.agents, 1, node("fix_2"));
    const mutated: WorkflowDefinition = { ...definition, agents };
    const wire = serializeWorkflowDefinition(mutated);
    const reparsed = parseWorkflowDefinition(wire);
    expect(reparsed).toEqual(mutated);
    expect(validateWorkflowDefinition(reparsed)).toEqual([]);
  });

  it("dissolving a group back to one lane round-trips byte-identical to a never-parallelized flat definition", () => {
    const definition = flatDefinition();
    const grouped = parallelizeSpineEntry(definition.agents, 1, node("fix_2"));
    const dissolved = removeLaneFromGroup(grouped, 1, "fix_2");
    expect(dissolved).toEqual(definition.agents);
    expect(serializeWorkflowDefinition({ ...definition, agents: dissolved })).toEqual(
      serializeWorkflowDefinition(definition),
    );
  });
});
