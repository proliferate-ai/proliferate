/**
 * Workflow contract-shape types + strict parsers (WS1).
 *
 * Transport shapes for the four run contracts (feature spec §5) and their
 * derived messages. Parsing is strict: unknown top-level fields, unknown
 * step/spine/capability kinds, and unknown contract versions are rejected — the
 * same posture as the Rust `deny_unknown_fields` types and the Python
 * `extra="forbid"` models. These types are intentionally not wired into the SDK
 * or editor in this packet.
 */

export class ContractParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractParseError";
  }
}

function obj(value: unknown, ctx: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractParseError(`${ctx}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function noUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], ctx: string): void {
  const set = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!set.has(key)) {
      throw new ContractParseError(`${ctx}: unknown field '${key}'`);
    }
  }
}

function requireVersion(record: Record<string, unknown>, field: string, expected: number, ctx: string): void {
  if (record[field] !== expected) {
    throw new ContractParseError(`${ctx}: unsupported ${field} ${String(record[field])}; expected ${expected}`);
  }
}

// --- capability references ----------------------------------------------------

export type CapabilityRef =
  | {
      kind: "integration_tool";
      providerDefinitionId: string;
      providerRevision: string;
      toolName: string;
      inputSchemaHash: string;
    }
  | { kind: "function"; definitionId: string; semanticRevision: number }
  | { kind: "product_mcp"; definition: string; policyRevision: number };

export function parseCapabilityRef(value: unknown, ctx: string): CapabilityRef {
  const record = obj(value, ctx);
  switch (record.kind) {
    case "integration_tool":
      noUnknownKeys(record, ["kind", "providerDefinitionId", "providerRevision", "toolName", "inputSchemaHash"], ctx);
      break;
    case "function":
      noUnknownKeys(record, ["kind", "definitionId", "semanticRevision"], ctx);
      break;
    case "product_mcp":
      noUnknownKeys(record, ["kind", "definition", "policyRevision"], ctx);
      break;
    default:
      throw new ContractParseError(`${ctx}: unknown capability kind '${String(record.kind)}'`);
  }
  return record as unknown as CapabilityRef;
}

// --- steps --------------------------------------------------------------------

export type WorkflowStep =
  | { kind: "agent.prompt"; stepId: string; stepKey: string; onFail: string; prompt: string }
  | {
      kind: "agent.emit";
      stepId: string;
      stepKey: string;
      onFail: string;
      emitName: string;
      prompt: string;
      correctionBudget: number;
      schema: Record<string, unknown>;
    }
  | {
      kind: "branch";
      stepId: string;
      stepKey: string;
      onFail: string;
      on: string;
      cases: Record<string, "continue" | "end">;
    }
  | {
      kind: "required_invocation";
      stepId: string;
      stepKey: string;
      onFail: string;
      correctionBudget: number;
      prompt: string;
      capability: CapabilityRef;
    };

export function parseStep(value: unknown, ctx: string): WorkflowStep {
  const record = obj(value, ctx);
  switch (record.kind) {
    case "agent.prompt":
      noUnknownKeys(record, ["kind", "stepId", "stepKey", "onFail", "prompt"], ctx);
      break;
    case "agent.emit":
      noUnknownKeys(record, ["kind", "stepId", "stepKey", "onFail", "emitName", "prompt", "correctionBudget", "schema"], ctx);
      break;
    case "branch":
      noUnknownKeys(record, ["kind", "stepId", "stepKey", "onFail", "on", "cases"], ctx);
      break;
    case "required_invocation":
      noUnknownKeys(record, ["kind", "stepId", "stepKey", "onFail", "correctionBudget", "prompt", "capability"], ctx);
      parseCapabilityRef(record.capability, `${ctx}.capability`);
      break;
    default:
      throw new ContractParseError(`${ctx}: unknown step kind '${String(record.kind)}'`);
  }
  return record as unknown as WorkflowStep;
}

// --- spine --------------------------------------------------------------------

export interface WorkflowSlot {
  slotId: string;
  label: string;
  requestedConfig: { harness: string; model: string; mode: string };
  effectiveConfig: { harness: string; model: string; mode: string };
  capabilitySubset: CapabilityRef[];
}

export type WorkflowSpineEntry =
  | { kind: "sequential"; nodeId: string; slotId: string; steps: WorkflowStep[] }
  | {
      kind: "parallel";
      groupId: string;
      lanes: { laneId: string; slotId: string; steps: WorkflowStep[] }[];
    };

function parseSpineEntry(value: unknown, ctx: string): WorkflowSpineEntry {
  const record = obj(value, ctx);
  if (record.kind === "sequential") {
    noUnknownKeys(record, ["kind", "nodeId", "slotId", "steps"], ctx);
    (record.steps as unknown[]).forEach((s, i) => parseStep(s, `${ctx}.steps[${i}]`));
  } else if (record.kind === "parallel") {
    noUnknownKeys(record, ["kind", "groupId", "lanes"], ctx);
    (record.lanes as unknown[]).forEach((lane, li) => {
      const laneObj = obj(lane, `${ctx}.lanes[${li}]`);
      noUnknownKeys(laneObj, ["laneId", "slotId", "steps"], `${ctx}.lanes[${li}]`);
      (laneObj.steps as unknown[]).forEach((s, si) => parseStep(s, `${ctx}.lanes[${li}].steps[${si}]`));
    });
  } else {
    throw new ContractParseError(`${ctx}: unknown spine entry kind '${String(record.kind)}'`);
  }
  return record as unknown as WorkflowSpineEntry;
}

// --- resolved plan (feature spec §5.2) ---------------------------------------

export interface ResolvedPlan {
  planVersion: 2;
  planHash: string;
  runId: string;
  workflowId: string;
  workflowVersionId: string;
  versionN: number;
  target: string;
  isolation: string;
  sourceIntent: Record<string, unknown>;
  inputs: Record<string, { type: string; value: unknown }>;
  capabilities: CapabilityRef[];
  slots: WorkflowSlot[];
  spine: WorkflowSpineEntry[];
}

const PLAN_KEYS = [
  "planVersion", "planHash", "runId", "workflowId", "workflowVersionId", "versionN",
  "target", "isolation", "sourceIntent", "inputs", "capabilities", "slots", "spine",
] as const;

export function parseResolvedPlan(value: unknown): ResolvedPlan {
  const record = obj(value, "ResolvedPlan");
  noUnknownKeys(record, PLAN_KEYS, "ResolvedPlan");
  requireVersion(record, "planVersion", 2, "ResolvedPlan");
  (record.capabilities as unknown[]).forEach((c, i) => parseCapabilityRef(c, `ResolvedPlan.capabilities[${i}]`));
  (record.slots as unknown[]).forEach((slot, i) => {
    const slotObj = obj(slot, `ResolvedPlan.slots[${i}]`);
    noUnknownKeys(slotObj, ["slotId", "label", "requestedConfig", "effectiveConfig", "capabilitySubset"], `ResolvedPlan.slots[${i}]`);
    (slotObj.capabilitySubset as unknown[]).forEach((c, ci) =>
      parseCapabilityRef(c, `ResolvedPlan.slots[${i}].capabilitySubset[${ci}]`),
    );
  });
  (record.spine as unknown[]).forEach((entry, i) => parseSpineEntry(entry, `ResolvedPlan.spine[${i}]`));
  return record as unknown as ResolvedPlan;
}

// --- checkpoint manifest (feature spec §5.3) ---------------------------------

export interface CheckpointEntry {
  path: string;
  origin: "tracked" | "untracked";
  mode: "100644" | "100755" | "120000" | "160000";
  sha256?: string;
  submoduleOid?: string;
}

export interface CheckpointManifest {
  schemaVersion: 1;
  repositoryObjectFormat: "sha1" | "sha256";
  baseOid: string;
  indexEntries: CheckpointEntry[];
  worktreeEntries: CheckpointEntry[];
}

const MODES = new Set(["100644", "100755", "120000", "160000"]);
const UNPADDED_BASE64 = /^[A-Za-z0-9+/]+$/;

function parseCheckpointEntry(value: unknown, ctx: string): CheckpointEntry {
  const record = obj(value, ctx);
  noUnknownKeys(record, ["path", "origin", "mode", "sha256", "submoduleOid"], ctx);
  const path = record.path;
  if (typeof path !== "string" || path.includes("=") || !UNPADDED_BASE64.test(path)) {
    throw new ContractParseError(`${ctx}: path must be unpadded base64`);
  }
  if (record.origin !== "tracked" && record.origin !== "untracked") {
    throw new ContractParseError(`${ctx}: invalid origin '${String(record.origin)}'`);
  }
  if (typeof record.mode !== "string" || !MODES.has(record.mode)) {
    throw new ContractParseError(`${ctx}: invalid mode '${String(record.mode)}'`);
  }
  if (record.mode === "160000") {
    if (typeof record.submoduleOid !== "string") {
      throw new ContractParseError(`${ctx}: gitlink requires submoduleOid`);
    }
    if (record.sha256 !== undefined) {
      throw new ContractParseError(`${ctx}: gitlink must not carry sha256`);
    }
  } else {
    if (typeof record.sha256 !== "string") {
      throw new ContractParseError(`${ctx}: blob entries require sha256`);
    }
    if (record.submoduleOid !== undefined) {
      throw new ContractParseError(`${ctx}: only gitlinks carry submoduleOid`);
    }
  }
  return record as unknown as CheckpointEntry;
}

export function parseCheckpointManifest(value: unknown): CheckpointManifest {
  const record = obj(value, "CheckpointManifest");
  noUnknownKeys(record, ["schemaVersion", "repositoryObjectFormat", "baseOid", "indexEntries", "worktreeEntries"], "CheckpointManifest");
  requireVersion(record, "schemaVersion", 1, "CheckpointManifest");
  if (record.repositoryObjectFormat !== "sha1" && record.repositoryObjectFormat !== "sha256") {
    throw new ContractParseError("CheckpointManifest: invalid repositoryObjectFormat");
  }
  (record.indexEntries as unknown[]).forEach((e, i) => parseCheckpointEntry(e, `CheckpointManifest.indexEntries[${i}]`));
  (record.worktreeEntries as unknown[]).forEach((e, i) => parseCheckpointEntry(e, `CheckpointManifest.worktreeEntries[${i}]`));
  return record as unknown as CheckpointManifest;
}

/** Sort entry arrays by raw path bytes so an unsorted input restores identically. */
export function normalizeCheckpointManifest(raw: Record<string, unknown>): Record<string, unknown> {
  const decode = (b64: string): Uint8Array => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const clean = b64.replace(/=+$/, "");
    const bytes: number[] = [];
    let buffer = 0;
    let bits = 0;
    for (const ch of clean) {
      const idx = alphabet.indexOf(ch);
      if (idx === -1) {
        continue;
      }
      buffer = (buffer << 6) | idx;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 0xff);
      }
    }
    return new Uint8Array(bytes);
  };
  const cmp = (a: Record<string, unknown>, b: Record<string, unknown>): number => {
    const pa = decode(a.path as string);
    const pb = decode(b.path as string);
    const len = Math.min(pa.length, pb.length);
    for (let i = 0; i < len; i += 1) {
      if (pa[i] !== pb[i]) {
        return pa[i] - pb[i];
      }
    }
    return pa.length - pb.length;
  };
  const normalized: Record<string, unknown> = { ...raw };
  for (const key of ["indexEntries", "worktreeEntries"]) {
    const entries = [...((raw[key] as Record<string, unknown>[]) ?? [])];
    entries.sort(cmp);
    normalized[key] = entries;
  }
  return normalized;
}

// --- generic strict parser for the remaining flat shapes ---------------------

function strictFlat(value: unknown, ctx: string, allowed: readonly string[], versions: Record<string, number>): Record<string, unknown> {
  const record = obj(value, ctx);
  noUnknownKeys(record, allowed, ctx);
  for (const [field, expected] of Object.entries(versions)) {
    requireVersion(record, field, expected, ctx);
  }
  return record;
}

export function parseMaterializationOffer(value: unknown): Record<string, unknown> {
  return strictFlat(
    value,
    "MaterializationOffer",
    ["schemaVersion", "runId", "planHash", "target", "executionGeneration", "executorId", "executorFence", "sourceIntent", "materializationCredential", "credentialGeneration", "expiresAt"],
    { schemaVersion: 1 },
  );
}

export function parseExecutionBinding(value: unknown): Record<string, unknown> {
  const record = strictFlat(
    value,
    "ExecutionBinding",
    ["schemaVersion", "target", "sourceKind", "repositoryObjectFormat", "baseCommitOid", "checkpointId", "checkpointContentHash", "workspaceId", "workspaceGeneration", "materializationId", "executorId", "executorGeneration", "bindingHash"],
    { schemaVersion: 1 },
  );
  if (record.sourceKind === "workspace_checkpoint" && (!record.checkpointId || !record.checkpointContentHash)) {
    throw new ContractParseError("ExecutionBinding: workspace_checkpoint requires checkpointId + checkpointContentHash");
  }
  return record;
}

export function parseExecutionEnvelope(value: unknown): Record<string, unknown> {
  const record = strictFlat(
    value,
    "ExecutionEnvelope",
    ["schemaVersion", "runId", "planHash", "bindingHash", "executionGeneration", "credentialGeneration", "expiresAt", "runReportCredential", "deliveryClaimFence", "privateCallbacks", "perSlotCredentialIssuance", "binding"],
    { schemaVersion: 1 },
  );
  parseExecutionBinding(record.binding);
  return record;
}

export function parseObservedRun(value: unknown): Record<string, unknown> {
  return strictFlat(
    value,
    "ObservedRun",
    ["schemaVersion", "runId", "planHash", "bindingHash", "executionGeneration", "revision", "observedState", "quiescenceState", "globalCursor", "laneCursors", "sessions", "steps", "worktrees", "cost", "timing"],
    { schemaVersion: 2 },
  );
}

export function parseGatewayCallReceipt(value: unknown): Record<string, unknown> {
  const record = strictFlat(
    value,
    "GatewayCallReceipt",
    ["schemaVersion", "receiptId", "runId", "planHash", "slotId", "sessionId", "stepKey", "attempt", "turnId", "activationId", "capability", "authorizationDecision", "outcome", "createdAt", "completedAt"],
    { schemaVersion: 1 },
  );
  parseCapabilityRef(record.capability, "GatewayCallReceipt.capability");
  return record;
}

export function parseWorkflowControlCommand(value: unknown): Record<string, unknown> {
  return strictFlat(
    value,
    "WorkflowControlCommand",
    ["schemaVersion", "commandId", "runId", "planHash", "bindingHash", "executionGeneration", "kind", "reason", "cancellationFence", "issuedAt"],
    { schemaVersion: 1 },
  );
}
