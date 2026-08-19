import { describe, expect, it } from "vitest";
import type { WorkflowDefinitionV2, WorkflowNodeV2 } from "@proliferate/cloud-sdk";
import v2FullFixture from "../../../../../../fixtures/contracts/workflow-definition/v2-full.json";
import {
  definitionHeadId,
  orderedNodes,
  validateDefinitionV2,
  type WorkflowDefinitionV2WithLegs,
} from "./definition-v2";

// Structural validation. The reference-grammar cases live in
// `definition-v2-references.test.ts`.

function node(overrides: Partial<WorkflowNodeV2> & { id: string }): WorkflowNodeV2 {
  return {
    type: "agent",
    title: overrides.id,
    prompt: "",
    ...overrides,
  };
}

describe("validateDefinitionV2", () => {
  function linearDef(overrides: Partial<WorkflowDefinitionV2> = {}): WorkflowDefinitionV2 {
    return {
      schemaVersion: 2,
      nodes: [
        node({ id: "a", prompt: "Investigate @input:ticket and produce @doc:findings" }),
        node({
          id: "b",
          type: "human_in_loop",
          prompt: "Review @doc:findings for @input:ticket",
        }),
      ],
      edges: [{ from: "a", to: "b" }],
      inputs: [{ name: "ticket", description: "Ticket id", required: true }],
      docTemplates: [{ slug: "findings", producingNodeId: "a", body: "Summary of findings." }],
      ...overrides,
    };
  }

  it("accepts a full valid exemplar: two nodes, one edge, one input, one doc template", () => {
    expect(validateDefinitionV2(linearDef())).toEqual([]);
  });

  it("flags empty_nodes only, for a definition with no nodes", () => {
    const def: WorkflowDefinitionV2 = {
      schemaVersion: 2,
      nodes: [],
      edges: [],
      inputs: [],
      docTemplates: [],
    };
    expect(validateDefinitionV2(def)).toEqual([
      { code: "empty_nodes", message: "Add at least one node." },
    ]);
  });

  it("flags dangling_edge only, for a single node whose edge targets a missing node", () => {
    const def: WorkflowDefinitionV2 = {
      schemaVersion: 2,
      nodes: [node({ id: "a" })],
      edges: [{ from: "a", to: "ghost" }],
      inputs: [],
      docTemplates: [],
    };
    const issues = validateDefinitionV2(def);
    expect(issues).toEqual([
      {
        code: "dangling_edge",
        message: "Edge references unknown target node “ghost”.",
        ref: "ghost",
      },
    ]);
  });

  it("flags not_linear only, for a branch (one node with two outgoing edges)", () => {
    const def: WorkflowDefinitionV2 = {
      schemaVersion: 2,
      nodes: [node({ id: "a" }), node({ id: "b" }), node({ id: "c" })],
      edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }],
      inputs: [],
      docTemplates: [],
    };
    expect(validateDefinitionV2(def)).toEqual([
      {
        code: "not_linear",
        message: "Nodes and edges must form exactly one linear path covering every node.",
      },
    ]);
  });

  it("flags not_linear for a cycle", () => {
    const def: WorkflowDefinitionV2 = {
      schemaVersion: 2,
      nodes: [node({ id: "a" }), node({ id: "b" }), node({ id: "c" })],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }],
      inputs: [],
      docTemplates: [],
    };
    expect(validateDefinitionV2(def).map((issue) => issue.code)).toEqual(["not_linear"]);
  });

  it("flags not_linear for two disjoint chains", () => {
    const def: WorkflowDefinitionV2 = {
      schemaVersion: 2,
      nodes: [node({ id: "a" }), node({ id: "b" }), node({ id: "c" }), node({ id: "d" })],
      edges: [{ from: "a", to: "b" }, { from: "c", to: "d" }],
      inputs: [],
      docTemplates: [],
    };
    expect(validateDefinitionV2(def).map((issue) => issue.code)).toEqual(["not_linear"]);
  });

  it("flags not_linear for a valid node coexisting with a disconnected cycle", () => {
    // Every node still has in/out-degree <= 1, and there is exactly one head
    // and one tail overall (node "a"), so this exercises the coverage check
    // beyond the simple degree/head/tail counts.
    const def: WorkflowDefinitionV2 = {
      schemaVersion: 2,
      nodes: [node({ id: "a" }), node({ id: "b" }), node({ id: "c" }), node({ id: "d" })],
      edges: [{ from: "b", to: "c" }, { from: "c", to: "d" }, { from: "d", to: "b" }],
      inputs: [],
      docTemplates: [],
    };
    expect(validateDefinitionV2(def).map((issue) => issue.code)).toEqual(["not_linear"]);
  });

  it("treats a single node with zero edges as valid", () => {
    const def: WorkflowDefinitionV2 = {
      schemaVersion: 2,
      nodes: [node({ id: "a" })],
      edges: [],
      inputs: [],
      docTemplates: [],
    };
    expect(validateDefinitionV2(def)).toEqual([]);
  });

  it("flags duplicate_node_id only, for two nodes sharing an id in an otherwise-linear graph", () => {
    const def: WorkflowDefinitionV2 = {
      schemaVersion: 2,
      nodes: [node({ id: "a" }), node({ id: "a" }), node({ id: "b" })],
      edges: [{ from: "a", to: "b" }],
      inputs: [],
      docTemplates: [],
    };
    expect(validateDefinitionV2(def)).toEqual([
      {
        code: "duplicate_node_id",
        message: "Node id “a” is used 2 times; node ids must be unique.",
        nodeId: "a",
      },
    ]);
  });

  it("flags duplicate_doc_slug only, for two doc templates sharing a slug", () => {
    const def = linearDef({
      docTemplates: [
        { slug: "findings", producingNodeId: "a", body: "First." },
        { slug: "findings", producingNodeId: "b", body: "Second." },
      ],
      nodes: [
        node({ id: "a", prompt: "Investigate @input:ticket" }),
        node({ id: "b", type: "human_in_loop", prompt: "Review @input:ticket" }),
      ],
    });
    expect(validateDefinitionV2(def)).toEqual([
      {
        code: "duplicate_doc_slug",
        message: "Doc template slug “findings” is used 2 times; slugs must be unique.",
        ref: "findings",
      },
    ]);
  });

  it("flags unknown_input_ref only, for a prompt referencing an undeclared input", () => {
    const def = linearDef({
      inputs: [],
      docTemplates: [],
      nodes: [
        node({ id: "a", prompt: "Investigate @input:missing" }),
        node({ id: "b", type: "human_in_loop", prompt: "Review it" }),
      ],
    });
    expect(validateDefinitionV2(def)).toEqual([
      {
        code: "unknown_input_ref",
        message: "Node “a” prompt references unknown input “@input:missing”.",
        nodeId: "a",
        ref: "missing",
      },
    ]);
  });

  it("flags unknown_doc_ref only, for a prompt referencing an undeclared doc template", () => {
    const def = linearDef({
      inputs: [],
      docTemplates: [],
      nodes: [
        node({ id: "a", prompt: "Investigate the issue" }),
        node({ id: "b", type: "human_in_loop", prompt: "Review @doc:missing-notes" }),
      ],
    });
    expect(validateDefinitionV2(def)).toEqual([
      {
        code: "unknown_doc_ref",
        message: "Node “b” prompt references unknown doc template “@doc:missing-notes”.",
        nodeId: "b",
        ref: "missing-notes",
      },
    ]);
  });

  it("flags duplicate_input_name only, attributed to the repeated declaration's index", () => {
    // Mirrors fixtures/contracts/workflow-definition/v2-invalid-duplicate-input-name.json,
    // whose expectedIssuePath is `inputs.1.name` — the second `topic`.
    const def = linearDef({
      inputs: [
        { name: "topic", description: "First", required: true },
        { name: "topic", description: "Second", required: false },
      ],
      docTemplates: [],
      nodes: [
        node({ id: "a", prompt: "Investigate @input:topic" }),
        node({ id: "b", type: "human_in_loop", prompt: "Review @input:topic" }),
      ],
    });
    expect(validateDefinitionV2(def)).toEqual([
      {
        code: "duplicate_input_name",
        message: "Input name “topic” is already declared; input names must be unique.",
        ref: "topic",
        index: 1,
      },
    ]);
  });

  it("flags malformed_reference only, for a mis-cased sigil that would never substitute", () => {
    const def = linearDef({
      inputs: [{ name: "topic", description: "", required: true }],
      docTemplates: [],
      nodes: [
        node({ id: "a", prompt: "Investigate @INPUT:topic" }),
        node({ id: "b", type: "human_in_loop", prompt: "Review it" }),
      ],
    });
    expect(validateDefinitionV2(def)).toEqual([
      {
        code: "malformed_reference",
        message:
          "Node “a” prompt has a malformed reference “@INPUT:topic”: " +
          "the sigil must be lowercase “@input:”.",
        nodeId: "a",
        ref: "@INPUT:topic",
      },
    ]);
  });

  it("flags malformed_reference, not unknown_doc_ref, for a doc slug outside the grammar", () => {
    const def = linearDef({
      inputs: [],
      docTemplates: [],
      nodes: [
        node({ id: "a", prompt: "Write @doc:my_doc" }),
        node({ id: "b", type: "human_in_loop", prompt: "Open @doc:plan.md" }),
      ],
    });
    expect(validateDefinitionV2(def)).toEqual([
      {
        code: "malformed_reference",
        message:
          "Node “a” prompt has a malformed reference “@doc:my_doc”: " +
          "doc slug “my_doc” must be lowercase kebab-case: letters and digits " +
          "joined by single dashes.",
        nodeId: "a",
        ref: "@doc:my_doc",
      },
      {
        code: "malformed_reference",
        message:
          "Node “b” prompt has a malformed reference “@doc:plan.md”: " +
          "doc slug “plan.md” must be lowercase kebab-case: letters and digits " +
          "joined by single dashes.",
        nodeId: "b",
        ref: "@doc:plan.md",
      },
    ]);
  });

  it("accepts a mixed-case underscored input name and a kebab-case doc slug", () => {
    const def = linearDef({
      inputs: [{ name: "Topic_2", description: "", required: true }],
      docTemplates: [
        { slug: "research-findings", producingNodeId: "a", body: "" },
      ],
      nodes: [
        node({ id: "a", prompt: "Research @input:Topic_2 into @doc:research-findings." }),
        node({ id: "b", type: "human_in_loop", prompt: "Review @doc:research-findings." }),
      ],
    });
    expect(validateDefinitionV2(def)).toEqual([]);
  });

  it("accepts the valid contract exemplar verbatim (three-plane lockstep)", () => {
    // fixtures/contracts/workflow-definition/v2-full.json is the definition
    // every plane must accept; the CP and Rust suites consume it too. The
    // trailing full stops in its prompts are the load-bearing part — a scan
    // that took every non-space character as the token would read
    // `research-findings.` as a malformed slug and reject a definition the
    // other two planes accept.
    const def = v2FullFixture.definition as WorkflowDefinitionV2;
    expect(validateDefinitionV2(def)).toEqual([]);
  });

  it("flags invalid_node_id for a node id outside the node-id grammar", () => {
    const def: WorkflowDefinitionV2 = {
      schemaVersion: 2,
      nodes: [node({ id: "1st" })],
      edges: [],
      inputs: [],
      docTemplates: [],
    };
    expect(validateDefinitionV2(def)).toEqual([
      {
        code: "invalid_node_id",
        message:
          "Node id “1st” must start with a letter and use only letters, digits, " +
          "underscores, and dashes.",
        nodeId: "1st",
      },
    ]);
  });

  it("accepts a node id with underscores and dashes", () => {
    const def: WorkflowDefinitionV2 = {
      schemaVersion: 2,
      nodes: [node({ id: "n_research-2" })],
      edges: [],
      inputs: [],
      docTemplates: [],
    };
    expect(validateDefinitionV2(def)).toEqual([]);
  });

  it("flags unknown_producing_node only, for a doc template naming a node that doesn't exist", () => {
    const def = linearDef({
      inputs: [],
      docTemplates: [{ slug: "findings", producingNodeId: "ghost", body: "Summary." }],
      nodes: [
        node({ id: "a", prompt: "Investigate the issue" }),
        node({ id: "b", type: "human_in_loop", prompt: "Review it" }),
      ],
    });
    expect(validateDefinitionV2(def)).toEqual([
      {
        code: "unknown_producing_node",
        message: "Doc template “findings” references unknown producing node “ghost”.",
        ref: "ghost",
      },
    ]);
  });
});

