import { describe, expect, it } from "vitest";
import type { WorkflowInputDefinition } from "@proliferate/cloud-sdk";
import {
  createManagedWorkflowLaunchAttempt,
  createWorkflowArgumentDraft,
  normalizeWorkflowArguments,
} from "./arguments";

const inputs: WorkflowInputDefinition[] = [
  { name: "ticket", type: "string", required: true },
  { name: "attempts", type: "number", required: false },
  { name: "notify", type: "boolean", required: false },
];

describe("workflow run arguments", () => {
  it("preserves definition order and omits unreferenced optional inputs", () => {
    const draft = createWorkflowArgumentDraft(inputs);
    draft.ticket = { supplied: true, value: "PROL-123" };

    expect(normalizeWorkflowArguments(inputs, "Investigate {{inputs.ticket}}", draft))
      .toEqual({ arguments: { ticket: "PROL-123" }, issues: [] });
  });

  it("requires optional inputs referenced by the prompt", () => {
    const draft = createWorkflowArgumentDraft(inputs);
    draft.ticket = { supplied: true, value: "PROL-123" };

    expect(normalizeWorkflowArguments(
      inputs,
      "Try {{inputs.attempts}} times for {{inputs.ticket}}",
      draft,
    ).issues).toContainEqual({
      path: "arguments.attempts",
      code: "missing",
      message: "This optional input is used by the prompt and must be supplied for this run.",
    });
  });

  it.each([
    ["1", 1],
    ["1.5", 1.5],
    ["1e2", 100],
    ["-0", 0],
    ["9007199254740991", 9_007_199_254_740_991],
  ])("accepts portable number %s", (raw, expected) => {
    const draft = createWorkflowArgumentDraft(inputs);
    draft.ticket = { supplied: true, value: "PROL-123" };
    draft.attempts = { supplied: true, value: raw };

    expect(normalizeWorkflowArguments(inputs, "Investigate", draft))
      .toEqual({ arguments: { ticket: "PROL-123", attempts: expected }, issues: [] });
  });

  it.each(["", "NaN", "Infinity", "9007199254740992"])(
    "rejects nonportable number %s",
    (raw) => {
      const draft = createWorkflowArgumentDraft(inputs);
      draft.ticket = { supplied: true, value: "PROL-123" };
      draft.attempts = { supplied: true, value: raw };

      expect(normalizeWorkflowArguments(inputs, "Investigate", draft).issues)
        .toContainEqual(expect.objectContaining({
          path: "arguments.attempts",
          code: "invalid_number",
        }));
    },
  );

  it("keeps explicit false and rejects extra inputs", () => {
    const draft = createWorkflowArgumentDraft(inputs);
    draft.ticket = { supplied: true, value: "PROL-123" };
    draft.notify = { supplied: true, value: false };
    draft.extra = { supplied: true, value: "private" };

    const result = normalizeWorkflowArguments(inputs, "Investigate", draft);
    expect(result.arguments).toEqual({ ticket: "PROL-123", notify: false });
    expect(result.issues).toContainEqual(expect.objectContaining({
      path: "arguments.extra",
      code: "unknown",
    }));
  });

  it("builds one immutable managed-Cloud request identity for retries", () => {
    const attempt = createManagedWorkflowLaunchAttempt(
      "40000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000001",
      7,
      { ticket: "PROL-123", notify: false },
    );

    expect(attempt).toEqual({
      invocationId: "40000000-0000-4000-8000-000000000001",
      request: {
        schemaVersion: 1,
        workflowDefinitionId: "10000000-0000-4000-8000-000000000001",
        expectedRevision: 7,
        arguments: { ticket: "PROL-123", notify: false },
        target: { kind: "managedCloud" },
      },
    });
    expect(attempt.request).toBe(attempt.request);
  });
});
