/**
 * ManagedCloudWorldProvisioner — the managed-cloud world foundation.
 *
 * Implements the frozen WorldProvisioner contract (contracts/world.ts). It
 * prepares REUSABLE CAPACITY only and never pre-completes the first-user
 * provisioning behavior that CLOUD-PROVISION-1 is meant to prove. `prepare`
 * returns a typed ManagedCloudWorldHandle only after it has actually observed:
 *
 *   1. public candidate API reachability (RELEASE_E2E_SERVER_URL);
 *   2. an IMMUTABLE candidate E2B template identity (a sha-prefixed ref or
 *      build id — never a rolling tag; a rolling ref is resolved+pinned via the
 *      E2B resolver, and how it was pinned is recorded);
 *   3. qualification GitHub App authority + a prepared repository; and
 *   4. E2B / LiteLLM capability checks (conditional — recorded, not fatal).
 *
 * A required boundary (1 or 2) that is not ready makes it throw
 * WorldReadinessError with every observation attached, so a diagnostic run can
 * report the exact gap and a strict run fails before spend. Base preparation
 * registers no destructive run-scoped resource; those are scenario actions.
 */

import {
  WorldReadinessError,
  type ManagedCloudWorldHandle,
  type ReadinessObservation,
  type WorldContext,
  type WorldProvisioner,
} from "../../contracts/world.js";
import type { WorldId } from "../../contracts/identity.js";
import type { TemplateSlot } from "../../contracts/artifacts.js";
import type { ManagedCloudWorldConfig } from "./config.js";
import { fact, probeHttp, type FetchLike } from "./readiness.js";
import {
  resolveCandidateTemplateIdentity,
  TemplateIdentityError,
} from "./template-identity.js";
import { redactSecrets } from "./redaction.js";

export interface ManagedCloudProvisionerOptions {
  readonly fetchImpl?: FetchLike;
  /** Rolling ref the product would actually create sandboxes from, if known. */
  readonly observedRollingRef?: string;
  readonly observedVersionLabel?: string;
  readonly probeTimeoutMs?: number;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

export class ManagedCloudWorldProvisioner implements WorldProvisioner<ManagedCloudWorldHandle> {
  readonly world: WorldId = "managed-cloud";

  private readonly config: ManagedCloudWorldConfig;
  private readonly options: ManagedCloudProvisionerOptions;

  constructor(config: ManagedCloudWorldConfig, options: ManagedCloudProvisionerOptions = {}) {
    this.config = config;
    this.options = options;
  }