describe("orderedNodes", () => {
  it("returns nodes in chain order regardless of their array order", () => {
    const nodeA = node({ id: "a" });
    const nodeB = node({ id: "b" });
    const nodeC = node({ id: "c" });
    const def: WorkflowDefinitionV2 = {
      schemaVersion: 2,
      // Shuffled: array order is b, c, a but the chain is c -> a -> b.
      nodes: [nodeB, nodeC, nodeA],
      edges: [{ from: "c", to: "a" }, { from: "a", to: "b" }],
      inputs: [],
      docTemplates: [],
    };
    expect(orderedNodes(def)).toEqual([nodeC, nodeA, nodeB]);
  });

  it("returns a single node's own chain of one", () => {
    const solo = node({ id: "solo" });
    const def: WorkflowDefinitionV2 = {
      schemaVersion: 2,
      nodes: [solo],
      edges: [],
      inputs: [],
      docTemplates: [],
    };
    expect(orderedNodes(def)).toEqual([solo]);
  });

  it("returns an empty array for an invalid (non-linear) graph", () => {
    const def: WorkflowDefinitionV2 = {
      schemaVersion: 2,
      nodes: [node({ id: "a" }), node({ id: "b" }), node({ id: "c" })],
      edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }],
      inputs: [],
      docTemplates: [],
    };
    expect(orderedNodes(def)).toEqual([]);
  });
});

