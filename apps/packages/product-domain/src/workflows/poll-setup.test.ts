import { describe, expect, it } from "vitest";

import {
  deriveWorkflowInputsFromPollSample,
  parsePollSignatureMismatches,
} from "./poll-setup";

describe("deriveWorkflowInputsFromPollSample (flow 1)", () => {
  it("projects the wire skeleton into WorkflowInputSpec[]", () => {
    const derived = [
      { name: "issue_id", type: "text", required: true },
      { name: "priority", type: "number", required: true },
      { name: "urgent", type: "boolean", required: true },
    ];
    expect(deriveWorkflowInputsFromPollSample(derived)).toEqual([
      { name: "issue_id", type: "text", required: true },
      { name: "priority", type: "number", required: true },
      { name: "urgent", type: "boolean", required: true },
    ]);
  });

  it("drops entries with an illegal identifier or an unknown type", () => {
    const derived = [
      { name: "2bad", type: "text", required: true },
      { name: "ok_name", type: "object", required: true },
      { name: "good", type: "text", required: false },
    ];
    expect(deriveWorkflowInputsFromPollSample(derived)).toEqual([
      { name: "good", type: "text", required: false },
    ]);
  });

  it("de-duplicates by name and caps at WORKFLOW_MAX_ARGS", () => {
    const derived = [
      { name: "dup", type: "text", required: true },
      { name: "dup", type: "number", required: false },
      ...Array.from({ length: 30 }, (_, i) => ({
        name: `field_${i}`,
        type: "text",
        required: true,
      })),
    ];
    const result = deriveWorkflowInputsFromPollSample(derived);
    expect(result.length).toBe(25);
    expect(result[0]).toEqual({ name: "dup", type: "text", required: true });
  });

  it("returns an empty skeleton for an empty sample", () => {
    expect(deriveWorkflowInputsFromPollSample([])).toEqual([]);
  });
});

describe("parsePollSignatureMismatches (flow 2)", () => {
  it("attributes a missing-required-property message to its field", () => {
    expect(parsePollSignatureMismatches(["data is missing required property 'issue_id'."])).toEqual([
      { field: "issue_id", message: "data is missing required property 'issue_id'." },
    ]);
  });

  it("attributes a wrong-type message to its field via the data.<field> path", () => {
    expect(parsePollSignatureMismatches(["data.priority must be of type 'number'."])).toEqual([
      { field: "priority", message: "data.priority must be of type 'number'." },
    ]);
  });

  it("falls back to a null field for a message it can't attribute", () => {
    expect(parsePollSignatureMismatches(["item 'data' must be a JSON object."])).toEqual([
      { field: null, message: "item 'data' must be a JSON object." },
    ]);
  });

  it("maps one row per mismatch, preserving order", () => {
    const mismatches = [
      "data is missing required property 'issue_id'.",
      "data.priority must be of type 'number'.",
    ];
    expect(parsePollSignatureMismatches(mismatches).map((row) => row.field)).toEqual([
      "issue_id",
      "priority",
    ]);
  });

  it("returns an empty list for an empty diff", () => {
    expect(parsePollSignatureMismatches([])).toEqual([]);
  });
});
