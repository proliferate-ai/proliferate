/**
 * Managed-cloud world configuration, resolved from the merged environment
 * (ambient over parsed data files) — preparation input, not scenario config.
 *
 * The provisioner receives this typed config plus the WorldContext. It never
 * reads process.env directly, so tests inject config and CI/local differ only
 * in how the MergedEnv is sourced. Presence flags let the provisioner report
 * exactly which conditional capabilities are verifiable without ever holding a
 * value longer than the redaction boundary.
 */

import { loadMergedEnv, type MergedEnv } from "./env-file.js";
import type { E2BTemplateResolver } from "./template-identity.js";

export const DEFAULT_GITHUB_TEST_REPO = "proliferate-e2e/e2e-fixture";

export interface ManagedCloudSecrets {
  /** Present values, keyed by env name, for the redaction boundary only. */
  readonly byName: Readonly<Record<string, string>>;
}

export interface ManagedCloudWorldConfig {
  /** Public candidate API origin+prefix (RELEASE_E2E_SERVER_URL). */
  readonly apiUrl: string;
  /** Public LiteLLM inference origin, or null when unconfigured. */
  readonly gatewayOrigin: string | null;
  readonly gatewayKeyPresent: boolean;
  readonly e2bApiKeyPresent: boolean;
  readonly e2bTeamId: string | null;
  /** `owner/repo` prepared qualification repository. */
  readonly preparedRepository: string;
  /** True when the GitHub App authorization tail can be exercised (seed creds). */
  readonly githubAppAuthorityAvailable: boolean;
  /** Only present secret values, for redaction. */
  readonly secrets: ManagedCloudSecrets;
  /** Optional injected resolver to pin a rolling template ref to an immutable build. */
  readonly templateResolver: E2BTemplateResolver | null;
}

const SECRET_NAMES = [
  "RELEASE_E2E_GATEWAY_TEST_KEY",
  "RELEASE_E2E_E2B_API_KEY",
  "RELEASE_E2E_INTEGRATION_API_KEY",
  "RELEASE_E2E_GITHUB_APP_SEED_REFRESH_TOKEN",
  "RELEASE_E2E_GITHUB_TEST_TOKEN",
] as const;

export class MissingManagedCloudApiUrlError extends Error {
  constructor() {
    super(
      "RELEASE_E2E_SERVER_URL is required for the managed-cloud world: sandboxes call back into it for " +
        "integrations, gateway auth, and the worker control loop. It must be a publicly reachable candidate " +
        "API origin (staging satisfies this; a purely local run needs a tunnel).",
    );
    this.name = "MissingManagedCloudApiUrlError";
  }
}

export interface ResolveConfigOptions {
  readonly env?: MergedEnv;
  /** True when the GitHub App authorization seed is available (fixture check). */
  readonly githubAppAuthorityAvailable?: boolean;
  readonly templateResolver?: E2BTemplateResolver | null;
}

/**
 * Builds the managed-cloud config from the merged environment. Throws only for
 * the one hard prerequisite (a candidate API URL); every other dependency is
 * expressed as a presence flag so the provisioner can decide readiness and
 * emit precise blocked reasons.
 */
export function resolveManagedCloudConfig(options: ResolveConfigOptions = {}): ManagedCloudWorldConfig {
  const env = options.env ?? loadMergedEnv();

  const apiUrl = env.get("RELEASE_E2E_SERVER_URL");
  if (!apiUrl) {
    throw new MissingManagedCloudApiUrlError();
  }

  const byName: Record<string, string> = {};
  for (const name of SECRET_NAMES) {
    const value = env.get(name);
    if (value) byName[name] = value;
  }

  return {
    apiUrl,
    gatewayOrigin: env.get("RELEASE_E2E_GATEWAY_BASE_URL") ?? null,
    gatewayKeyPresent: env.present("RELEASE_E2E_GATEWAY_TEST_KEY"),
    e2bApiKeyPresent: env.present("RELEASE_E2E_E2B_API_KEY"),
    e2bTeamId: env.get("RELEASE_E2E_E2B_TEAM_ID") ?? null,
    preparedRepository: env.get("RELEASE_E2E_GITHUB_TEST_REPO") ?? DEFAULT_GITHUB_TEST_REPO,
    githubAppAuthorityAvailable: options.githubAppAuthorityAvailable ?? false,
    secrets: { byName },
    templateResolver: options.templateResolver ?? null,
  };
}
