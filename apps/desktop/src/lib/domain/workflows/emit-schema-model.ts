/**
 * Editor-side model for authoring an `agent.emit` output schema (feature spec
 * §6.2 / WS9b item 1). The structured builder edits a flat, recursive
 * `EmitField[]` tree; this module converts that tree to/from the v1 emit JSON
 * Schema `Record<string, unknown>` the definition carries.
 *
 * The produced schema is always inside the v1 profile enforced by
 * `@proliferate/product-domain/workflows/contracts/schema-profile` (validated
 * live via WS9a's `emitSchemaIssues`): a root `type:"object"` with
 * `additionalProperties:false`, ASCII-identifier property names, and only the
 * permitted keywords. Rich schemas (enum/const/min/max) that the structured UI
 * does not model are authored through the raw-JSON escape hatch instead — this
 * module only owns the structured subset.
 */

export type EmitScalarType = "string" | "number" | "integer" | "boolean";
export type EmitFieldType = EmitScalarType | "object" | "array";

/** One authored property in the structured emit-schema builder. */
export interface EmitField {
  name: string;
  type: EmitFieldType;
  required: boolean;
  /** Present for `type:"object"` — the nested properties. */
  properties?: EmitField[];
  /** Present for `type:"array"` — the item type (scalar or nested object). */
  itemType?: EmitScalarType | "object";
  /** Present for an array whose `itemType` is `"object"`. */
  itemProperties?: EmitField[];
}

const SCALAR_TYPES: ReadonlySet<string> = new Set(["string", "number", "integer", "boolean"]);

/** A fresh scalar field ready to edit. */
export function newEmitField(name = ""): EmitField {
  return { name, type: "string", required: true };
}

function scalarSchema(type: EmitScalarType): Record<string, unknown> {
  return { type };
}

function objectSchema(properties: EmitField[]): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of properties) {
    if (field.name.trim() === "") {
      continue;
    }
    props[field.name] = fieldSchema(field);
    if (field.required) {
      required.push(field.name);
    }
  }
  const out: Record<string, unknown> = {
    type: "object",
    properties: props,
    additionalProperties: false,
  };
  if (required.length > 0) {
    out.required = required;
  }
  return out;
}

function fieldSchema(field: EmitField): Record<string, unknown> {
  if (field.type === "object") {
    return objectSchema(field.properties ?? []);
  }
  if (field.type === "array") {
    const itemType = field.itemType ?? "string";
    const items =
      itemType === "object" ? objectSchema(field.itemProperties ?? []) : scalarSchema(itemType);
    return { type: "array", items };
  }
  return scalarSchema(field.type);
}

/**
 * Build a v1 emit JSON Schema from the structured field tree. Fields with an
 * empty name are skipped (an in-progress row). Returns `undefined` when there
 * are no usable fields — an empty structured builder means "no schema authored",
 * not "an empty object schema".
 */
export function fieldsToEmitSchema(fields: readonly EmitField[]): Record<string, unknown> | undefined {
  const usable = fields.filter((field) => field.name.trim() !== "");
  if (usable.length === 0) {
    return undefined;
  }
  return objectSchema([...usable]);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The concrete scalar/object/array type of a property schema node, or null when
 * it is outside the structured subset (a union, enum-only node, etc.). */
function nodeType(node: Record<string, unknown>): EmitFieldType | null {
  const type = node.type;
  if (typeof type !== "string") {
    return null;
  }
  if (SCALAR_TYPES.has(type)) {
    return type as EmitScalarType;
  }
  if (type === "object" || type === "array") {
    return type;
  }
  return null;
}

function schemaToFields(schema: Record<string, unknown>): EmitField[] {
  const properties = asRecord(schema.properties);
  if (!properties) {
    return [];
  }
  const required = new Set(
    Array.isArray(schema.required)
      ? (schema.required.filter((r) => typeof r === "string") as string[])
      : [],
  );
  const fields: EmitField[] = [];
  for (const [name, rawProp] of Object.entries(properties)) {
    const prop = asRecord(rawProp);
    if (!prop) {
      continue;
    }
    const type = nodeType(prop);
    if (type === null) {
      // Outside the structured subset — surfaced by the raw JSON view instead.
      continue;
    }
    const field: EmitField = { name, type: type as EmitFieldType, required: required.has(name) };
    if (type === "object") {
      field.properties = schemaToFields(prop);
    } else if (type === "array") {
      const items = asRecord(prop.items);
      const itemType = items ? nodeType(items) : null;
      if (itemType === "object") {
        field.itemType = "object";
        field.itemProperties = schemaToFields(items!);
      } else if (itemType !== null && itemType !== "array") {
        field.itemType = itemType as EmitScalarType;
      } else {
        field.itemType = "string";
      }
    }
    fields.push(field);
  }
  return fields;
}

export interface EmitSchemaModel {
  fields: EmitField[];
  /**
   * True when the stored schema uses keywords/shapes the structured builder does
   * not model (enum, const, bounds, unions, ...) so it can only be edited safely
   * through the raw JSON escape hatch. The structured tab is then read-only.
   */
  beyondStructured: boolean;
}

/** True when every keyword in the node tree is one the structured builder can
 * faithfully rebuild (so the round-trip through the builder is lossless). */
function isStructurable(schema: Record<string, unknown>, isRoot: boolean): boolean {
  const allowedAtNode = new Set([
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    ...(isRoot ? ["$schema"] : []),
  ]);
  for (const key of Object.keys(schema)) {
    if (!allowedAtNode.has(key)) {
      return false;
    }
  }
  const type = schema.type;
  if (typeof type !== "string" || !(SCALAR_TYPES.has(type) || type === "object" || type === "array")) {
    return false;
  }
  const properties = asRecord(schema.properties);
  if (properties) {
    for (const value of Object.values(properties)) {
      const rec = asRecord(value);
      if (!rec || !isStructurable(rec, false)) {
        return false;
      }
    }
  }
  const items = asRecord(schema.items);
  if (items && !isStructurable(items, false)) {
    return false;
  }
  return true;
}

/** Parse a stored emit schema into the structured builder model. */
export function emitSchemaToModel(schema: Record<string, unknown> | undefined): EmitSchemaModel {
  if (schema === undefined) {
    return { fields: [], beyondStructured: false };
  }
  const beyondStructured = !isStructurable(schema, true);
  return { fields: beyondStructured ? [] : schemaToFields(schema), beyondStructured };
}
