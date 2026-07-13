/**
 * Immutable candidate E2B template identity.
 *
 * The managed-cloud world REQUIRES the candidate sandbox to be bound to an
 * immutable template identity — a build id (E2B surfaces these as `sha-…` /
 * a build UUID), never a rolling alias like `base` or a rolling version label
 * like `v1`. The frozen contract (release-worlds-and-fixtures.md) is explicit:
 * "Rolling references such as `latest` or unverified `stable` cannot satisfy an
 * artifact slot" and "scenarios consume immutable template IDs."
 *
 * PRODUCT REALITY (verified 2026-07-13, server/proliferate/integrations/sandbox
 * /e2b.py + constants/sandbox/e2b.py): the product creates sandboxes from a
 * rolling template NAME (`E2B_TEMPLATE_NAME`, default `base`) and stores/returns
 * only a rolling version LABEL (`E2B_TEMPLATE_VERSION`, default `v1`) as
 * `e2bTemplateRef`. Neither is immutable. So a managed-cloud qualification run
 * cannot get an immutable identity from the product path alone — it must resolve
 * the alias to its current immutable build id via the E2B API and PIN it,
 * recording how the resolution was performed. See `contractGaps`/`productBugs`.
 */

import type { TemplateSlot, Slot } from "../../contracts/artifacts.js";

/**
 * A reference is immutable when it names a specific build, not a moving alias.
 * E2B build ids are surfaced as a `sha-` prefixed ref or a build UUID; a bare
 * alias (`base`, `latest`, `stable`) or a short version label (`v1`) is rolling.
 */
export function isImmutableTemplateRef(ref: string): boolean {
  const value = ref.trim();
  if (value.length === 0) return false;
  if (/^sha-[0-9a-f]{8,}$/i.test(value)) return true;
  // A build UUID (E2B build ids) is immutable.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return true;
  return false;
}

const ROLLING_ALIASES = new Set(["base", "latest", "stable", "main", "prod", "production"]);

/** True for the known rolling forms the product currently emits. */
export function isRollingTemplateRef(ref: string): boolean {
  const value = ref.trim().toLowerCase();
  if (value.length === 0) return true;
  if (ROLLING_ALIASES.has(value)) return true;
  if (/^v\d+$/.test(value)) return true; // v1, v2 — rolling version labels
  return !isImmutableTemplateRef(value);
}

/** Resolves an alias/name to its current immutable build id (an E2B API call). */
export interface E2BTemplateResolver {
  /**
   * Given a template name/alias (and optional version label), returns the
   * current immutable build identity plus a short human description of HOW it
   * was resolved (e.g. "e2b templates.get(base).latestBuild"). Throws if the
   * alias cannot be resolved.
   */
  resolveImmutableBuild(alias: string, version?: string): Promise<{ buildId: string; how: string }>;
}

export interface ResolvedTemplateIdentity {
  readonly slot: TemplateSlot;
  /** How the immutable identity was obtained, for evidence. */
  readonly resolution: string;
  /** True when the source was already immutable (no resolver needed). */
  readonly wasAlreadyImmutable: boolean;
}

export class TemplateIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateIdentityError";
  }
}

/**
 * Produces an immutable TemplateSlot for the candidate.
 *
 * Preference order:
 *  1. The candidate manifest's `e2bTemplate` slot, when available AND its
 *     templateId is already immutable — the intended qualification path where
 *     prepare-candidate built and pinned the template.
 *  2. Otherwise (slot unavailable, or its id is rolling), resolve the observed
 *     rolling ref to its current immutable build via the E2B resolver and pin
 *     it — recording exactly how. This is the documented workaround for the
 *     current product gap; it requires E2B API access.
 *
 * Fails (never silently accepts a rolling ref) when neither path yields an
 * immutable id.
 */
export async function resolveCandidateTemplateIdentity(input: {
  readonly candidateSlot: Slot<TemplateSlot>;
  /** The rolling ref the product would actually create from (name/alias). */
  readonly observedRollingRef?: string;
  readonly observedVersionLabel?: string;
  readonly resolver?: E2BTemplateResolver | null;
}): Promise<ResolvedTemplateIdentity> {
  const { candidateSlot } = input;

  if (candidateSlot.available) {
    const slot = candidateSlot.value;
    if (isImmutableTemplateRef(slot.templateId)) {
      if (slot.inputHash.trim().length === 0) {
        throw new TemplateIdentityError(
          "candidate template slot is immutable but carries an empty input hash; a template identity " +
            "must include the complete template-input hash.",
        );
      }
      return {
        slot,
        resolution: `candidate manifest e2bTemplate slot (immutable ${slot.templateId})`,
        wasAlreadyImmutable: true,
      };
    }
    // Available but rolling — fall through to resolution using the slot's id.
  }

  const rolling =
    input.observedRollingRef ??
    (candidateSlot.available ? candidateSlot.value.templateId : undefined);
  if (!rolling) {
    throw new TemplateIdentityError(
      candidateSlot.available
        ? `candidate template id "${candidateSlot.value.templateId}" is rolling and no resolver/ref was supplied to pin it`
        : `candidate e2bTemplate slot is unavailable (${(candidateSlot as { reason: string }).reason}) and no observed rolling ref was supplied`,
    );
  }

  if (!input.resolver) {
    throw new TemplateIdentityError(
      `observed only a rolling template ref ("${rolling}") and no E2B resolver is available to pin it to an ` +
        "immutable build id. Managed-cloud qualification cannot proceed against a rolling template " +
        "(release-worlds-and-fixtures.md). Provide E2B API access so the alias can be resolved and pinned.",
    );
  }

  const { buildId, how } = await input.resolver.resolveImmutableBuild(rolling, input.observedVersionLabel);
  if (!isImmutableTemplateRef(buildId)) {
    throw new TemplateIdentityError(
      `E2B resolver returned "${buildId}" for alias "${rolling}", which is not an immutable build id`,
    );
  }
  // The input hash we can attest to when pinning a live alias is the resolved
  // build id itself (the alias→build mapping is the content identity we pin).
  const inputHash =
    candidateSlot.available && candidateSlot.value.inputHash.trim().length > 0
      ? candidateSlot.value.inputHash
      : `resolved-build:${buildId}`;
  return {
    slot: { templateId: buildId, inputHash },
    resolution: `resolved rolling ref "${rolling}" -> immutable build ${buildId} via ${how}`,
    wasAlreadyImmutable: false,
  };
}
