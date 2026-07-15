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
 * on a cache miss. `buildAndUpload` is the part that talks to E2B — stubbed
 * here since RELEASE_E2E_E2B_API_KEY does not exist yet (see
 * src/config/env-manifest.ts). Swap the stub implementation for a real one
 * (e.g. wrapping scripts/build-template.mjs or the `e2b` SDK already a repo
 * dependency) without touching call sites.
 */
export interface E2BTemplateClient {
  buildAndUpload(inputs: TemplateInputs, e2bTeamId: string): Promise<string>;
}

export class NotImplementedTemplateBuildError extends Error {
  constructor() {
    super(
      "E2B template build/upload is stubbed (tier-3 runner phase 1) — no RELEASE_E2E_E2B_API_KEY " +
        "exists yet. Implement E2BTemplateClient.buildAndUpload against the real E2B API before " +
        "removing this stub.",
    );
    this.name = "NotImplementedTemplateBuildError";
  }
}

export class StubE2BTemplateClient implements E2BTemplateClient {
  async buildAndUpload(): Promise<string> {
    throw new NotImplementedTemplateBuildError();
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