describe("definitionHeadId", () => {
  function graph(
    nodeIds: string[],
    edges: { from: string; to: string }[],
  ): WorkflowDefinitionV2 {
    return {
      schemaVersion: 2,
      nodes: nodeIds.map((id) => node({ id })),
      edges,
      inputs: [],
      docTemplates: [],
    };
  }

  it("names the one node no edge points at, whatever the array order", () => {
    expect(definitionHeadId(graph(["b", "c", "a"], [
      { from: "c", to: "a" },
      { from: "a", to: "b" },
    ]))).toBe("c");
  });

  it("names a lone node with no edges at all", () => {
    expect(definitionHeadId(graph(["solo"], []))).toBe("solo");
  });

  it("answers null when more than one node could be the head", () => {
    expect(definitionHeadId(graph(["a", "b", "c"], [{ from: "a", to: "c" }]))).toBeNull();
  });

  it("answers null for a cycle, which has no head, and for an empty graph", () => {
    expect(definitionHeadId(graph(["a", "b"], [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ]))).toBeNull();
    expect(definitionHeadId(graph([], []))).toBeNull();
  });
});

describe("validateDefinitionV2: node legs (ruling F5)", () => {
  function legsDef(
    legs: { prompt: string }[] | undefined,
    promptOverride?: string,
  ): WorkflowDefinitionV2WithLegs {
    return {
      schemaVersion: 2,
      nodes: [
        {
          id: "a",
          type: "agent",
          title: "Review",
          prompt: promptOverride ?? legs?.[0]?.prompt ?? "Solo prompt",
          ...(legs ? { legs } : {}),
        },
      ],
      edges: [],
      inputs: [],
      docTemplates: [],
    };
  }

  it("accepts a node with no legs (today's behavior, unchanged)", () => {
    expect(validateDefinitionV2(legsDef(undefined))).toEqual([]);
  });

  it("accepts a valid 2-leg node whose prompt equals legs[0].prompt", () => {
    const def = legsDef([{ prompt: "Correctness review" }, { prompt: "Security review" }]);
    expect(validateDefinitionV2(def)).toEqual([]);
  });

  it("rejects a single-leg list", () => {
    const def = legsDef([{ prompt: "Solo prompt" }]);
    const issues = validateDefinitionV2(def);
    expect(issues.some((issue) => issue.code === "invalid_leg_count")).toBe(true);
  });

  it("rejects 9 legs", () => {
    const legs = Array.from({ length: 9 }, (_, i) => ({ prompt: `Leg ${i}` }));
    const def = legsDef(legs, "Leg 0");
    const issues = validateDefinitionV2(def);
    expect(issues.some((issue) => issue.code === "invalid_leg_count")).toBe(true);
  });

  it("rejects a blank leg prompt", () => {
    const def = legsDef([{ prompt: "Leg 0" }, { prompt: "   " }], "Leg 0");
    const issues = validateDefinitionV2(def);
    expect(issues.some((issue) => issue.code === "blank_leg_prompt" && issue.index === 1))
      .toBe(true);
  });

  it("rejects a prompt/legs[0] mismatch", () => {
    const def = legsDef([{ prompt: "Leg 0" }, { prompt: "Leg 1" }], "Not leg 0");
    const issues = validateDefinitionV2(def);
    expect(issues.some((issue) => issue.code === "leg_prompt_mismatch")).toBe(true);
  });

  it("scans each leg's prompt for @input:/@doc: references independently", () => {
    const def: WorkflowDefinitionV2WithLegs = {
      schemaVersion: 2,
      nodes: [
        {
          id: "a",
          type: "agent",
          title: "Review",
          prompt: "Research @input:topic",
          legs: [
            { prompt: "Research @input:topic" },
            { prompt: "Research @input:missing" },
          ],
        },
      ],
      edges: [],
      inputs: [{ name: "topic", description: "", required: true }],
      docTemplates: [],
    };
    const issues = validateDefinitionV2(def);
    const unknownRefIssue = issues.find((issue) => issue.code === "unknown_input_ref");
    expect(unknownRefIssue).toBeDefined();
    expect(unknownRefIssue?.index).toBe(1);
  });
});
