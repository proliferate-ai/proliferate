import { describe, expect, expectTypeOf, it } from "vitest";

import fixture from "../../../fixtures/contracts/workflow-portable-execution/v1.json";
import type { components } from "./generated/openapi.js";

type PortableRequest = components["schemas"]["PutWorkflowRunRequestV2"];
type ModelSelection = components["schemas"]["WorkflowRunModelSelection"];

const exactSelection: ModelSelection = { kind: "exact", modelId: "sonnet" };

function assertPortableRequest(value: unknown): asserts value is PortableRequest {
  if (typeof value !== "object" || value === null) throw new Error("request object");
  const request = value as Record<string, unknown>;
  if (request.schemaVersion !== 2 || typeof request.workspaceId !== "string") {
    throw new Error("request header");
  }
  if (typeof request.definition !== "object" || request.definition === null) {
    throw new Error("definition");
  }
  const definition = request.definition as Record<string, unknown>;
  if (!Array.isArray(definition.inputs) || !Array.isArray(definition.stages)) {
    throw new Error("definition collections");
  }
  if (definition.stages.length !== 1) throw new Error("stage count");
  const stage = definition.stages[0] as Record<string, unknown>;
  const harness = stage.harnessConfig as Record<string, unknown>;
  const selection = harness.modelSelection as Record<string, unknown>;
  if (
    harness.permissionPolicy !== "workflowDefault"
    || selection.kind !== "exact"
    || typeof selection.modelId !== "string"
  ) {
    throw new Error("portable harness");
  }
  if (!Array.isArray(stage.steps) || stage.steps.length !== 1) {
    throw new Error("prompt step");
  }
  const step = stage.steps[0] as Record<string, unknown>;
  if (step.kind !== "agent.prompt" || typeof step.prompt !== "string") {
    throw new Error("prompt shape");
  }
  if (typeof request.arguments !== "object" || request.arguments === null) {
    throw new Error("arguments");
  }
}

describe("portable workflow contract fixture", () => {
  it("pins the exact-model generated type to required camelCase modelId", () => {
    expect(exactSelection).toEqual({ kind: "exact", modelId: "sonnet" });
  });

  it("parses as the generated schema-v2 request type", () => {
    const request: unknown = fixture.anyHarnessRequest;
    assertPortableRequest(request);
    expectTypeOf(request).toMatchTypeOf<PortableRequest>();
    expect(request.definition.stages[0].harnessConfig.modelSelection).toEqual({
      kind: "exact",
      modelId: "claude-sonnet-4-5",
    });
  });

  it("contains parseable canonical-number cases and unsafe lexical variants", () => {
    for (const testCase of fixture.canonicalNumberCases) {
      expect(typeof JSON.parse(testCase.source)).toBe("number");
      expect(typeof testCase.canonical).toBe("string");
      expect(typeof testCase.portable).toBe("boolean");
    }
    const rejected = fixture.canonicalNumberCases
      .filter((testCase) => !testCase.portable)
      .map((testCase) => testCase.source);
    expect(rejected).toContain("9007199254740992.0");
    expect(rejected).toContain("9.007199254740992e15");
  });
});
