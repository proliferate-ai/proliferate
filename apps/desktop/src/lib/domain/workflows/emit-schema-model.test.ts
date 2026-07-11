import { describe, expect, it } from "vitest";
import { validateSchemaProfile } from "@proliferate/product-domain/workflows/contracts/schema-profile";
import { emitSchemaIssues } from "@proliferate/product-domain/workflows/strict-rules";
import {
  emitSchemaToModel,
  fieldsToEmitSchema,
  type EmitField,
} from "./emit-schema-model";

describe("emit-schema-model (WS9b item 1)", () => {
  it("builds a v1-profile-valid object schema from structured fields", () => {
    const fields: EmitField[] = [
      { name: "category", type: "string", required: true },
      { name: "confidence", type: "number", required: true },
      { name: "done", type: "boolean", required: false },
    ];
    const schema = fieldsToEmitSchema(fields)!;
    // Passes the shared v1 profile (no throw) and the WS9a issue reporter.
    expect(() => validateSchemaProfile(schema)).not.toThrow();
    expect(emitSchemaIssues(schema, 0)).toEqual([]);
    expect(schema).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        category: { type: "string" },
        confidence: { type: "number" },
        done: { type: "boolean" },
      },
      required: ["category", "confidence"],
    });
  });

  it("returns undefined for an empty builder (no schema authored)", () => {
    expect(fieldsToEmitSchema([])).toBeUndefined();
    expect(fieldsToEmitSchema([{ name: "", type: "string", required: true }])).toBeUndefined();
  });

  it("builds nested objects and arrays inside the profile", () => {
    const fields: EmitField[] = [
      {
        name: "meta",
        type: "object",
        required: true,
        properties: [{ name: "note", type: "string", required: false }],
      },
      { name: "tags", type: "array", required: false, itemType: "string" },
      {
        name: "rows",
        type: "array",
        required: false,
        itemType: "object",
        itemProperties: [{ name: "id", type: "integer", required: true }],
      },
    ];
    const schema = fieldsToEmitSchema(fields)!;
    expect(() => validateSchemaProfile(schema)).not.toThrow();
    expect(emitSchemaIssues(schema, 0)).toEqual([]);
    expect((schema.properties as Record<string, unknown>).tags).toEqual({
      type: "array",
      items: { type: "string" },
    });
    expect((schema.properties as Record<string, unknown>).rows).toEqual({
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { id: { type: "integer" } },
        required: ["id"],
      },
    });
  });

  it("round-trips a structured schema through the field model losslessly", () => {
    const fields: EmitField[] = [
      { name: "verdict", type: "string", required: true },
      {
        name: "detail",
        type: "object",
        required: false,
        properties: [{ name: "count", type: "integer", required: true }],
      },
    ];
    const schema = fieldsToEmitSchema(fields)!;
    const model = emitSchemaToModel(schema);
    expect(model.beyondStructured).toBe(false);
    expect(fieldsToEmitSchema(model.fields)).toEqual(schema);
  });

  it("flags a schema that uses features outside the structured subset (enum/bounds)", () => {
    // A T3-WF-1 style rich schema — still profile-valid, but the field editor
    // can't model enum/minimum, so it opens on the raw JSON tab instead.
    const rich: Record<string, unknown> = {
      type: "object",
      additionalProperties: false,
      properties: {
        category: { type: "string", enum: ["low", "medium", "high"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["category", "confidence"],
    };
    expect(emitSchemaIssues(rich, 0)).toEqual([]);
    expect(emitSchemaToModel(rich).beyondStructured).toBe(true);
  });

  it("emitSchemaIssues rejects a schema outside the v1 profile", () => {
    // `pattern` is not a permitted v1 keyword.
    const bad: Record<string, unknown> = {
      type: "object",
      properties: { name: { type: "string", pattern: "^x" } },
    };
    const issues = emitSchemaIssues(bad, 0);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.code).toBe("invalid_emit_schema");
  });
});
