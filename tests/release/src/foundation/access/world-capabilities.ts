/**
 * Per-world CapabilityRequirement sets for the preflight engine, plus a
 * local-shape-only checker.
 *
 * Encodes the "Required composition" / "Conditional composition" columns of
 * the World Dependency Matrix
 * (specs/developing/testing/release-worlds-and-fixtures.md#world-dependency-matrix)
 * as frozen-contract `CapabilityRequirement`s (contracts/preflight.ts). This
 * is the foundation-layer declaration of what a world needs; concrete
 * scenario workstreams own the real `requiredByCellKeys` for their cells —
 * the placeholder keys here (`"<world>:base"`, `"<world>:billing"`, ...)
 * exist so a caller can already run preflight before any concrete cell
 * plan is wired up, and are meant to be re-attributed once one is.
 *
 * `checkRequirement` performs only local availability/shape checks — per
 * the frozen contract's own docstring, preflight "never substitutes for
 * provider authentication or health checks." Live checks (gh auth status,
 * aws sts get-caller-identity, ...) are a separate, broader diagnostic in
 * `audit.ts`, not part of this contract-shaped preflight surface.
 */

import { existsSync, statSync } from "node:fs";

import type { CapabilityRequirement, RequirementResult } from "../contracts/preflight.js";
import type { WorldId } from "../contracts/identity.js";
import { describeShape, matchesShape, type ShapeName } from "./redaction.js";
import type { LocalEnvironment } from "./env-file.js";

function envReq(name: string, shape: ShapeName | null, world: WorldId, scope: string): CapabilityRequirement {
  return { kind: "env-var", name, shape, requiredByCellKeys: [`${world}:${scope}`] };
}

function platformReq(name: string, world: WorldId, scope: string): CapabilityRequirement {
  return { kind: "host-platform", name, shape: null, requiredByCellKeys: [`${world}:${scope}`] };
}

/**
 * The foundation-layer capability declaration for one world. Base
 * requirements gate the world itself; the others are named by the matrix
 * row that motivates them and only bind the cells that actually select that
 * conditional composition.
 */
export function capabilityRequirementsForWorld(world: WorldId): readonly CapabilityRequirement[] {
  switch (world) {
    case "tier-2":
      // Real server/Postgres/browser hosts boot from source; no external
      // credential gates the base world. Stripe test mode is the one
      // standing real-network exception, required only for billing cells.
      return [envReq("STRIPE_SECRET_KEY", "sk_test_prefix", world, "billing")];

    case "local-runtime":
      return [
        envReq("RELEASE_E2E_GATEWAY_TEST_KEY", "non_empty", world, "base"),
        envReq("RELEASE_E2E_GATEWAY_BASE_URL", "public_https_url", world, "base"),
        envReq("STRIPE_SECRET_KEY", "sk_test_prefix", world, "billing"),
      ];

    case "managed-cloud":
      return [
        envReq("RELEASE_E2E_E2B_API_KEY", "e2b_key_prefix", world, "base"),
        envReq("RELEASE_E2E_E2B_TEAM_ID", "non_empty", world, "base"),
        envReq("RELEASE_E2E_GATEWAY_TEST_KEY", "non_empty", world, "base"),
        envReq("RELEASE_E2E_GATEWAY_BASE_URL", "public_https_url", world, "base"),
        envReq("STRIPE_SECRET_KEY", "sk_test_prefix", world, "billing"),
      ];

    case "self-host":
      return [
        // Opt-in switch authorizing real EC2 spend; absent -> scenarios
        // report blocked rather than provisioning (see env-vars.yaml
        // RELEASE_E2E_SELFHOST_PROVISION). Not a credential, but still a
        // local-availability gate on the base world.
        envReq("RELEASE_E2E_SELFHOST_PROVISION", "non_empty", world, "provision"),
        envReq("RELEASE_E2E_SELFHOST_URL", "non_empty", world, "standing-box"),
      ];

    case "desktop-upgrade":
      // "macOS host" is explicit required composition for this world.
      return [platformReq("darwin", world, "base")];

    case "managed-cloud-upgrade":
      return [
        envReq("RELEASE_E2E_STAGING_ECS_PIN_BUMP", "non_empty", world, "base"),
        envReq("RELEASE_E2E_E2B_API_KEY", "e2b_key_prefix", world, "base"),
        envReq("RELEASE_E2E_GATEWAY_TEST_KEY", "non_empty", world, "base"),
      ];

    default: {
      const exhaustive: never = world;
      throw new Error(`no capability requirements encoded for world "${exhaustive}"`);
    }
  }
}

export interface CheckRequirementContext {
  readonly env?: LocalEnvironment;
  readonly ambient?: NodeJS.ProcessEnv;
}

/**
 * Local-shape-only check: presence and named shape for env-var kinds,
 * readability for file kinds, and `process.platform` match for
 * host-platform kinds. Never makes a network/provider call. `artifact-slot`
 * is out of scope here — that completeness question is answered by
 * `../artifacts/world-slots.ts` against an actual manifest.
 */
export function checkRequirement(requirement: CapabilityRequirement, ctx: CheckRequirementContext = {}): RequirementResult {
  switch (requirement.kind) {
    case "env-var": {
      const value = ctx.env ? ctx.env.resolve(requirement.name) : ctx.ambient?.[requirement.name];
      if (value === undefined || value.trim().length === 0) {
        return { requirement, status: "missing", detail: describeShape(undefined) };
      }
      if (requirement.shape && !matchesShape(requirement.shape as ShapeName, value)) {
        return { requirement, status: "malformed", detail: `${describeShape(value)}, expected shape "${requirement.shape}"` };
      }
      return { requirement, status: "satisfied", detail: describeShape(value) };
    }
    case "file": {
      if (!existsSync(requirement.name)) {
        return { requirement, status: "missing", detail: "not found" };
      }
      try {
        const stats = statSync(requirement.name);
        return stats.isFile()
          ? { requirement, status: "satisfied", detail: `present (${stats.size} bytes)` }
          : { requirement, status: "malformed", detail: "exists but is not a regular file" };
      } catch {
        return { requirement, status: "missing", detail: "not accessible" };
      }
    }
    case "host-platform": {
      const actual = process.platform;
      return actual === requirement.name
        ? { requirement, status: "satisfied", detail: `running on ${actual}` }
        : { requirement, status: "missing", detail: `running on ${actual}, requires ${requirement.name}` };
    }
    case "artifact-slot":
      return { requirement, status: "missing", detail: "artifact-slot completeness is checked against a manifest, not local shape" };
    default: {
      const exhaustive: never = requirement.kind;
      return { requirement, status: "missing", detail: `unrecognized requirement kind "${exhaustive}"` };
    }
  }
}