  async prepare(ctx: WorldContext): Promise<ManagedCloudWorldHandle> {
    const observations: ReadinessObservation[] = [];
    const verifiedCapabilities: string[] = [];
    const secretValues = Object.values(this.config.secrets.byName);
    const record = async (obs: ReadinessObservation, capability?: string): Promise<void> => {
      observations.push(obs);
      if (obs.ok && capability) verifiedCapabilities.push(capability);
      await ctx.evidence.append({
        kind: "world-readiness",
        world: this.world,
        runId: ctx.run.runId,
        shardId: ctx.shard.shardId,
        check: obs.check,
        ok: obs.ok,
        detail: redactSecrets(obs.detail, { secrets: secretValues }),
        observedAt: obs.observedAt,
      });
    };

    // 1. Public candidate API reachability (REQUIRED). Sandboxes call back into
    // it, so it must be reachable from this host.
    const apiObs = await probeHttp("candidate-api-reachability", joinUrl(this.config.apiUrl, "/health"), {
      fetchImpl: this.options.fetchImpl,
      timeoutMs: this.options.probeTimeoutMs,
    });
    await record(apiObs, "candidate-api");

    // 2. Immutable candidate E2B template identity (REQUIRED). Never a rolling tag.
    let template: TemplateSlot | null = null;
    try {
      const resolved = await resolveCandidateTemplateIdentity({
        candidateSlot: ctx.candidate.e2bTemplate,
        observedRollingRef: this.options.observedRollingRef,
        observedVersionLabel: this.options.observedVersionLabel,
        resolver: this.config.templateResolver,
      });
      template = resolved.slot;
      await record(
        fact("candidate-e2b-template-identity", true, `immutable ${resolved.slot.templateId} (${resolved.resolution})`),
        "e2b-template",
      );
    } catch (error) {
      const detail =
        error instanceof TemplateIdentityError
          ? error.message
          : `template identity resolution failed: ${error instanceof Error ? error.message : String(error)}`;
      await record(fact("candidate-e2b-template-identity", false, detail));
    }

    // 3. Qualification GitHub App authority + prepared repository (REQUIRED for
    // the provision slice; recorded here so the base handle advertises it).
    await record(
      fact(
        "github-app-authority",
        this.config.githubAppAuthorityAvailable,
        this.config.githubAppAuthorityAvailable
          ? "GitHub App authorization seed available (real user-to-server authorization + installation cache)"
          : "GitHub App authorization seed unavailable (RELEASE_E2E_GITHUB_APP_SEED_REFRESH_TOKEN / seed state + RELEASE_E2E_LOCAL_DATABASE_URL) — CLOUD-PROVISION-1 cannot exercise the real authorization tail",
      ),
      "github-app",
    );
    const repoOk = /^[^/\s]+\/[^/\s]+$/.test(this.config.preparedRepository);
    await record(
      fact(
        "prepared-repository",
        repoOk,
        repoOk ? `prepared repository ${this.config.preparedRepository}` : `invalid RELEASE_E2E_GITHUB_TEST_REPO "${this.config.preparedRepository}"`,
      ),
    );

    // 4. E2B capability (conditional). Needed to resolve/pin the template and
    // read provider ground truth.
    const e2bOk = this.config.e2bApiKeyPresent && Boolean(this.config.e2bTeamId);
    await record(
      fact(
        "e2b-capability",
        e2bOk,
        e2bOk
          ? "E2B API key + team id present"
          : "E2B API key/team absent (RELEASE_E2E_E2B_API_KEY / RELEASE_E2E_E2B_TEAM_ID) — cannot pin a rolling template to an immutable build or read provider ground truth",
      ),
      "e2b",
    );

    // 5. LiteLLM capability (conditional). Probe the public inference origin
    // when configured; otherwise fall back to key presence.
    const gatewayOrigin = this.config.gatewayOrigin;
    if (gatewayOrigin) {
      const gwObs = await probeHttp("litellm-capability", joinUrl(gatewayOrigin, "/health/liveliness"), {
        fetchImpl: this.options.fetchImpl,
        timeoutMs: this.options.probeTimeoutMs,
      });
      await record(gwObs, "litellm");
    } else {
      await record(
        fact(
          "litellm-capability",
          this.config.gatewayKeyPresent,
          this.config.gatewayKeyPresent
            ? "gateway virtual key present but RELEASE_E2E_GATEWAY_BASE_URL unset — inference origin not verified"
            : "no gateway key or public inference origin configured",
        ),
        // Not a verified inference route without a reachable origin, so this
        // never counts toward verifiedCapabilities.
        undefined,
      );
    }

    // Required boundaries decide the handle. Conditional capabilities are
    // recorded but do not block base readiness.
    const requiredChecks = ["candidate-api-reachability", "candidate-e2b-template-identity"];
    const failedRequired = observations.filter((o) => requiredChecks.includes(o.check) && !o.ok);
    if (failedRequired.length > 0 || template === null) {
      throw new WorldReadinessError(
        this.world,
        `managed-cloud world not ready: ${failedRequired.map((o) => `${o.check} (${o.detail})`).join("; ")}`,
        observations,
      );
    }

    return {
      world: "managed-cloud",
      run: ctx.run,
      shard: ctx.shard,
      readiness: observations,
      apiUrl: this.config.apiUrl,
      template,
      gatewayOrigin: gatewayOrigin ?? "",
      verifiedCapabilities,
    };
  }
}
