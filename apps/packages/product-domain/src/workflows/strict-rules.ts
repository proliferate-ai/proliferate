/**
 * Strict topology + schema rules extracted from validation.ts (feature spec
 * §6.1/§6.2). These are the behaviour-owner rules the shared model now enforces
 * ahead of the server: slot lineage, the v1 emit JSON Schema profile, and the
 * narrow branch grammar. They return `WorkflowIssue`s so validation.ts can splice
 * them into its existing flow.
 */

import { iterReferences } from "./interpolation";
import { isParallelGroup, type WorkflowDefinition, type WorkflowStep } from "./definition";
import { SchemaProfileError, validateSchemaProfile } from "./contracts/schema-profile";
import type { WorkflowIssue } from "./validation";

interface SlotUsage {
  kind: "sequential" | "lane";
  /** Spine entry index (a whole parallel group is one entry / one group). */
  spineIndex: number;
  /** Flatten node ordinal, for locating the issue on the offending node. */
  nodeIndex: number;
}

/**
 * Slot lineage (feature spec §6.1). A run-level sequential slot owns one session
 * and may be reused across later sequential stages (session affinity — allowed).
 * A parallel lane slot gets a fresh per-lane session and may NOT appear in
 * another lane of its group, another group, or any sequential stage. The
 * compiler rejects those reuses; we mirror the rejection for editor feedback.
 */
export function validateSlotLineage(definition: WorkflowDefinition): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const usagesBySlot = new Map<string, SlotUsage[]>();

  let nodeIndex = 0;
  definition.agents.forEach((entry, spineIndex) => {
    if (isParallelGroup(entry)) {
      for (const lane of entry.parallel) {
        const usages = usagesBySlot.get(lane.slot) ?? [];
        usages.push({ kind: "lane", spineIndex, nodeIndex });
        usagesBySlot.set(lane.slot, usages);
        nodeIndex += 1;
      }
    } else {
      const usages = usagesBySlot.get(entry.slot) ?? [];
      usages.push({ kind: "sequential", spineIndex, nodeIndex });
      usagesBySlot.set(entry.slot, usages);
      nodeIndex += 1;
    }
  });

  for (const [slot, usages] of usagesBySlot) {
    const laneUsages = usages.filter((u) => u.kind === "lane");
    if (laneUsages.length === 0) {
      // Sequential-only slot: reuse across stages is session affinity — allowed.
      continue;
    }
    const sequentialUsages = usages.filter((u) => u.kind === "sequential");
    const distinctGroups = new Set(laneUsages.map((u) => u.spineIndex));

    // Concurrent lanes of one group cannot share a slot (each lane = a distinct
    // fresh session on its own worktree).
    for (const group of distinctGroups) {
      const inGroup = laneUsages.filter((u) => u.spineIndex === group);
      if (inGroup.length > 1) {
        for (const usage of inGroup) {
          issues.push({
            code: "slot_concurrent_lanes",
            message: `Slot '${slot}' is used by ${inGroup.length} concurrent lanes of one group; each lane needs its own slot.`,
            location: { scope: "agent", nodeIndex: usage.nodeIndex, field: "slot" },
          });
        }
      }
    }

    // A lane slot cannot reappear in another parallel group.
    if (distinctGroups.size > 1) {
      for (const usage of laneUsages) {
        issues.push({
          code: "slot_lane_cross_group",
          message: `Lane slot '${slot}' is reused across ${distinctGroups.size} parallel groups; a lane slot is scoped to its own group.`,
          location: { scope: "agent", nodeIndex: usage.nodeIndex, field: "slot" },
        });
      }
    }

    // A lane slot cannot also be used by any sequential stage.
    if (sequentialUsages.length > 0) {
      for (const usage of [...laneUsages, ...sequentialUsages]) {
        issues.push({
          code: "slot_lane_reused_sequential",
          message: `Slot '${slot}' is used both as a parallel lane and a sequential stage; a lane slot cannot appear outside its group.`,
          location: { scope: "agent", nodeIndex: usage.nodeIndex, field: "slot" },
        });
      }
    }
  }

  return issues;
}

/**
 * The authored emit schema (feature spec §6.2) must satisfy the v1 JSON Schema
 * profile. Rejected keywords/shapes become editor issues, never silent
 * acceptance. No schema is fine (server may still require one on save).
 */
export function emitSchemaIssues(
  schema: Record<string, unknown> | undefined,
  stepIndex: number,
): WorkflowIssue[] {
  if (schema === undefined) {
    return [];
  }
  try {
    validateSchemaProfile(schema);
    return [];
  } catch (error) {
    if (error instanceof SchemaProfileError) {
      return [
        {
          code: "invalid_emit_schema",
          message: `Emit schema is not a valid v1 schema: ${error.message}`,
          location: { scope: "step", stepIndex, field: "outputSchema" },
        },
      ];
    }
    throw error;
  }
}

/** The declared JSON type of a top-level emit-schema field, or undefined. */
function fieldType(schema: Record<string, unknown> | undefined, field: string): unknown {
  const properties = schema?.properties;
  if (typeof properties !== "object" || properties === null) {
    return undefined;
  }
  const prop = (properties as Record<string, unknown>)[field];
  if (typeof prop !== "object" || prop === null) {
    return undefined;
  }
  return (prop as Record<string, unknown>).type;
}

/**
 * The v1 branch grammar (feature spec §6.2): `branch.on` is exactly one
 * `{{EMIT.FIELD}}` reference whose schema field is a string. When the producing
 * emit's schema is known and the referenced field's type is a concrete non-string,
 * flag it (the reference-existence + prior-visibility checks stay in validation.ts).
 */
export function branchFieldTypeIssue(
  step: Extract<WorkflowStep, { kind: "branch" }>,
  stepIndex: number,
  emitSchemas: ReadonlyMap<string, Record<string, unknown> | undefined>,
): WorkflowIssue | null {
  const refs = iterReferences(step.on).filter((r) => r.kind === "emit");
  if (refs.length !== 1) {
    return null;
  }
  const ref = refs[0] as { emit: string; field: string };
  const schema = emitSchemas.get(ref.emit);
  if (schema === undefined) {
    return null;
  }
  const type = fieldType(schema, ref.field);
  if (type === undefined) {
    return null;
  }
  if (type === "string") {
    return null;
  }
  return {
    code: "branch_field_not_string",
    message: `Branch must switch on a string emit field, but '${ref.emit}.${ref.field}' is typed ${JSON.stringify(type)}.`,
    location: { scope: "step", stepIndex, field: "on" },
  };
}
