import type { WorkflowDefinitionV2 } from "@proliferate/cloud-sdk";
import { workflowBuilderIssues } from "#product/lib/domain/workflows/workflow-builder-validation";

export type WorkflowJsonParseResult =
  | { ok: true; definition: WorkflowDefinitionV2 }
  | { ok: false; message: string };

export function formatWorkflowDefinitionJson(definition: WorkflowDefinitionV2): string {
  return `${JSON.stringify(definition, null, 2)}\n`;
}

/** Strictly decodes the camelCase schema-v2 document; record-envelope fields are not accepted. */
export function parseWorkflowDefinitionJson(source: string): WorkflowJsonParseResult {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return { ok: false, message: "JSON syntax is invalid." };
  }
  if (!isRecord(value)) return invalid("The definition must be a JSON object.");
  if (!hasOnlyKeys(value, ["schemaVersion", "nodes", "edges", "inputs", "docTemplates"])) {
    return invalid("The definition contains an unknown field.");
  }
  if (value.schemaVersion !== 2 || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return invalid("schemaVersion must be 2, with nodes and edges arrays.");
  }
  if (!value.nodes.every(isNode) || !value.edges.every(isEdge)) {
    return invalid("A node or edge has an invalid shape.");
  }
  if (value.inputs !== undefined && (!Array.isArray(value.inputs) || !value.inputs.every(isInput))) {
    return invalid("An input has an invalid shape.");
  }
  if (value.docTemplates !== undefined
    && (!Array.isArray(value.docTemplates) || !value.docTemplates.every(isDoc))) {
    return invalid("A document template has an invalid shape.");
  }
  const definition = value as unknown as WorkflowDefinitionV2;
  const issues = workflowBuilderIssues(definition);
  if (issues.length > 0) return invalid(issues[0].message);
  return { ok: true, definition };
}

function isNode(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "type", "title", "prompt", "model"])) return false;
  if (typeof value.id !== "string" || (value.type !== "agent" && value.type !== "human_in_loop")
    || typeof value.title !== "string" || typeof value.prompt !== "string") return false;
  if (value.model === undefined || value.model === null) return true;
  return isRecord(value.model)
    && hasOnlyKeys(value.model, ["agentKind", "modelId", "modeId"])
    && typeof value.model.agentKind === "string"
    && optionalNullableString(value.model.modelId)
    && optionalNullableString(value.model.modeId);
}

function isEdge(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ["from", "to"])
    && typeof value.from === "string" && typeof value.to === "string";
}

function isInput(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ["name", "description", "required"])
    && typeof value.name === "string" && typeof value.description === "string"
    && typeof value.required === "boolean";
}

function isDoc(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ["slug", "producingNodeId", "body"])
    && typeof value.slug === "string" && typeof value.producingNodeId === "string"
    && typeof value.body === "string";
}

function optionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function invalid(message: string): WorkflowJsonParseResult {
  return { ok: false, message };
}
