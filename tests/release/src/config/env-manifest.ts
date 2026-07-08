/**
 * Declared manifest of every environment variable the tier-3 release-e2e
 * runner needs. Per specs/developing/testing/README.md ("Running tier 3/4
 * locally"): every key is inventoried here with where to obtain it, and the
 * runner fails fast with a named-variable error when one is missing. No
 * scenario ever embeds a credential directly — everything is read through
 * `resolveEnv` in `./env-resolution.ts`.
 *
 * None of these credentials exist yet (tracked as a follow-up: provisioning
 * the e2e-tests org, the gateway test key, and the E2B test team). Until then
 * this manifest only powers `--dry-run` reporting.
 */

import type { RuntimeLane } from "./types.js";

export interface EnvVarSpec {
  /** Exact environment variable name the runner reads. */
  name: string;
  /** What it is for, in one sentence. */
  description: string;
  /** Where the value lives / how to obtain it, for a human running this locally. */
  whereItLives: string;
  /** Whether this is a credential (never logged, never printed in full). */
  secret: boolean;
  /** Lanes that need this var; omitted means "all runtime lanes". */
  lanes?: readonly RuntimeLane[];
}

export const ENV_MANIFEST: readonly EnvVarSpec[] = [
  {
    name: "RELEASE_E2E_SERVER_URL",
    description:
      "Publicly reachable API base URL for the target lane. Staging satisfies this " +
      "directly; a local --lane=local run needs a tunnel (e.g. ngrok) fronting " +
      "the local profile's API port, since sandboxes must call back into it.",
    whereItLives:
      "Staging: the known staging API URL (see specs/developing/deploying/ci-cd.md). " +
      "Local: printed by the tunnel tool when `make run PROFILE=<name>` is fronted by one.",
    secret: false,
  },
  {
    name: "RELEASE_E2E_GATEWAY_TEST_KEY",
    description:
      "Dedicated LiteLLM gateway virtual key, allowlisted to the cheap test-model set " +
      "(one cheapest model per provider family; see T3-CHAT-1). All agent chat " +
      "traffic in this runner flows through the gateway with this key — no direct " +
      "provider keys in scenarios.",
    whereItLives:
      "Issued for an `e2e-tests` LiteLLM team on the target deployment's agent gateway. " +
      "Local dev: `~/.proliferate-local/dev/release-e2e.env`. CI: GitHub Actions secret " +
      "of the same name.",
    secret: true,
  },
  {
    name: "RELEASE_E2E_E2B_API_KEY",
    description:
      "E2B API key used to provision sandbox-lane cloud workspaces and to build/upload " +
      "the E2B runtime template.",
    whereItLives:
      "A dedicated E2B team reserved for release-e2e (not the production team). " +
      "Local: `~/.proliferate-local/dev/release-e2e.env`. CI: GitHub Actions secret.",
    secret: true,
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_E2B_TEAM_ID",
    description:
      "E2B team/org id that scopes the template content-hash cache manifest lookup " +
      "(see src/template/cache-manifest.ts) — template refs are only reusable within a team.",
    whereItLives: "Same E2B team dashboard as RELEASE_E2E_E2B_API_KEY.",
    secret: false,
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_DURABLE_USER_EMAIL",
    description:
      "Login email for the durable seeded e2e-tests account used by existing-user " +
      "scenarios (T3-PROV-2 and friends). Its sandbox intentionally persists between runs.",
    whereItLives:
      "Seeded once per target deployment via the same first-run/invite flow real users go " +
      "through (see server/proliferate/server/organizations/registration_api.py); " +
      "credentials recorded in the team credentials vault.",
    secret: false,
  },
  {
    name: "RELEASE_E2E_DURABLE_USER_PASSWORD",
    description: "Password for RELEASE_E2E_DURABLE_USER_EMAIL.",
    whereItLives: "Team credentials vault, alongside RELEASE_E2E_DURABLE_USER_EMAIL.",
    secret: true,
  },
  {
    name: "RELEASE_E2E_DURABLE_ORG_ID",
    description:
      "Organization id owning the durable user's account. Used as the inviting org when " +
      "the fresh-user fixture mints a new account (invitation-gated registration is the " +
      "only self-serve password-registration path in code today).",
    whereItLives: "Read from the durable user's `GET /v1/organizations` response once, then pinned here.",
    secret: false,
  },
  {
    name: "RELEASE_E2E_SLACK_WEBHOOK_URL",
    description:
      "Test Slack workspace incoming webhook, used by the real-integration-through-the-gateway " +
      "flow (T3-INT-1) and by workflow Slack-delivery scenarios.",
    whereItLives: "A disposable Slack workspace reserved for release-e2e; incoming webhook app config.",
    secret: true,
  },
  {
    name: "RELEASE_E2E_GITHUB_TEST_REPO",
    description:
      "`owner/repo` of a disposable GitHub repository used for worktree, repo-settings, and " +
      "checkout scenarios (T3-WT-1, T3-REPO-1).",
    whereItLives: "A repo under the proliferate-ai test org, reserved for release-e2e.",
    secret: false,
  },
  {
    name: "RELEASE_E2E_GITHUB_TEST_TOKEN",
    description: "Token with read/write access to RELEASE_E2E_GITHUB_TEST_REPO for checkout and push steps.",
    whereItLives: "A fine-scoped PAT or GitHub App installation token for the test repo only.",
    secret: true,
  },
] as const;

export function envVarNames(): string[] {
  return ENV_MANIFEST.map((spec) => spec.name);
}

export function findEnvVarSpec(name: string): EnvVarSpec | undefined {
  return ENV_MANIFEST.find((spec) => spec.name === name);
}
