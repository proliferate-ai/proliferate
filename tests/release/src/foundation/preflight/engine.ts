/**
 * Policy-aware secret/capability preflight engine.
 *
 * Runs after cell + artifact selection and BEFORE any world provisioning,
 * account mutation, or provider spend. It derives requirements from the
 * selected worlds/cells and checks only local availability and safe basic
 * shape. It never prints a value and never substitutes for provider auth or
 * health checks (those are world-readiness observations).
 *
 * Implements the frozen contracts/preflight.ts types. Diagnostic behavior marks
 * only affected cells blocked; strict behavior is evaluated by the runner, which
 * refuses to provision when this report is incomplete.
 */

import type {
  CapabilityRequirement,
  PreflightReport,
  RequirementResult,
  RequirementStatus,
} from "../contracts/preflight.js";
import type { PlatformKey } from "../contracts/artifacts.js";
import type { SelectedCellPlan } from "../contracts/plan.js";
import type { WorldId } from "../contracts/identity.js";

/** Local capability facts the preflight can observe without touching a provider. */
export interface PreflightSource {
  readonly env: NodeJS.ProcessEnv;
  /** Host platform, e.g. "darwin-aarch64". */
  readonly hostPlatform: PlatformKey | string;
  /** Whether a file path exists and is readable. */
  fileReadable(filePath: string): boolean;
  /** Artifact slot names available in the resolved manifest set. */
  readonly availableArtifactSlots: ReadonlySet<string>;
}

/**
 * Evaluates one requirement's local availability + safe shape. Never returns or
 * logs the value; `detail` is a redacted descriptor only.
 */
export function checkRequirement(req: CapabilityRequirement, source: PreflightSource): RequirementResult {
  switch (req.kind) {
    case "env-var":
      return checkEnvVar(req, source);
    case "file":
      return source.fileReadable(req.name)
        ? { requirement: req, status: "satisfied", detail: "readable" }
        : { requirement: req, status: "missing", detail: "not readable / does not exist" };
    case "host-platform": {
      const ok = source.hostPlatform === req.name || source.hostPlatform.startsWith(`${req.name}-`);
      return ok
        ? { requirement: req, status: "satisfied", detail: `host is ${source.hostPlatform}` }
        : { requirement: req, status: "missing", detail: `host is ${source.hostPlatform}, need ${req.name}` };
    }
    case "artifact-slot":
      return source.availableArtifactSlots.has(req.name)
        ? { requirement: req, status: "satisfied", detail: "slot available" }
        : { requirement: req, status: "missing", detail: "slot unavailable in resolved manifest" };
    default: {
      const exhaustive: never = req.kind;
      return { requirement: req, status: "missing", detail: `unknown requirement kind ${String(exhaustive)}` };
    }
  }
}

function checkEnvVar(req: CapabilityRequirement, source: PreflightSource): RequirementResult {
  const raw = source.env[req.name];
  const value = raw && raw.trim().length > 0 ? raw : undefined;
  if (value === undefined) {
    return { requirement: req, status: "missing", detail: "unset or empty" };
  }
  const shape = evaluateShape(req.shape, value);
  const status: RequirementStatus = shape.ok ? "satisfied" : "malformed";
  return { requirement: req, status, detail: shape.detail };
}

/** Safe, value-free shape checks. `detail` cites the named shape, never the value. */
function evaluateShape(shape: string | null, value: string): { ok: boolean; detail: string } {
  const length = value.length;
  switch (shape) {
    case null:
    case "non_empty":
      return { ok: true, detail: `present (${length} chars)` };
    case "sk_test_prefix":
      return value.startsWith("sk_test_")
        ? { ok: true, detail: `sk_test_ prefix ok (${length} chars)` }
        : { ok: false, detail: "wrong prefix (expected sk_test_)" };
    case "public_https_url":
      return isPublicHttpsUrl(value)
        ? { ok: true, detail: "public https url shape ok" }
        : { ok: false, detail: "not a public https url" };
    default:
      // An unknown named shape is a config bug, not a credential problem: treat
      // as satisfied-if-present but flag the unknown shape so it is visible.
      return { ok: true, detail: `present (${length} chars); unknown shape "${shape}"` };
  }
}

function isPublicHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host === "127.0.0.1" || host.startsWith("127.") || host === "0.0.0.0" || host === "::1") return false;
  return true;
}

/** Runs every requirement and rolls up blocked cells + completeness. */
export function runPreflight(
  requirements: readonly CapabilityRequirement[],
  source: PreflightSource,
): PreflightReport {
  const results = requirements.map((req) => checkRequirement(req, source));
  const blocked = new Set<string>();
  for (const result of results) {
    if (result.status !== "satisfied") {
      for (const cellKey of result.requirement.requiredByCellKeys) {
        blocked.add(cellKey);
      }
    }
  }
  return {
    results,
    blockedCellKeys: [...blocked].sort(),
    complete: results.every((r) => r.status === "satisfied"),
  };
}

