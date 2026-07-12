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
  /** Exact value that activates/satisfies a required opt-in. */
  requiredValue?: string;
  /** False for per-run authorization switches that must never persist in dotenv. */
  persistentFileAllowed?: boolean;
}

export const ENV_MANIFEST: readonly EnvVarSpec[] = [
  {
    name: "RELEASE_E2E_ENV_FILE",
    description:
      "Optional path override for the local dotenv credential file. The runner parses it as data, " +
      "requires owner-only permissions, and never shells/sources it.",
    whereItLives:
      "Operator override only. Defaults locally to ~/.proliferate-local/dev/release-e2e.env; CI ignores " +
      "the default file and receives credentials from GitHub Actions.",
    secret: false,
  },
  {
    name: "RELEASE_E2E_PROFILE",
    description:
      "Optional local full-stack dev profile whose instance metadata supplies the API, AnyHarness, " +
      "Desktop web, and profile database endpoints.",
    whereItLives:
      "The profile name passed to `make setup PROFILE=<name>` / `make run PROFILE=<name>`. `make " +
      "release-e2e PROFILE=<name> ...` exports this automatically.",
    secret: false,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_ALLOW_PROFILE_WORKTREE_MISMATCH",
    description:
      "Conspicuous per-run authorization (`1`) to target a dev profile bound to a different git " +
      "worktree than the candidate checkout. Without it, candidate/profile mismatch fails preflight.",
    whereItLives: "Ambient environment for one intentional invocation only; never the persistent dotenv file.",
    secret: false,
    requiredValue: "1",
    persistentFileAllowed: false,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_SERVER_URL",
    description:
      "API base URL for the target lane, INCLUDING the deployment's api path prefix but not the " +
      "route's own /auth or /v1 segment — scenarios write prefix-relative paths (/auth/…, /v1/…). " +
      "Local has an empty api prefix, so this is the origin (http://127.0.0.1:8086). Staging's api " +
      "prefix is /api, so this is https://staging-app.proliferate.com/api (the identity router mounts " +
      "at {prefix}/auth and the v1 routers at {prefix}/v1, so /api is required for both to resolve). " +
      "A local --lane=local run additionally needs a tunnel fronting the API port so sandboxes can " +
      "call back into it.",
    whereItLives:
      "Staging: https://staging-app.proliferate.com/api (origin + /api prefix). " +
      "Local: the profile's API origin, printed by the tunnel tool when `make run PROFILE=<name>` is fronted by one.",
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
      "Organization id owning the durable user's account. Used (a) as the inviting org when the " +
      "fresh-user fixture mints a new account (invitation-gated registration), and (b) by T3-BILL-3 " +
      "as the org whose billing lifecycle is asserted (it also falls back to the durable user's single " +
      "owned org when unset). Local and staging have DIFFERENT durable orgs, so this is set per lane " +
      "(a `staging` GitHub Actions variable, not a repo-wide one).",
    whereItLives:
      "Read from the durable user's `GET /v1/organizations` response once, then pinned. Staging value " +
      "(the durable `proliferate-e2e-bot` user's owned org): recorded as the `RELEASE_E2E_DURABLE_ORG_ID` " +
      "variable in the GitHub `staging` environment. Local: seeded per run by the CLI (cli/run.ts).",
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
    name: "RELEASE_E2E_DESKTOP_WEB_URL",
    description:
      "Desktop renderer URL used by browser-driven desktop scenarios such as T3-WF-7. When a " +
      "RELEASE_E2E_PROFILE is selected this is derived from that profile's desktopWeb port.",
    whereItLives:
      "The selected profile's instance.json / PROLIFERATE_WEB_PORT. May be overridden explicitly for " +
      "a separately launched Desktop renderer.",
    secret: false,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_DESKTOP_T4",
    description:
      "Explicit opt-in (`1`) for T4-DESKTOP-1's two real signed macOS builds and updater install. " +
      "Absent means the expensive local scenario is blocked, never silently skipped.",
    whereItLives: "Set by the operator only for an intentional local macOS aarch64 update run.",
    secret: false,
    requiredValue: "1",
    persistentFileAllowed: false,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_DESKTOP_UPDATE_FROM",
    description: "Immutable published N-1 desktop version used as the starting app in T4-DESKTOP-1.",
    whereItLives: "The immediately previous published desktop-v<version> release chosen for qualification.",
    secret: false,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_DESKTOP_UPDATE_TO",
    description: "Immutable candidate N desktop version T4-DESKTOP-1 downloads, verifies, and installs.",
    whereItLives: "The release candidate's exact desktop version; must match the artifact under qualification.",
    secret: false,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_STAGING_ECS_PIN_BUMP",
    description:
      "Opt-in switch (set to `1`) authorizing T4-CLOUD-1 to bump the advertised AnyHarness runtime " +
      "pin on the STAGING server by overriding RUNTIME_VERSION in the proliferate-staging-server ECS " +
      "task definition and rolling the service — the only knob that moves desiredVersions.anyharness " +
      "without cutting a release (RUNTIME_VERSION is a baked-in image ENV; ECS task env overrides it). " +
      "The scenario restores the original task definition in a finally. Absent -> the scenario reports " +
      "blocked rather than mutating ECS. Staging-only and guarded (assertNotProduction); never touches " +
      "proliferate-prod*. AWS credentials come from the ambient environment (aws CLI), not a repo var.",
    whereItLives:
      "Operator sets it explicitly for a nightly/on-demand staging run once AWS creds able to " +
      "register-task-definition + update-service on proliferate-staging are present. Never set in CI " +
      "without a dedicated staging-scoped role.",
    secret: false,
    requiredValue: "1",
    persistentFileAllowed: false,
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_CLOUD_UPDATE_FROM",
    description: "Immutable published N-1 AnyHarness runtime version already running before T4-CLOUD-1.",
    whereItLives: "The prior runtime release selected for candidate qualification.",
    secret: false,
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_CLOUD_UPDATE_TO",
    description: "Immutable candidate N AnyHarness runtime version T4-CLOUD-1 must self-update to.",
    whereItLives: "The exact runtime CDN artifact version attached to the release candidate.",
    secret: false,
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_PROVISION",
    description:
      "Opt-in switch (set to `1`) authorizing the self-hosting scenarios (T3-SH-1 cold boot, " +
      "T4-SH-1 operator update) to provision a throwaway EC2 box via tests/release/scripts/" +
      "selfhost-box.sh — the production compose bundle on stock Ubuntu with a sslip.io hostname + " +
      "real Caddy TLS — and terminate it in a finally. Absent -> those scenarios report blocked " +
      "rather than spending money on infra. Needs ambient AWS credentials able to run-instances and " +
      "create a dedicated (clearly tagged, throwaway) security group + key pair in the default VPC; " +
      "never touches proliferate-prod*. Costs a few cents per run (a t3.small for ~5 min).",
    whereItLives:
      "Operator sets it explicitly for an on-demand/nightly self-hosting run with AWS creds present. " +
      "CI: a workflow input / repo variable gating the provisioning job.",
    secret: false,
    requiredValue: "1",
    persistentFileAllowed: false,
  },
  {
    name: "RELEASE_E2E_SELFHOST_UPDATE_FROM",
    description:
      "Explicit published N-1 self-hosted image version for T4-SH-1. This avoids deriving an image " +
      "tag that was never published.",
    whereItLives: "Chosen from published ghcr.io/proliferate-ai/proliferate-server version tags.",
    secret: false,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_UPDATE_TO",
    description: "Explicit published N self-hosted image version T4-SH-1 updates the throwaway box to.",
    whereItLives: "The release version under qualification; defaults to VERSION when intentionally omitted.",
    secret: false,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_REGION",
    description: "AWS region for throwaway self-hosted EC2 scenarios.",
    whereItLives: "Operator choice; tests/release/scripts/selfhost-box.sh defaults to us-east-1.",
    secret: false,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_INSTANCE_TYPE",
    description: "EC2 instance type for the throwaway self-hosted qualification box.",
    whereItLives: "Operator choice; tests/release/scripts/selfhost-box.sh has a low-cost default.",
    secret: false,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_IMAGE_TAG",
    description: "Initial server image tag installed by the self-hosted box provisioning script.",
    whereItLives: "Set by the owning self-hosted scenario to the release version it is validating.",
    secret: false,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_DESKTOP",
    description: "Optional Desktop renderer URL used for browser validation against a self-hosted server.",
    whereItLives: "A locally launched Desktop web renderer pointed at the throwaway or standing self-hosted box.",
    secret: false,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_URL",
    description:
      "Base URL of a STANDING, already-claimed self-hosted box (the alpha box) for scenarios that run " +
      "against a live instance without provisioning one: T3-SH-3 (gateway add-on) and the server-" +
      "redirect assertion of T4-SH-2 (artifact chain). e.g. https://<ip>.sslip.io. Read-only/additive " +
      "use — never re-claims or destroys it.",
    whereItLives: "The standing self-hosting test box's public URL (team infra notes).",
    secret: false,
  },
  {
    name: "RELEASE_E2E_SELFHOST_SSH",
    description:
      "SSH destination for the standing self-hosted box (RELEASE_E2E_SELFHOST_URL), e.g. " +
      "ubuntu@<ip>. Optional for T3-SH-3: when set, it adds read-only on-box assertions that the " +
      "`--profile agent-gateway` LiteLLM service is running + healthy, the api reports " +
      "AGENT_GATEWAY_ENABLED=true, and LiteLLM serves the target model (a compose profile's state " +
      "cannot be inspected over HTTP). Never mutates the box — the standing gateway add-on is " +
      "read-plus-additive. The box's security group must already allow SSH from the runner.",
    whereItLives: "Team infra notes, alongside RELEASE_E2E_SELFHOST_URL.",
    secret: false,
  },
  {
    name: "RELEASE_E2E_SELFHOST_SSH_KEY",
    description:
      "Filesystem path to the private key that authenticates RELEASE_E2E_SELFHOST_SSH. The path (not " +
      "the key material) is the env value; the key file itself is the secret and is never printed.",
    whereItLives: "The standing box's key pair .pem, stored out of band; path passed to the runner.",
    secret: false,
  },
  {
    name: "RELEASE_E2E_SELFHOST_GATEWAY_MODEL",
    description: "Cheap model alias T3-SH-3 calls through the self-hosted LiteLLM add-on.",
    whereItLives: "Operator override; the scenario has a documented cheap default.",
    secret: false,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_GATEWAY_PUBLIC_URL",
    description: "Public inference URL used to validate the self-hosted LiteLLM add-on.",
    whereItLives: "Defaults to <RELEASE_E2E_SELFHOST_URL>/llm; override only for split gateway topology.",
    secret: false,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_RELEASE_DESKTOP_VERSION",
    description:
      "The desktop version the release under test ships, used by T4-SH-2 (artifact chain) as the " +
      "ground-truth version the CDN manifest, versioned manifest, artifacts, and desktop-v<version> " +
      "tag must all agree on. Defaults to the repo VERSION file (the version of the checked-out ref, " +
      "which IS the release under test in the release gate). Override to check a specific release.",
    whereItLives: "The release pipeline sets it to the release being cut; otherwise the repo VERSION file.",
    secret: false,
  },
  {
    name: "RELEASE_E2E_RELEASE_DATE",
    description: "Expected UTC release day used to prove the updater manifest was freshly published.",
    whereItLives: "The release workflow's release metadata, formatted as YYYY-MM-DD.",
    secret: false,
  },
  {
    name: "RELEASE_E2E_RELEASE_SHA",
    description: "Release commit SHA whose lineage must match the published desktop-v<version> tag.",
    whereItLives: "The release workflow's immutable candidate SHA; defaults to the checked-out HEAD.",
    secret: false,
  },
  {
    name: "RELEASE_E2E_DESKTOP_CDN_BASE_URL",
    description:
      "Base URL of the desktop downloads CDN the Tauri updater feed lives on (the ground truth the " +
      "server redirect points at). Optional override; defaults to https://downloads.proliferate.com. " +
      "Used only by T4-SH-2.",
    whereItLives: "The desktop-downloads CloudFront distribution (scripts/ci-cd/publish-desktop-cdn).",
    secret: false,
  },
  {
    name: "RELEASE_E2E_LOCAL_DATABASE_URL",
    description:
      "Postgres URL for the LOCAL lane's profile DB. Read by the read-only DB seams that assert " +
      "against tables with no HTTP surface: T3-BILL-1/2's meter ledger (billing_probe.py), T3-INT-1's " +
      "gateway audit rows (integration_audit_probe.py, cloud_integration_tool_call_event), and " +
      "T3-PROV-1's fallback seam " +
      "(tests/release/scripts/prov1_fallback.py), which calls the real GitHub-App-callback service " +
      "functions in-process against this DB, bypassing the real GitHub OAuth redirect (infeasible " +
      "on a dedicated feature profile — its callback URL is pinned to the main profile's port, per " +
      "specs/developing/local/feature-worktree-auth.md Layer C) and the (separately tracked) " +
      "current_product_user gate. Staging has no equivalent — that fallback is local-lane-only.",
    whereItLives:
      "postgresql+asyncpg://proliferate:localdev@127.0.0.1:5432/proliferate_dev_<profile>, per " +
      "specs/developing/local/feature-worktree-auth.md. Required by the billing, integration-audit, " +
      "and provisioning DB seams (all local-lane only).",
    secret: true,
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
