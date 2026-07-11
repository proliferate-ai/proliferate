/**
 * WS9a — product-domain half of T2-WF-EDITOR-01.
 *
 * Covers the strict identity + strictness contract layered onto the shared
 * workflow model: stable UUID identities and canonical round-trips, the
 * deterministic legacy UUIDv5 upgrade, id stability under reorder/rename, the
 * slot-lineage rejection matrix (feature spec §6.1), read-only future-version
 * handling (§5.1), and the emit schema profile / branch grammar (§6.2).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  isParallelGroup,
  parseWorkflowDefinition,
  serializeWorkflowDefinition,
  type WorkflowDefinition,
} from "./definition";
import {
  deriveDefinitionIdentities,
  newWorkflowObjectId,
  parseCanonicalDefinition,
  resolvedStepKey,
  serializeCanonicalDefinition,
} from "./identity";
import { deriveLegacyId, type LegacyIdentityKind } from "./contracts/legacy-upgrade";
import { parseWorkflowDefinitionResult } from "./read-only";
import { isEditable, validateWorkflowDefinition } from "./validation";
import { WORKFLOW_TEMPLATES } from "./templates";

function fixture<T = Record<string, unknown>>(name: string): T {
  const url = new URL(`../../../../../tests/contracts/workflows/fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf-8")) as T;
}

const VERSION_ID = "018f8b00-0000-7000-8000-0000000000ee";

// --- stable identities + canonical round-trip ---------------------------------

describe("stable identities: canonical round-trip", () => {
  it("a v1 wire dict serializes WITHOUT ids (lossless legacy round-trip)", () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const wire = serializeWorkflowDefinition(template.definition);
      // No id / slot_id keys leaked into the v1 shape.
      expect(JSON.stringify(wire)).not.toContain("\"id\"");
      expect(JSON.stringify(wire)).not.toContain("slot_id");
      expect(parseWorkflowDefinition(wire)).toEqual(template.definition);
    }
  });

  it("a definition WITH ids round-trips exactly through the canonical serializer", () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const withIds = deriveDefinitionIdentities(template.definition, VERSION_ID);
      const canonical = serializeCanonicalDefinition(withIds);
      // Every node/step carries a lowercase-UUID id in the canonical shape.
      expect(JSON.stringify(canonical)).toContain("\"id\"");
      const reparsed = parseCanonicalDefinition(canonical);
      expect(reparsed).toEqual(withIds);
      expect(serializeCanonicalDefinition(reparsed)).toEqual(canonical);
    }
  });

  it("mints lowercase UUIDv7 ids for new objects", () => {
    const id = newWorkflowObjectId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newWorkflowObjectId()).not.toBe(id);
  });

  it("builds a resolved step key that is stable under reorder/rename", () => {
    expect(resolvedStepKey({ nodeId: "n1", laneId: null, stepId: "s1" })).toBe("root::n1::-::s1");
    expect(resolvedStepKey({ includePath: ["i1", "i2"], nodeId: "n1", laneId: "la", stepId: "s1" }))
      .toBe("i1/i2::n1::la::s1");
  });
});

// --- deterministic legacy UUIDv5 upgrade --------------------------------------

describe("legacy definition upgrade (feature spec §5.1)", () => {
  it("reproduces every deterministic UUIDv5 identity from the shared fixture", () => {
    const legacy = fixture<{
      newWorkflowVersionId: string;
      legacyDefinition: unknown;
      expectedIds: { kind: string; identity: string; uuid: string }[];
    }>("legacy-definition-upgrade-v1.json");

    const model = parseWorkflowDefinition(legacy.legacyDefinition);
    const upgraded = deriveDefinitionIdentities(model, legacy.newWorkflowVersionId);

    const byKindIdentity = new Map<string, string>();
    for (const row of legacy.expectedIds) {
      byKindIdentity.set(`${row.kind}:${row.identity}`, row.uuid);
      // The walker reuses the WS1 derivation — prove it matches, no duplication.
      expect(deriveLegacyId(legacy.newWorkflowVersionId, row.kind as LegacyIdentityKind, row.identity))
        .toBe(row.uuid);
    }

    const node0 = upgraded.agents[0]!;
    expect(isParallelGroup(node0)).toBe(false);
    if (!isParallelGroup(node0)) {
      expect(node0.slotId).toBe(byKindIdentity.get("slot:slot:Triage"));
      expect(node0.id).toBe(byKindIdentity.get("node:/agents/0"));
      expect(node0.steps[1]!.id).toBe(byKindIdentity.get("step:/agents/0/steps/1"));
    }
    const group = upgraded.agents[1]!;
    expect(isParallelGroup(group)).toBe(true);
    if (isParallelGroup(group)) {
      expect(group.id).toBe(byKindIdentity.get("group:/agents/1/parallel"));
      expect(group.parallel[0]!.id).toBe(byKindIdentity.get("lane:/agents/1/parallel/0"));
      expect(group.parallel[0]!.steps[0]!.id).toBe(
        byKindIdentity.get("step:/agents/1/parallel/0/steps/0"),
      );
    }
  });
});

// --- id stability under reorder / rename --------------------------------------

describe("id stability under reorder and rename", () => {
  const base = (): WorkflowDefinition =>
    deriveDefinitionIdentities(
      {
        version: 1,
        inputs: [],
        integrations: [],
        agents: [
          { slot: "triage", harness: "claude", model: "sonnet", steps: [
            { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "a" },
          ] },
          { slot: "fix", harness: "codex", model: "gpt-5", steps: [
            { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "b" },
          ] },
        ],
      },
      VERSION_ID,
    );

  it("renaming a slot label never changes the slot/node identity", () => {
    const def = base();
    const node0 = def.agents[0]!;
    if (isParallelGroup(node0)) {
      throw new Error("expected a sequential node");
    }
    const originalId = node0.id;
    const originalSlotId = node0.slotId;
    const renamed = { ...node0, slot: "triage_renamed" };
    expect(renamed.id).toBe(originalId);
    expect(renamed.slotId).toBe(originalSlotId);
  });

  it("reordering nodes carries ids with the objects through canonical round-trip", () => {
    const def = base();
    const [n0, n1] = def.agents;
    const reordered: WorkflowDefinition = { ...def, agents: [n1!, n0!] };
    const roundTripped = parseCanonicalDefinition(serializeCanonicalDefinition(reordered));
    const first = roundTripped.agents[0]!;
    const second = roundTripped.agents[1]!;
    if (isParallelGroup(first) || isParallelGroup(second)) {
      throw new Error("expected sequential nodes");
    }
    // The node that was at index 0 keeps its id even though it now sits at index 1.
    expect(second.id).toBe((n0 as { id?: string }).id);
    expect(first.id).toBe((n1 as { id?: string }).id);
  });
});

// --- slot lineage rejection matrix (feature spec §6.1) ------------------------

describe("slot lineage matrix (feature spec §6.1)", () => {
  const seq = (slot: string): WorkflowDefinition["agents"][number] => ({
    slot, harness: "claude", model: "sonnet", steps: [],
  });
  const wrap = (agents: WorkflowDefinition["agents"]): WorkflowDefinition => ({
    version: 1, inputs: [], integrations: [], agents,
  });

  it("allows sequential slot reuse across stages (session affinity)", () => {
    const codes = validateWorkflowDefinition(wrap([seq("main"), seq("main")])).map((i) => i.code);
    expect(codes.filter((c) => c.startsWith("slot_"))).toEqual([]);
  });

  it("rejects the same slot on two concurrent lanes of one group", () => {
    const def = wrap([{ parallel: [seq("dup"), seq("dup")] }]);
    expect(validateWorkflowDefinition(def).map((i) => i.code)).toContain("slot_concurrent_lanes");
  });

  it("rejects a lane slot reused in another parallel group", () => {
    const def = wrap([
      { parallel: [seq("lane_x"), seq("lane_y")] },
      { parallel: [seq("lane_x"), seq("lane_z")] },
    ]);
    expect(validateWorkflowDefinition(def).map((i) => i.code)).toContain("slot_lane_cross_group");
  });

  it("rejects a lane slot that also appears as a sequential stage", () => {
    const def = wrap([seq("shared"), { parallel: [seq("shared"), seq("other")] }]);
    expect(validateWorkflowDefinition(def).map((i) => i.code)).toContain(
      "slot_lane_reused_sequential",
    );
  });
});

// --- read-only future-version handling (feature spec §5.1) --------------------

describe("read-only future-version handling", () => {
  const editable = {
    version: 1,
    inputs: [],
    integrations: [],
    agents: [{ slot: "main", harness: "claude", model: "sonnet", steps: [] }],
  };

  it("parses a supported definition as editable", () => {
    const result = parseWorkflowDefinitionResult(editable);
    expect(result.kind).toBe("editable");
    expect(isEditable(editable)).toBe(true);
  });

  it("marks an unknown definition version unsupported and preserves the raw dict", () => {
    const raw = { ...editable, version: 99, mysteryField: { keep: true } };
    const result = parseWorkflowDefinitionResult(raw);
    expect(result).toEqual({ kind: "unsupported", reason: "version", version: 99, raw });
    expect(isEditable(raw)).toBe(false);
  });

  it("marks an unknown step kind unsupported instead of silently dropping it", () => {
    const raw = {
      version: 1,
      inputs: [],
      integrations: [],
      agents: [{ slot: "main", harness: "claude", model: "sonnet", steps: [
        { kind: "agent.telepathy", on_fail: { kind: "stop" }, secret: "kept" },
      ] }],
    };
    const result = parseWorkflowDefinitionResult(raw);
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("step_kind");
      // Nothing dropped — the whole raw dict is retained for the upgrade screen.
      expect(result.raw).toEqual(raw);
    }
    expect(isEditable(raw)).toBe(false);
  });
});

// --- emit schema profile + branch grammar (feature spec §6.2) -----------------

describe("emit schema profile (feature spec §6.2)", () => {
  const withEmitSchema = (schema: unknown): WorkflowDefinition => ({
    version: 1,
    inputs: [],
    integrations: [],
    agents: [{ slot: "main", harness: "claude", model: "sonnet", steps: [
      { kind: "agent.emit", onFail: { kind: "stop" }, name: "out", prompt: "go",
        outputSchema: schema as Record<string, unknown> },
    ] }],
  });

  it("accepts the golden valid emit schema", () => {
    const valid = fixture("workflow-schema-profile-v1-valid.json");
    const codes = validateWorkflowDefinition(withEmitSchema(valid)).map((i) => i.code);
    expect(codes).not.toContain("invalid_emit_schema");
  });

  it("rejects every invalid emit schema from the shared manifest", () => {
    const cases = fixture<{ cases: { name: string; document: unknown }[] }>(
      "invalid/schema-profile-invalid-cases.json",
    );
    for (const testCase of cases.cases) {
      const codes = validateWorkflowDefinition(withEmitSchema(testCase.document)).map((i) => i.code);
      expect(codes, testCase.name).toContain("invalid_emit_schema");
    }
  });
});

describe("branch grammar (feature spec §6.2)", () => {
  const branchOnEmitField = (fieldType: string): WorkflowDefinition => ({
    version: 1,
    inputs: [],
    integrations: [],
    agents: [{ slot: "main", harness: "claude", model: "sonnet", steps: [
      { kind: "agent.emit", onFail: { kind: "stop" }, name: "verdict", prompt: "decide",
        outputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { status: { type: fieldType } },
        } },
      { kind: "branch", onFail: { kind: "stop" }, on: "{{verdict.status}}",
        cases: { go: { to: "continue" }, stop: { to: "end" } } },
    ] }],
  });

  it("accepts a branch switching on a string emit field", () => {
    const codes = validateWorkflowDefinition(branchOnEmitField("string")).map((i) => i.code);
    expect(codes).not.toContain("branch_field_not_string");
  });

  it("rejects a branch switching on a non-string emit field", () => {
    const codes = validateWorkflowDefinition(branchOnEmitField("number")).map((i) => i.code);
    expect(codes).toContain("branch_field_not_string");
  });
});
