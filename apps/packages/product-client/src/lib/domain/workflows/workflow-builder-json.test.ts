import { describe, expect, it } from "vitest";
import type { WorkflowDefinitionV2 } from "@proliferate/cloud-sdk";
import {
  formatWorkflowDefinitionJson,
  parseWorkflowDefinitionJson,
} from "#product/lib/domain/workflows/workflow-builder-json";

const definition: WorkflowDefinitionV2 = {
  schemaVersion: 2,
  nodes: [
    { id: "first", type: "agent", title: "First", prompt: "Investigate." },
    { id: "second", type: "human_in_loop", title: "Second", prompt: "Review it." },
  ],
  edges: [{ from: "first", to: "second" }],
  inputs: [],
  docTemplates: [],
};

describe("workflow builder JSON", () => {
  it("round-trips the camelCase definition document without record-envelope fields", () => {
    const source = formatWorkflowDefinitionJson(definition);
    expect(source).toContain('"schemaVersion": 2');
    expect(Object.keys(JSON.parse(source))).toEqual([
      "schemaVersion", "nodes", "edges", "inputs", "docTemplates",
    ]);
    expect(parseWorkflowDefinitionJson(source)).toEqual({ ok: true, definition });
  });

  it("refuses malformed JSON without producing a partial definition", () => {
    expect(parseWorkflowDefinitionJson('{"schemaVersion": 2')).toEqual({
      ok: false,
      message: "JSON syntax is invalid.",
    });
  });

  it("refuses semantically invalid edges (negative control: edges cannot be ignored)", () => {
    const parsed = parseWorkflowDefinitionJson(JSON.stringify({ ...definition, edges: [] }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain("linear path");
  });

  it("refuses unknown fields at every authored object level", () => {
    expect(parseWorkflowDefinitionJson(JSON.stringify({ ...definition, title: "Envelope title" })).ok)
      .toBe(false);
    expect(parseWorkflowDefinitionJson(JSON.stringify({
      ...definition,
      nodes: [{ ...definition.nodes[0], effort: "high" }, definition.nodes[1]],
    })).ok).toBe(false);
  });
});
