/**
 * Stable UUID identities for the workflow model (feature spec §5.1).
 *
 * Canonical definitions persist lowercase-UUID identities for every slot,
 * sequential node, parallel group/lane, include step, and ordinary step. Labels
 * and array order are business data; references, session bindings, and React
 * keys use the ids. New objects use UUIDv7. Legacy definitions with no ids are
 * upgraded once, deterministically, to UUIDv5 ids derived from the fixed
 * Proliferate namespace — this module owns ONLY the §5.1 name grammar (JSON
 * Pointer identity + `slot:<label>`); the UUIDv5 derivation itself is reused
 * from the WS1 `contracts/legacy-upgrade` module (never duplicated here).
 *
 * The current v1 wire dict carries no ids: `serializeWorkflowDefinition`
 * (definition.ts) omits them for a lossless legacy round-trip, while
 * `serializeCanonicalDefinition` here emits them. `parseCanonicalDefinition`
 * reads ids when present (exact round-trip) and can derive legacy ids when given
 * the workflow-version id.
 *
 * `ensureStepId`/`ensureDefinitionIds` (below) are the editor-authoring
 * counterpart: idempotent UUIDv7 id-minting for an id-less draft, with no
 * workflow-version id required. The desktop editor's drag-identity module
 * delegates to these rather than minting locally.
 */

import { deriveLegacyId, type LegacyIdentityKind } from "./contracts/legacy-upgrade";
import {
  isParallelGroup,
  parseWorkflowDefinition,
  serializeWorkflowDefinition,
  type WorkflowAgentNode,
  type WorkflowDefinition,
  type WorkflowParallelGroup,
  type WorkflowSpineEntry,
  type WorkflowStep,
} from "./definition";

export type WorkflowObjectId = string;

export interface ParseIdentityOptions {
  /**
   * The workflow-version id (lowercase UUID) used as the UUIDv5 namespace name
   * when a definition has no ids. Omit for the plain editor path — objects are
   * then left id-less and a fresh session assigns UUIDv7 ids as needed.
   */
  workflowVersionId?: string;
}

// --- UUIDv7 (new objects) ------------------------------------------------------

