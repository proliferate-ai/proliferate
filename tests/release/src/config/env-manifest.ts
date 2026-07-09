/**
 * Declared manifest of every environment variable the tier-3 release-e2e
 * runner needs. Per specs/developing/testing/README.md ("Running tier 3/4
 * locally"): every key is inventoried here with where to obtain it. A missing
 * credential does not fail the whole run — the runner reports just the
 * scenarios/lanes that require it as blocked (see `src/cli/run.ts`), so a
 * partially-credentialed environment still produces signal for everything it
 * can reach. No scenario ever embeds a credential directly — everything is
 * read through `resolveEnv` in `./env-resolution.ts`.
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
    name: "RELEASE_E2E_GATEWAY_BASE_URL",
    description:
      "Public inference base URL of the LiteLLM gateway RELEASE_E2E_GATEWAY_TEST_KEY was issued " +
      "against (the deployment's AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL). When both are set for a " +
      "--lane local run, the runner pushes a gateway-keyed agent-auth state document to the local " +
      "AnyHarness runtime (PUT /v1/agent-auth/state) so harnesses can chat with no native CLI " +
      "login — the CI path. Without it, local chat scenarios rely on whatever credential the " +
      "runtime already resolves (native CLI login on a laptop).",
    whereItLives:
      "The gateway deployment's public URL (same place the key was minted). " +
      "Local dev: `~/.proliferate-local/dev/release-e2e.env`. CI: GitHub Actions secret " +
      "alongside RELEASE_E2E_GATEWAY_TEST_KEY.",
    secret: false,
    lanes: ["local"],
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
      "scenarios (T3-PROV-2 and friends). Its sandbox intentionally persists between runs. " +
      "NOT used by --lane staging: staging's durable user (proliferate-e2e-bot, confirmed " +
      "2026-07-09) was created by a real GitHub OAuth sign-in and has no password — see " +
      "RELEASE_E2E_STAGING_SESSION_REFRESH_TOKEN below.",
    whereItLives:
      "Seeded once per target deployment via the same first-run/invite flow real users go " +
      "through (see server/proliferate/server/organizations/registration_api.py); " +
      "credentials recorded in the team credentials vault.",
    secret: false,
  },
  {
    name: "RELEASE_E2E_DURABLE_USER_PASSWORD",
    description: "Password for RELEASE_E2E_DURABLE_USER_EMAIL. NOT used by --lane staging (see above).",
    whereItLives: "Team credentials vault, alongside RELEASE_E2E_DURABLE_USER_EMAIL.",
    secret: true,
  },
  {
    name: "RELEASE_E2E_STAGING_SESSION_REFRESH_TOKEN",
    description:
      "Bootstrap-only refresh token for the staging durable user's product session " +
      "(proliferate-e2e-bot / support@proliferate.com, a GitHub-OAuth-only account with no " +
      "password). Used by tests/release/src/fixtures/staging-session.ts to authenticate " +
      "--lane staging existing-user scenarios in place of RELEASE_E2E_DURABLE_USER_EMAIL/" +
      "PASSWORD. Refresh tokens rotate on every use (POST /auth/mobile/session/refresh), so " +
      "after the first run the live token lives in the state file below; this env var is only " +
      "the initial bootstrap value.",
    whereItLives:
      "Minted once via `uv run python tests/release/scripts/staging_session_seed.py mint " +
      "proliferate-e2e-bot`, run inside a one-off in-VPC ECS task against proliferate-staging " +
      "(the staging DB is VPC-only — see that script's module docstring for the exact " +
      "aws ecs run-task invocation). Local dev: ~/.proliferate-local/dev/release-e2e.env " +
      "(or seed the state file directly). Never committed.",
    secret: true,
  },
  {
    name: "RELEASE_E2E_STAGING_SESSION_STATE",
    description:
      "Path to the JSON state file holding the current (rotating) staging session refresh " +
      "token. Optional override; defaults to " +
      "~/.proliferate-local/dev/release-e2e-staging-session.json. " +
      "tests/release/src/fixtures/staging-session.ts rewrites it atomically after each " +
      "rotation, so re-authenticating is possible without re-supplying the bootstrap token.",
    whereItLives: "Written and maintained by tests/release/src/fixtures/staging-session.ts. Operator override only.",
    secret: false,
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
      "Test Slack workspace incoming webhook, used by workflow Slack-delivery scenarios. " +
      "NOT used by T3-INT-1: see RELEASE_E2E_INTEGRATION_API_KEY (the cataloged Slack integration " +
      "is oauth2/hosted-MCP, not api_key — src/fixtures/integrations.ts).",
    whereItLives: "A disposable Slack workspace reserved for release-e2e; incoming webhook app config.",
    secret: true,
  },
  {
    name: "RELEASE_E2E_SLACK_BOT_TOKEN",
    description:
      "Slack bot token for the proliferate-e2e workspace (#e2e-deliveries). Declared per the " +
      "T3-INT-1 build task, but NOT usable against the shipped catalog: the cataloged Slack " +
      "integration is auth_kind=oauth2 (hosted MCP at mcp.slack.com), so a bot token cannot be " +
      "stored as an api_key credential. Use RELEASE_E2E_INTEGRATION_API_KEY against an api_key-kind " +
      "seed integration instead. Kept as a placeholder pending a Slack-as-api_key definition or a " +
      "ruling to drop it.",
    whereItLives:
      "Would be minted as a Slack app in the proliferate-e2e workspace (scopes chat:write + " +
      "channels:read) — but see the description: the cataloged Slack definition does not accept it.",
    secret: true,
  },
  {
    name: "RELEASE_E2E_INTEGRATION_NAMESPACE",
    description:
      "Which cataloged api_key-kind seed integration T3-INT-1 authenticates and calls through the " +
      "gateway. Must be one of context7|exa|tavily|render|neon (validated in " +
      "src/fixtures/integrations.ts). Defaults to `exa` (free key, side-effect-free search tool call).",
    whereItLives: "Operator choice; the default `exa` needs only a free Exa API key.",
    secret: false,
  },
  {
    name: "RELEASE_E2E_INTEGRATION_API_KEY",
    description:
      "The real api_key credential for RELEASE_E2E_INTEGRATION_NAMESPACE, stored as the integration's " +
      "api_key secret field and used to make a real tool call through the integration gateway (the " +
      "gateway itself is what T3-INT-1 tests). Authenticated for real — no placeholder.",
    whereItLives:
      "Minted in the chosen provider's dashboard (default: an Exa API key from https://exa.ai). " +
      "Local: ~/.proliferate-local/dev/release-e2e.env. CI: GitHub Actions secret.",
    secret: true,
  },
  {
    name: "RELEASE_E2E_GITHUB_TEST_REPO",
    description:
      "`owner/repo` of a disposable GitHub repository used for worktree, repo-settings, and " +
      "checkout scenarios (T3-WT-1, T3-REPO-1).",
    whereItLives:
      "Confirmed live 2026-07-08: proliferate-e2e/e2e-fixture — a real repo under the " +
      "proliferate-e2e GitHub org (the same org the GitHub App fixture in T3-PROV-1 uses), " +
      "with `main` and `develop` branches already present. Default when unset.",
    secret: false,
  },
  {
    name: "RELEASE_E2E_GITHUB_TEST_TOKEN",
    description: "Token with read/write access to RELEASE_E2E_GITHUB_TEST_REPO for checkout and push steps.",
    whereItLives:
      "A fine-scoped PAT or GitHub App installation token for the test repo only. Local dev: " +
      "the runner falls back to the operator's own `gh` CLI auth (`gh auth token`) for cloning " +
      "the public fixture repo when this is unset, since read access to a public repo needs no " +
      "dedicated credential — set this explicitly once a write-scoped fixture token is provisioned.",
    secret: true,
  },
  {
    name: "RELEASE_E2E_GITHUB_APP_SEED_REFRESH_TOKEN",
    description:
      "Bootstrap GitHub App user-to-server REFRESH token for the account that authorized the target " +
      "profile's configured GitHub App. The seed seam (tests/release/scripts/github_app_seed.py) refreshes " +
      "it into a live access token and plants the real user-to-server authorization + installation cache the " +
      "OAuth callback would have written — no browser. Refresh tokens rotate on every use, so after the first " +
      "run the single live token lives in the state file below; this env var is only the initial bootstrap.",
    whereItLives:
      "Captured once from a real (browser-completed) authorization of the configured App. Local dev: " +
      "~/.proliferate-local/dev/release-e2e.env (or seed the state file directly). Never committed.",
    secret: true,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_GITHUB_APP_SEED_STATE",
    description:
      "Path to the JSON state file holding the current (rotating) GitHub App seed refresh token. Optional " +
      "override; defaults to ~/.proliferate-local/dev/release-e2e-github-seed.json. The seed seam rewrites it " +
      "atomically after each refresh, so seeding is re-runnable without re-supplying the bootstrap token.",
    whereItLives: "Written and maintained by tests/release/scripts/github_app_seed.py. Operator override only.",
    secret: false,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_LOCAL_RUNTIME_URL",
    description:
      "Base URL of the LOCAL lane's AnyHarness runtime HTTP API (workspaces/worktrees/sessions/agents) " +
      "— distinct from RELEASE_E2E_SERVER_URL (the Python server). Local-lane scenarios talk to this " +
      "directly, matching how desktop's web-port mode creates local workspaces/worktrees/sessions " +
      "(no Python-server mediation, no auth — the local-dev trust boundary is the OS user).",
    whereItLives:
      "Printed in the profile's `~/.proliferate-local/dev/profiles/<profile>/profile.env` as " +
      "ANYHARNESS_PORT (`http://127.0.0.1:<ANYHARNESS_PORT>`). Defaults to " +
      "http://127.0.0.1:8542 (this repo's ANYHARNESS_PORT default) when unset — never required, " +
      "so a fresh clone's first --dry-run run never blocks on it.",
    secret: false,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_LOCAL_DATABASE_URL",
    description:
      "Postgres URL for the LOCAL lane's profile DB. Only needed by T3-PROV-1's fallback seam " +
      "(tests/release/scripts/prov1_fallback.py), which calls the real GitHub-App-callback service " +
      "functions in-process against this DB, bypassing the real GitHub OAuth redirect (infeasible " +
      "on a dedicated feature profile — its callback URL is pinned to the main profile's port, per " +
      "specs/developing/local/feature-worktree-auth.md Layer C) and the (separately tracked) " +
      "current_product_user gate. Staging has no equivalent — that fallback is local-lane-only.",
    whereItLives:
      "postgresql+asyncpg://proliferate:localdev@127.0.0.1:5432/proliferate_dev_<profile>, per " +
      "specs/developing/local/feature-worktree-auth.md. Never required outside T3-PROV-1.",
    secret: false,
    lanes: ["local"],
  },
] as const;

export const DEFAULT_LOCAL_RUNTIME_URL = "http://127.0.0.1:8542";
export const DEFAULT_GITHUB_TEST_REPO = "proliferate-e2e/e2e-fixture";

export function envVarNames(): string[] {
  return ENV_MANIFEST.map((spec) => spec.name);
}

export function findEnvVarSpec(name: string): EnvVarSpec | undefined {
  return ENV_MANIFEST.find((spec) => spec.name === name);
}
