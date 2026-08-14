import { describe, expect, it } from "vitest";
import type { WorkflowDefinitionV2, WorkflowNodeV2 } from "@proliferate/cloud-sdk";
import {
  collectPromptReferences,
  orderedNodes,
  parsePromptTokens,
  validateDefinitionV2,
} from "./definition-v2";

function node(overrides: Partial<WorkflowNodeV2> & { id: string }): WorkflowNodeV2 {
  return {
    type: "agent",
    title: overrides.id,
    prompt: "",
    ...overrides,
  };
}

describe("parsePromptTokens", () => {
  it("returns a single text token for a prompt with no sigils", () => {
    expect(parsePromptTokens("Investigate the ticket")).toEqual([
      { kind: "text", text: "Investigate the ticket" },
    ]);
  });

  it("parses back-to-back tokens with no text between them", () => {
    expect(parsePromptTokens("@input:a@doc:b")).toEqual([
      { kind: "input", name: "a", raw: "@input:a" },
      { kind: "doc", slug: "b", raw: "@doc:b" },
    ]);
  });

  it("parses a token at the very start of the prompt", () => {
    expect(parsePromptTokens("@input:ticket please investigate")).toEqual([
      { kind: "input", name: "ticket", raw: "@input:ticket" },
      { kind: "text", text: " please investigate" },
    ]);
  });

  it("parses a token at the very end of the prompt, with no trailing text segment", () => {
    expect(parsePromptTokens("please see @doc:notes")).toEqual([
      { kind: "text", text: "please see " },
      { kind: "doc", slug: "notes", raw: "@doc:notes" },
    ]);
  });

  it("ends a token at punctuation, keeping it as trailing text", () => {
    expect(parsePromptTokens("See @doc:research-findings.")).toEqual([
      { kind: "text", text: "See " },
      { kind: "doc", slug: "research-findings", raw: "@doc:research-findings" },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves an unknown sigil as plain text", () => {
    expect(parsePromptTokens("Contact @foo:bar for help")).toEqual([
      { kind: "text", text: "Contact @foo:bar for help" },
    ]);
  });

  it("leaves a bare sigil with no valid name/slug characters as plain text", () => {
    expect(parsePromptTokens("@input: nothing follows the colon")).toEqual([
      { kind: "text", text: "@input: nothing follows the colon" },
    ]);
  });

  it("matches the sigil word and the name/slug body case-insensitively while preserving raw casing", () => {
    expect(parsePromptTokens("@INPUT:Ticket-ID and @Doc:Notes")).toEqual([
      { kind: "input", name: "Ticket-ID", raw: "@INPUT:Ticket-ID" },
      { kind: "text", text: " and " },
      { kind: "doc", slug: "Notes", raw: "@Doc:Notes" },
    ]);
  });

  it("covers the whole string when segments are concatenated back together", () => {
    const prompt = "Resolve @input:ticket using @doc:runbook, then close it.";
    const tokens = parsePromptTokens(prompt);
    const reassembled = tokens.map((token) =>
      token.kind === "text" ? token.text : token.raw
    ).join("");
    expect(reassembled).toBe(prompt);
  });
});

describe("collectPromptReferences", () => {
  it("dedupes repeated references, preserving first-appearance order", () => {
    const prompt =
      "Resolve @input:ticket, check @doc:notes, then @input:ticket again, " +
      "consult @input:other and @doc:notes once more.";
    expect(collectPromptReferences(prompt)).toEqual({
      inputs: ["ticket", "other"],
      docs: ["notes"],
    });
  });

  it("returns empty arrays for a prompt with no references", () => {
    expect(collectPromptReferences("Just investigate the issue.")).toEqual({
      inputs: [],
      docs: [],
    });
  });
});

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