/**
 * Derives the capability requirements for a selected plan. Requirements are
 * attributed to the exact cell keys that need them, so diagnostic blocking is
 * scoped to affected cells and evidence can cite which cell needs what.
 *
 * This is intentionally conservative: it covers the credential/artifact axes the
 * world dependency matrix names. World adapters may add narrower requirements,
 * but none may weaken these.
 */
export function deriveRequirements(plan: SelectedCellPlan): CapabilityRequirement[] {
  const byName = new Map<string, { req: Omit<CapabilityRequirement, "requiredByCellKeys">; cells: Set<string> }>();
  const add = (
    cellKey: string,
    kind: CapabilityRequirement["kind"],
    name: string,
    shape: string | null,
  ): void => {
    const id = `${kind}:${name}:${shape ?? ""}`;
    const existing = byName.get(id);
    if (existing) {
      existing.cells.add(cellKey);
    } else {
      byName.set(id, { req: { kind, name, shape }, cells: new Set([cellKey]) });
    }
  };

  for (const planned of plan.cells) {
    if (planned.disposition !== "required") continue;
    const { cell, cellKey } = planned;
    for (const spec of requirementsForWorld(cell.world, cell.scenarioId, cell.dimensions)) {
      add(cellKey, spec.kind, spec.name, spec.shape);
    }
  }

  return [...byName.values()].map(({ req, cells }) => ({
    ...req,
    requiredByCellKeys: [...cells].sort(),
  }));
}

interface RequirementSpec {
  kind: CapabilityRequirement["kind"];
  name: string;
  shape: string | null;
}

function isBillingCell(scenarioId: string, dimensions: Readonly<Record<string, string>>): boolean {
  return scenarioId.includes("BILL") || dimensions.billing === "true" || dimensions.plan === "core";
}

function requirementsForWorld(
  world: WorldId,
  scenarioId: string,
  dimensions: Readonly<Record<string, string>>,
): RequirementSpec[] {
  const specs: RequirementSpec[] = [];
  const stripe = (): void => {
    if (isBillingCell(scenarioId, dimensions)) {
      specs.push({ kind: "env-var", name: "STRIPE_TEST_SECRET_KEY", shape: "sk_test_prefix" });
    }
  };
  switch (world) {
    case "tier-2":
      specs.push({ kind: "artifact-slot", name: "serverImage", shape: null });
      specs.push({ kind: "artifact-slot", name: "webBuild", shape: null });
      stripe();
      break;
    case "local-runtime":
      specs.push({ kind: "artifact-slot", name: "serverImage", shape: null });
      specs.push({ kind: "artifact-slot", name: "anyharness", shape: null });
      specs.push({ kind: "env-var", name: "RELEASE_E2E_GATEWAY_TEST_KEY", shape: "non_empty" });
      specs.push({ kind: "env-var", name: "RELEASE_E2E_GATEWAY_BASE_URL", shape: "public_https_url" });
      stripe();
      break;
    case "managed-cloud":
      specs.push({ kind: "env-var", name: "E2B_API_KEY", shape: "non_empty" });
      specs.push({ kind: "env-var", name: "E2B_TEAM_ID", shape: "non_empty" });
      specs.push({ kind: "artifact-slot", name: "e2bTemplate", shape: null });
      specs.push({ kind: "env-var", name: "RELEASE_E2E_GATEWAY_BASE_URL", shape: "public_https_url" });
      stripe();
      break;
    case "self-host":
      specs.push({ kind: "env-var", name: "AWS_ACCESS_KEY_ID", shape: "non_empty" });
      specs.push({ kind: "env-var", name: "AWS_SECRET_ACCESS_KEY", shape: "non_empty" });
      specs.push({ kind: "artifact-slot", name: "selfHostBundle", shape: null });
      break;
    case "desktop-upgrade":
      specs.push({ kind: "host-platform", name: "darwin", shape: null });
      specs.push({ kind: "artifact-slot", name: "desktopApp", shape: null });
      specs.push({ kind: "artifact-slot", name: "desktopUpdater", shape: null });
      break;
    case "managed-cloud-upgrade":
      specs.push({ kind: "env-var", name: "E2B_API_KEY", shape: "non_empty" });
      specs.push({ kind: "env-var", name: "E2B_TEAM_ID", shape: "non_empty" });
      specs.push({ kind: "artifact-slot", name: "anyharness", shape: null });
      break;
    default: {
      const exhaustive: never = world;
      void exhaustive;
    }
  }
  return specs;
}