function formatUuid(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A fresh lowercase UUIDv7 for a newly-authored slot/node/group/lane/step.
 * Browser-safe (no `node:crypto`); the random field uses `Math.random`, which
 * is sufficient for editor identity (never a security boundary).
 */
export function newWorkflowObjectId(): string {
  const ms = Date.now();
  const bytes = new Uint8Array(16);
  bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ms / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ms / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;
  for (let i = 6; i < 16; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  return formatUuid(bytes);
}

// --- resolved step key (feature spec §5.1) -------------------------------------

/**
 * The hierarchical resolved step key that survives reorder/rename:
 * `<include path or "root">::<node id>::<lane id or "->::<step id>`. `includePath`
 * is the ordered `/`-joined sequence of include-step ids (empty = root spine).
 */
export function resolvedStepKey(params: {
  includePath?: readonly string[];
  nodeId: string;
  laneId: string | null;
  stepId: string;
}): string {
  const path = params.includePath && params.includePath.length > 0
    ? params.includePath.join("/")
    : "root";
  return `${path}::${params.nodeId}::${params.laneId ?? "-"}::${params.stepId}`;
}

// --- legacy UUIDv5 derivation (feature spec §5.1) ------------------------------

function derive(workflowVersionId: string, kind: LegacyIdentityKind, identity: string): string {
  return deriveLegacyId(workflowVersionId, kind, identity);
}

function withLegacyStepIds(
  node: WorkflowAgentNode,
  workflowVersionId: string,
  pointer: string,
): WorkflowStep[] {
  return node.steps.map((step, k) => ({
    ...step,
    id: derive(workflowVersionId, "step", `${pointer}/steps/${k}`),
  }));
}

function withLegacyNode(
  node: WorkflowAgentNode,
  workflowVersionId: string,
  pointer: string,
  kind: "node" | "lane",
): WorkflowAgentNode {
  return {
    ...node,
    id: derive(workflowVersionId, kind, pointer),
    slotId: derive(workflowVersionId, "slot", `slot:${node.slot}`),
    steps: withLegacyStepIds(node, workflowVersionId, pointer),
  };
}

/**
 * Upgrade a legacy (id-less) definition to one whose slot/node/group/lane/step
 * ids are the deterministic UUIDv5 ids of feature spec §5.1. Pure — returns a new
 * definition; the caller persists it as a new immutable version. Identity is the
 * RFC 6901 JSON Pointer into the canonical definition (`/agents/2/parallel/0`),
 * or `slot:<label>` for a slot so repeated sequential uses share one identity.
 */
export function deriveDefinitionIdentities(
  definition: WorkflowDefinition,
  workflowVersionId: string,
): WorkflowDefinition {
  const agents: WorkflowSpineEntry[] = definition.agents.map((entry, i) => {
    if (isParallelGroup(entry)) {
      const groupPointer = `/agents/${i}/parallel`;
      const group: WorkflowParallelGroup = {
        id: derive(workflowVersionId, "group", groupPointer),
        parallel: entry.parallel.map((lane, j) =>
          withLegacyNode(lane, workflowVersionId, `${groupPointer}/${j}`, "lane"),
        ),
      };
      return group;
    }
    return withLegacyNode(entry, workflowVersionId, `/agents/${i}`, "node");
  });
  return { ...definition, agents };
}

// --- draft id-minting (editor authoring; WS9a addendum item 3) ----------------
//
// Moved here from the desktop `drag-identity.ts` (WS9b), which minted these ids
// locally while this module was frozen mid-packet. `drag-identity.ts` now
// delegates to `ensureStepId`/`ensureDefinitionIds` below — the transient
// drag-resolution helpers (id -> current address/index) stay desktop-local,
// since they are not part of the identity model itself.

/** Assign an id to a step if it has none (preserves an existing id verbatim). */
export function ensureStepId(step: WorkflowStep): WorkflowStep {
  return step.id ? step : { ...step, id: newWorkflowObjectId() };
}

function ensureNodeIds(node: WorkflowAgentNode): WorkflowAgentNode {
  return {
    ...node,
    id: node.id ?? newWorkflowObjectId(),
    slotId: node.slotId ?? newWorkflowObjectId(),
    steps: node.steps.map(ensureStepId),
  };
}

/**
 * Idempotently populate every slot/node/group/lane/step id on a draft that was
 * parsed from the id-less v1 wire. Existing ids are preserved (canonical
 * round-trip); only gaps are filled with fresh UUIDv7s. Pure — returns a new
 * definition.
 */
export function ensureDefinitionIds(definition: WorkflowDefinition): WorkflowDefinition {
  const agents: WorkflowSpineEntry[] = definition.agents.map((entry) => {
    if (isParallelGroup(entry)) {
      const group: WorkflowParallelGroup = {
        ...entry,
        id: entry.id ?? newWorkflowObjectId(),
        parallel: entry.parallel.map(ensureNodeIds),
      };
      return group;
    }
    return ensureNodeIds(entry);
  });
  return { ...definition, agents };
}

// --- canonical (id-carrying) serialize -----------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function canonicalNode(
  wireNode: Record<string, unknown>,
  node: WorkflowAgentNode,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...wireNode };
  if (node.id !== undefined) {
    out.id = node.id;
  }
  if (node.slotId !== undefined) {
    out.slot_id = node.slotId;
  }
  const wireSteps = (wireNode.steps as Record<string, unknown>[]) ?? [];
  out.steps = wireSteps.map((wireStep, k) => {
    const stepId = node.steps[k]?.id;
    return stepId !== undefined ? { ...wireStep, id: stepId } : { ...wireStep };
  });
  return out;
}

/**
 * The canonical definition dict — the v1 wire shape plus lowercase-UUID `id`
 * (and `slot_id` on nodes/lanes). Reuses `serializeWorkflowDefinition` for step
 * serialization, then overlays ids from the model in lockstep, so it stays in
 * step with the v1 serializer. Ids absent on the model are simply not emitted.
 */
