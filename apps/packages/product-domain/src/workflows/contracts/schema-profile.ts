/**
 * The v1 emit JSON Schema profile validator (feature spec §6.2).
 *
 * V1 accepts only the vocabulary implemented in all three contract languages;
 * unsupported keywords are rejected at save/compile. Behavior is byte-for-byte
 * equivalent to the Python `schema_profile.py` validator over the shared golden
 * valid/invalid fixtures.
 */

export const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

const ALLOWED_KEYWORDS = new Set([
  "$schema",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "title",
  "description",
  "default",
]);

const JSON_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);

const ASCII_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class SchemaProfileError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = "SchemaProfileError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateType(nodeType: unknown): void {
  if (typeof nodeType === "string") {
    if (!JSON_TYPES.has(nodeType)) {
      throw new SchemaProfileError("invalid_type", `unknown type ${nodeType}`);
    }
    return;
  }
  if (Array.isArray(nodeType)) {
    if (nodeType.length !== 2 || nodeType[1] !== "null") {
      throw new SchemaProfileError("invalid_type", 'a type union must be a two-item [TYPE, "null"]');
    }
    const head = nodeType[0];
    if (typeof head !== "string" || !JSON_TYPES.has(head) || head === "null") {
      throw new SchemaProfileError("invalid_type", "invalid union head type");
    }
    return;
  }
  throw new SchemaProfileError("invalid_type", "type must be a string or a two-item union");
}

function validateNode(node: unknown, isRoot: boolean): void {
  if (!isPlainObject(node)) {
    throw new SchemaProfileError("node_not_object", "schema node must be an object");
  }

  for (const key of Object.keys(node)) {
    if (!ALLOWED_KEYWORDS.has(key)) {
      throw new SchemaProfileError("unsupported_keyword", `keyword ${key} is not permitted`);
    }
  }

  const dialect = node["$schema"];
  if (isRoot) {
    if (dialect !== undefined && dialect !== DRAFT_2020_12) {
      throw new SchemaProfileError("wrong_dialect", "root $schema must be draft 2020-12");
    }
    if (node["type"] !== "object") {
      throw new SchemaProfileError("root_type_not_object", "emit root must be type object");
    }
  } else if (dialect !== undefined) {
    throw new SchemaProfileError("unsupported_keyword", "$schema only allowed at the root");
  }

  if ("type" in node) {
    validateType(node["type"]);
  }

  for (const numericKey of ["minimum", "maximum"]) {
    if (numericKey in node && typeof node[numericKey] !== "number") {
      throw new SchemaProfileError("invalid_bound", `${numericKey} must be a finite number`);
    }
  }
  for (const intKey of ["minLength", "maxLength", "minItems", "maxItems"]) {
    if (intKey in node && !Number.isInteger(node[intKey])) {
      throw new SchemaProfileError("invalid_bound", `${intKey} must be an integer`);
    }
  }

  if ("enum" in node && !Array.isArray(node["enum"])) {
    throw new SchemaProfileError("invalid_enum", "enum must be an array");
  }

  const properties = node["properties"];
  if (properties !== undefined) {
    if (!isPlainObject(properties)) {
      throw new SchemaProfileError("invalid_properties", "properties must be an object");
    }
    for (const [propName, propSchema] of Object.entries(properties)) {
      if (isRoot && !ASCII_IDENTIFIER.test(propName)) {
        throw new SchemaProfileError(
          "property_name_not_ascii_identifier",
          `top-level property ${propName} is not an ASCII identifier`,
        );
      }
      validateNode(propSchema, false);
    }
  }

  const required = node["required"];
  if (
    required !== undefined &&
    !(Array.isArray(required) && required.every((r) => typeof r === "string"))
  ) {
    throw new SchemaProfileError("invalid_required", "required must be an array of strings");
  }

  const items = node["items"];
  if (items !== undefined) {
    validateNode(items, false);
  }
}

/** Throws SchemaProfileError if `document` is not a valid v1 emit schema. */
export function validateSchemaProfile(document: unknown): void {
  validateNode(document, true);
}
