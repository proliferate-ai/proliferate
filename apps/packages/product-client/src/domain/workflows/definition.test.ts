import { describe, expect, it } from "vitest";
import fullFixture from "../../../../../../fixtures/contracts/workflow-definition/full.json";
import minimalFixture from "../../../../../../fixtures/contracts/workflow-definition/minimal.json";
import v2FullFixture from "../../../../../../fixtures/contracts/workflow-definition/v2-full.json";
import {
  workflowDefinitionFromResponse,
  type WorkflowDefinition,
} from "./definition";

describe("workflow definition draft", () => {
  it.each([
    ["minimal", minimalFixture],
    ["full", fullFixture],
  ])("consumes the %s cross-language response fixture", (_name, rawFixture) => {
    const definition = rawFixture as unknown as WorkflowDefinition;

    expect(Object.keys(rawFixture).sort()).toEqual([
      "createdAt",
      "defaultRepoConfigId",
      "deletedAt",
      "description",
      "id",
      "inputs",
      "revision",
      "schemaVersion",
      "stages",
      "title",
      "updatedAt",
      "userId",
      "validatedCatalogVersion",
    ].sort());
    expect(definition.schemaVersion).toBe(1);
    expect(definition.revision).toBeGreaterThan(0);
    expect(definition.validatedCatalogVersion).toBeTruthy();
  });
});

describe("gen-2 rows on the shared endpoints", () => {
  it("maps a v1 response and skips a v2 response instead of crashing", () => {
    const v1 = workflowDefinitionFromResponse(
      fullFixture as unknown as Parameters<typeof workflowDefinitionFromResponse>[0],
    );
    expect(v1?.schemaVersion).toBe(1);

    // A gen-2 row has schemaVersion 2 and no stages key at all; before the
    // guard this mapper threw on response.stages.map and white-screened the
    // Workflows page.
    const v2 = workflowDefinitionFromResponse(
      v2FullFixture as unknown as Parameters<typeof workflowDefinitionFromResponse>[0],
    );
    expect(v2).toBeNull();
  });
});