export function serializeCanonicalDefinition(
  definition: WorkflowDefinition,
): Record<string, unknown> {
  const wire = serializeWorkflowDefinition(definition);
  const wireAgents = wire.agents as Record<string, unknown>[];
  const agents = definition.agents.map((entry, i) => {
    const wireEntry = wireAgents[i]!;
    if (isParallelGroup(entry)) {
      const out: Record<string, unknown> = { ...wireEntry };
      if (entry.id !== undefined) {
        out.id = entry.id;
      }
      out.parallel = (wireEntry.parallel as Record<string, unknown>[]).map((wireLane, j) =>
        canonicalNode(wireLane, entry.parallel[j]!),
      );
      return out;
    }
    return canonicalNode(wireEntry, entry);
  });
  return { ...wire, agents };
}

// --- canonical parse (reads ids; derives legacy ids on request) ----------------

function attachStepIds(
  steps: WorkflowStep[],
  rawSteps: unknown,
): WorkflowStep[] {
  const rawArray = Array.isArray(rawSteps) ? rawSteps : [];
  return steps.map((step, k) => {
    const id = asString(asRecord(rawArray[k])?.id);
    return id !== undefined ? { ...step, id } : step;
  });
}

function attachNodeIds(node: WorkflowAgentNode, raw: unknown): WorkflowAgentNode {
  const record = asRecord(raw);
  const out: WorkflowAgentNode = { ...node, steps: attachStepIds(node.steps, record?.steps) };
  const id = asString(record?.id);
  if (id !== undefined) {
    out.id = id;
  }
  const slotId = asString(record?.slot_id);
  if (slotId !== undefined) {
    out.slotId = slotId;
  }
  return out;
}

/**
 * Parse a definition dict into the model with stable identities.
 *
 * - ids present on the dict are read verbatim (canonical round-trip: parse then
 *   `serializeCanonicalDefinition` is exact);
 * - ids absent but `workflowVersionId` supplied → deterministic UUIDv5 legacy
 *   upgrade (feature spec §5.1);
 * - ids absent and no version id → structural parse only (editor path; a session
 *   can mint UUIDv7 ids via `newWorkflowObjectId`).
 *
 * Structure/round-trip against the v1 wire is delegated to
 * `parseWorkflowDefinition`, so `serializeWorkflowDefinition` still omits ids.
 */
export function parseCanonicalDefinition(
  raw: unknown,
  options: ParseIdentityOptions = {},
): WorkflowDefinition {
  const model = parseWorkflowDefinition(raw);
  const record = asRecord(raw);
  const rawAgents = Array.isArray(record?.agents) ? (record!.agents as unknown[]) : [];
  const dictCarriesIds = rawAgents.some((entry) => {
    const rec = asRecord(entry);
    if (asString(rec?.id) !== undefined) {
      return true;
    }
    if (Array.isArray(rec?.parallel)) {
      return (rec!.parallel as unknown[]).some((lane) => asString(asRecord(lane)?.id) !== undefined);
    }
    return false;
  });

  if (!dictCarriesIds && options.workflowVersionId !== undefined) {
    return deriveDefinitionIdentities(model, options.workflowVersionId);
  }

  const agents: WorkflowSpineEntry[] = model.agents.map((entry, i) => {
    const rawEntry = rawAgents[i];
    if (isParallelGroup(entry)) {
      const rawGroup = asRecord(rawEntry);
      const rawLanes = Array.isArray(rawGroup?.parallel) ? (rawGroup!.parallel as unknown[]) : [];
      const group: WorkflowParallelGroup = {
        parallel: entry.parallel.map((lane, j) => attachNodeIds(lane, rawLanes[j])),
      };
      const groupId = asString(rawGroup?.id);
      if (groupId !== undefined) {
        group.id = groupId;
      }
      return group;
    }
    return attachNodeIds(entry, rawEntry);
  });
  return { ...model, agents };
}
