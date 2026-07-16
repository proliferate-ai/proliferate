import path from "node:path";

import { Template, defaultBuildLogger, waitForTimeout } from "e2b";

import { computeTemplateInputsHash, resolveTemplateInputs, type TemplateInputs } from "./content-hash.js";
import { lookupCachedTemplate, recordCachedTemplate, type TemplateCacheEntry } from "./cache-manifest.js";

export interface ResolvedTemplate {
  templateRef: string;
  hash: string;
  fromCache: boolean;
}

/**
 * Seam for the actual E2B build/upload call. `resolveOrBuild` computes the
 * content hash, checks the local cache manifest, and only reaches `buildAndUpload`
 * on a cache miss. Unit tests inject a fake so no real E2B build/upload/network
 * happens offline; `RealE2BTemplateClient` is the production implementation,
 * wrapping the `e2b` SDK `Template` builder exactly like
 * `scripts/build-template.mjs` and the managed-cloud world's own
 * `worlds/managed-cloud/template.ts` (2026-07-14 prework: E2B template
 * publication works non-interactively from env-var credentials).
 */
export interface E2BTemplateClient {
  buildAndUpload(inputs: TemplateInputs, e2bTeamId: string): Promise<string>;
}

export class NotImplementedTemplateBuildError extends Error {
  constructor() {
    super(
      "E2B template build/upload is stubbed (tier-3 runner phase 1) — this client is intentionally " +
        "inert. Use RealE2BTemplateClient (or a test fake) instead of StubE2BTemplateClient wherever " +
        "an actual build/upload is required.",
    );
    this.name = "NotImplementedTemplateBuildError";
  }
}

/**
 * Intentionally inert client kept for stub-compat with any existing caller
 * that wants a safe, always-throwing seam (e.g. a dry-run code path that must
 * never reach a real E2B call). Prefer `RealE2BTemplateClient` for an actual
 * build.
 */
export class StubE2BTemplateClient implements E2BTemplateClient {
  async buildAndUpload(): Promise<string> {
    throw new NotImplementedTemplateBuildError();
  }
}

/** Resolves the E2B API key VALUE from the ambient environment only — never argv, never a field. */
function requireE2bApiKey(): string {
  const apiKey = process.env.RELEASE_E2E_E2B_API_KEY ?? process.env.E2B_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RELEASE_E2E_E2B_API_KEY (or E2B_API_KEY) is required to build/upload an E2B template — set it via " +
        "the ambient environment (never argv, never a field).",
    );
  }
  return apiKey;
}

/**
 * Real `E2BTemplateClient` wrapping the `e2b` SDK's `Template` builder,
 * mirroring `scripts/build-template.mjs`: base Debian 12 x86_64, the runtime
 * binary copied to `/home/user/anyharness` (NEVER `/tmp` — build-time `/tmp`
 * does not survive to the runtime sandbox), a ready command that returns
 * immediately. Returns the immutable provider template id.
 */
export class RealE2BTemplateClient implements E2BTemplateClient {
  async buildAndUpload(inputs: TemplateInputs, e2bTeamId: string): Promise<string> {
    const apiKey = requireE2bApiKey();
    const template = Template({ fileContextPath: path.dirname(inputs.runtimeBinaryPath) })
      .fromBaseImage()
      .setUser("root")
      .copy(path.basename(inputs.runtimeBinaryPath), "/home/user/anyharness", { mode: 0o755 })
      .makeDir("/home/user/workspace", { mode: 0o755, user: "user" })
      .setUser("user")
      .setWorkdir("/home/user/workspace")
      .setReadyCmd(waitForTimeout(0));

    const buildInfo = await Template.build(template, `proliferate-runtime-${e2bTeamId}`, {
      apiKey,
      onBuildLogs: defaultBuildLogger(),
    });
    return buildInfo.templateId;
  }
}

/**
 * Resolves a template ref for the given inputs, building only on a cache
 * miss. Returns `fromCache: false` and a placeholder ref under --dry-run when
 * inputs are unavailable (e.g. the runtime binary has not been built) —
 * callers must not treat a dry-run resolution as a real template ref.
 */
export async function resolveOrBuildTemplate(
  inputs: TemplateInputs,
  e2bTeamId: string,
  client: E2BTemplateClient,
  options: { dryRun: boolean; cacheDir?: string } = { dryRun: false },
): Promise<ResolvedTemplate> {
  const resolved = await resolveTemplateInputs(inputs);
  if (!resolved.available) {
    if (options.dryRun) {
      return { templateRef: "(dry-run: inputs unavailable)", hash: "(unavailable)", fromCache: false };
    }
    throw new Error(
      `Cannot compute template content hash — missing input path(s): ${resolved.missingPaths.join(", ")}`,
    );
  }

  const hash = await computeTemplateInputsHash(inputs);
  if (options.dryRun) {
    const cached = await lookupCachedTemplate(hash, e2bTeamId, options.cacheDir);
    return { templateRef: cached?.templateRef ?? "(dry-run: would build)", hash, fromCache: cached !== undefined };
  }

  const cached = await lookupCachedTemplate(hash, e2bTeamId, options.cacheDir);
  if (cached) {
    return { templateRef: cached.templateRef, hash, fromCache: true };
  }

  const templateRef = await client.buildAndUpload(inputs, e2bTeamId);
  const entry: TemplateCacheEntry = { templateRef, builtAt: new Date().toISOString(), e2bTeamId };
  await recordCachedTemplate(hash, entry, options.cacheDir);
  return { templateRef, hash, fromCache: false };
}
