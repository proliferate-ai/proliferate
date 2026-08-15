import { describe, expect, it } from "vitest";
import {
  orderedNodes,
  validateDefinitionV2,
} from "#product/domain/workflows/definition-v2";
import { WORKFLOW_STARTER_TEMPLATES_V2 } from "#product/config/workflows/starter-templates";

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
});
