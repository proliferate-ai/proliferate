import { describe, expect, it } from "vitest";
import {
  orderedNodes,
  validateDefinitionV2,
} from "#product/domain/workflows/definition-v2";
import { WORKFLOW_STARTER_TEMPLATES_V2 } from "#product/config/workflows/starter-templates";

const PR_REVIEW_AND_MERGE = WORKFLOW_STARTER_TEMPLATES_V2.find(
  (template) => template.slug === "pr-review-and-merge",
);

if (!PR_REVIEW_AND_MERGE) {
  throw new Error("PR review and merge starter template is missing");
}

describe("WORKFLOW_STARTER_TEMPLATES_V2", () => {
  it("has unique slugs", () => {
    const slugs = WORKFLOW_STARTER_TEMPLATES_V2.map((template) => template.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it.each(WORKFLOW_STARTER_TEMPLATES_V2.map((template) => [template.slug, template] as const))(
    "%s instantiates validateDefinitionV2-clean",
    (_slug, template) => {
      expect(validateDefinitionV2(template.definition)).toEqual([]);
    },
  );

  it.each(WORKFLOW_STARTER_TEMPLATES_V2.map((template) => [template.slug, template] as const))(
    "%s is one linear chain in authored order",
    (_slug, template) => {
      expect(orderedNodes(template.definition).map((node) => node.id)).toEqual(
        template.definition.nodes.map((node) => node.id),
      );
    },
  );

  // Negative control: prove the validator actually sees these definitions —
  // a corrupted copy must produce issues, or the clean assertions above are
  // vacuous.
  it("rejects a corrupted copy of a template", () => {
    const [flagship] = WORKFLOW_STARTER_TEMPLATES_V2;
    const corrupted = {
      ...flagship.definition,
      nodes: flagship.definition.nodes.map((node, index) =>
        index === 0
          ? { ...node, prompt: `${node.prompt} and also @doc:does-not-exist` }
          : node,
      ),
    };
    expect(validateDefinitionV2(corrupted)).not.toEqual([]);
  });

  it("keeps human approval immediately before the guarded merge", () => {
    expect(
      PR_REVIEW_AND_MERGE.definition.nodes.map(({ id, type }) => ({ id, type })),
    ).toEqual([
      { id: "prepare-pull-request", type: "agent" },
      { id: "review-pull-request", type: "agent" },
      { id: "address-review", type: "agent" },
      { id: "prove-merge-readiness", type: "agent" },
      { id: "approve-merge", type: "human_in_loop" },
      { id: "merge-pull-request", type: "agent" },
    ]);
    expect(PR_REVIEW_AND_MERGE.definition.edges.at(-1)).toEqual({
      from: "approve-merge",
      to: "merge-pull-request",
    });
  });

  it("carries the review, repair, readiness, and merge receipts as context docs", () => {
    expect(PR_REVIEW_AND_MERGE.definition.docTemplates.map((doc) => doc.slug)).toEqual([
      "delivery-record",
      "review-findings",
      "review-resolution",
      "merge-readiness",
      "merge-receipt",
    ]);
    for (const doc of PR_REVIEW_AND_MERGE.definition.docTemplates) {
      expect(doc.body.trim()).not.toBe("");
    }
  });

  it("pins the final readiness gate to exact-head evidence without merging early", () => {
    const readiness = PR_REVIEW_AND_MERGE.definition.nodes.find(
      (node) => node.id === "prove-merge-readiness",
    );
    const merge = PR_REVIEW_AND_MERGE.definition.nodes.find(
      (node) => node.id === "merge-pull-request",
    );

    expect(readiness?.prompt).toContain("same final head");
    expect(readiness?.prompt).toContain("maximum `5/5` score");
    expect(readiness?.prompt).toContain("Never replace a missing gate with self-attestation");
    expect(readiness?.prompt).toContain("Do not merge");
    expect(merge?.prompt).toContain("Immediately before merging");
    expect(merge?.prompt).toContain("Do not make semantic fixes after approval");
  });
});
