import { describe, expect, it } from "vitest";
import type { WorkflowDefinitionV2 } from "@proliferate/cloud-sdk";
import {
  DOC_SLUG_PATTERN,
  INPUT_NAME_PATTERN,
} from "#product/domain/workflows/definition-v2";
import {
  normalizeDocSlugInput,
  workflowBuilderIssues,
} from "#product/lib/domain/workflows/workflow-builder-validation";

describe("workflowBuilderIssues declaration grammar", () => {
  it("reports a declared input name the wire grammar would refuse", () => {
    const issues = workflowBuilderIssues(definition({
      inputs: [
        { name: "goal", description: "", required: true },
        { name: "my input", description: "", required: true },
      ],
    }));

    // Attributed to the offending row, not to the collection: the panel puts
    // the message against the field the author has to change.
    expect(issues).toEqual([{
      code: "invalid_input_name",
      message:
        "Input name “my input” must start with a letter and use only letters, digits, "
        + "and underscores.",
      ref: "my input",
      index: 1,
    }]);
  });

  it("reports a declared doc slug the wire grammar would refuse", () => {
    const issues = workflowBuilderIssues(definition({
      docTemplates: [{ slug: "my_doc", producingNodeId: "step-1", body: "" }],
    }));

    expect(issues.map((issue) => [issue.code, issue.index])).toEqual([["invalid_doc_slug", 0]]);
    expect(issues[0].message).toContain("lowercase kebab-case");
  });

  it("names an unnamed declaration by position rather than by grammar", () => {
    const issues = workflowBuilderIssues(definition({
      inputs: [{ name: "", description: "", required: true }],
      docTemplates: [{ slug: "", producingNodeId: "step-1", body: "" }],
    }));

    expect(issues.map((issue) => issue.message)).toEqual([
      "Input 1 needs a name.",
      "Document 1 needs a slug.",
    ]);
  });

  it("accepts declarations the shared patterns accept, and carries the validator's own issues", () => {
    // Negative control for the two tests above: the same shapes, with values
    // the imported patterns admit, produce nothing — so the issues there come
    // from the grammar and not from merely having inputs or documents.
    expect(INPUT_NAME_PATTERN.test("Topic_2")).toBe(true);
    expect(DOC_SLUG_PATTERN.test("research-findings")).toBe(true);
    expect(workflowBuilderIssues(definition({
      inputs: [{ name: "Topic_2", description: "", required: false }],
      docTemplates: [{ slug: "research-findings", producingNodeId: "step-1", body: "" }],
    }))).toEqual([]);

    // The validator's own rules still run through the same call.
    expect(workflowBuilderIssues(definition({
      nodes: [{ id: "step-1", type: "agent", title: "", prompt: "Write @doc:plan.md" }],
    })).map((issue) => issue.code)).toEqual(["malformed_reference"]);
  });
});

describe("normalizeDocSlugInput", () => {
  it("folds only what the slug grammar can never accept", () => {
    expect(normalizeDocSlugInput("  Research-Findings ")).toBe("research-findings");
    expect(DOC_SLUG_PATTERN.test(normalizeDocSlugInput("  Research-Findings "))).toBe(true);
  });

  it("leaves a value it cannot rescue alone so the error can be shown", () => {
    // Underscores, inner spaces and trailing dashes are NOT guessed at: a
    // rewritten slug would be a document no prompt references.
    expect(normalizeDocSlugInput("my_doc")).toBe("my_doc");
    expect(normalizeDocSlugInput("My Doc")).toBe("my doc");
    expect(normalizeDocSlugInput("plan-")).toBe("plan-");
  });
});

function definition(overrides: Partial<WorkflowDefinitionV2> = {}): WorkflowDefinitionV2 {
  return {
    schemaVersion: 2,
    nodes: [{ id: "step-1", type: "agent", title: "", prompt: "" }],
    edges: [],
    inputs: [],
    docTemplates: [],
    ...overrides,
  };
}
