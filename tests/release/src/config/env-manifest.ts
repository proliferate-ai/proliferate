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
    name: "AGENT_GATEWAY_LITELLM_BASE_URL",
    description:
      "Admin/control-plane base URL of the qualification LiteLLM gateway. LOCAL-WORLD-SMOKE-1's " +
      "private world controller uses it (with the master key) to preflight admin reachability, " +
      "resolve the actor's run-created virtual key, snapshot/correlate spend, and delete the " +
      "run-created key/user/team on cleanup. Never exposed to AnyHarness (only the public URL is) " +
      "and never serialized into evidence.",
    whereItLives:
      "Local: the ignored mode-0600 qualification profile " +
      "`~/.proliferate-local/dev/qualification-infra.env` — the Makefile wrapper maps " +
      "AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL to this when the separate control URL is absent. " +
      "CI: the GitHub `staging` environment's LiteLLM public-URL variable, mapped to this input.",
    secret: false,
    lanes: ["local"],
  },
  {
    name: "AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL",
    description:
      "Public inference base URL of the qualification LiteLLM gateway. This is the only gateway URL " +
      "handed to the candidate Server / AnyHarness (as the managed-gateway endpoint the actor's " +
      "enrollment key is used against); the admin URL and master key stay inside the world " +
      "controller.",
    whereItLives:
      "Local: `~/.proliferate-local/dev/qualification-infra.env` (mode 0600). " +
      "CI: `vars.AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL` in the GitHub `staging` environment.",
    secret: false,
    lanes: ["local"],
  },
  {
    name: "AGENT_GATEWAY_LITELLM_MASTER_KEY",
    description:
      "Master key for the qualification LiteLLM gateway's admin API, used only inside the private " +
      "world controller and passed only into the candidate Server container env. Never reaches the " +
      "runner report, the renderer, AnyHarness, or any evidence field (stripped by the candidate " +
      "child env denylist and redacted from the report).",
    whereItLives:
      "Local: `~/.proliferate-local/dev/qualification-infra.env` (mode 0600). " +
      "CI: `secrets.LITELLM_MASTER_KEY` in the GitHub `staging` environment, mapped to this input.",
    secret: true,
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
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_RETAINED_TEMPLATE_ID",
    description:
      "Immutable provider (E2B) template id of the retained-production N-1 sandbox image that " +
      "T4-RUNTIME-1 provisions its baseline from before updating to candidate N. 'Retained' means the " +
      "exact template of the last release ACTUALLY qualified through this platform — never a decremented " +
      "version or a rebuilt-from-source approximation. Absent (with RELEASE_E2E_RETAINED_MANIFEST) -> " +
      "T4-RUNTIME-1 reports blocked rather than fabricating an N-1 (founder ruling 2026-07-16). No " +
      "release has been qualified through the platform yet, so this is expected to be unset until one is.",
    whereItLives:
      "Produced by the release-qualification pipeline when it retains the last green release's E2B " +
      "template; supplied to an on-demand/nightly T4-RUNTIME-1 dispatch once such a template exists.",
    secret: false,
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_RETAINED_MANIFEST",
    description:
      "The retained-production N-1 release component manifest (JSON) describing the versions and digests " +
      "of the AnyHarness/Worker/Supervisor binaries and bundled catalog/registry baked into " +
      "RELEASE_E2E_RETAINED_TEMPLATE_ID. T4-RUNTIME-1 parses it to assert baseline N-1 identities and to " +
      "compute what a real N-1 -> N update must change. Absent (with RELEASE_E2E_RETAINED_TEMPLATE_ID) -> " +
      "T4-RUNTIME-1 reports blocked. Not a credential (public release metadata).",
    whereItLives:
      "The retained release's published manifest, captured by the qualification pipeline alongside the " +
      "retained template id; supplied verbatim to the T4-RUNTIME-1 dispatch.",
    secret: false,
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_RETAINED_ANYHARNESS_REPORTED_VERSION",
    description:
      "Optional override for the version the retained N-1 AnyHarness binary ACTUALLY reports from " +
      "`--version` / `/health` (not merely its release tag). The supervisor health-gate and worker " +
      "`--version` probe assert an exact match to the requested version (R9R-001 / R9-008), so a binary " +
      "that is not version-stamped (issue #1089) can never converge; the proof must compare against " +
      "observable truth. When unset, T4-RUNTIME-1 derives the reported version from the retained " +
      "manifest.",
    whereItLives:
      "Set by the operator only when the retained binary's reported version diverges from its manifest " +
      "version (e.g. an unstamped release); otherwise leave unset.",
    secret: false,
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_SUPERVISOR_OWNED_RUNTIME",
    description:
      "Confirmation switch (set to `1`) asserting that the candidate API under test runs with " +
      "PROLIFERATE_SUPERVISOR_OWNED_RUNTIME=1, so a Worker heartbeat returns desiredTopology=" +
      "supervisor_owned and the Worker writes the durable mailbox update request rather than swapping " +
      "the binary itself (server default is OFF). T4-RUNTIME-1 requires the supervisor-owned topology to " +
      "observe the contract's Worker-mailbox -> Supervisor-activation flow; absent -> blocked (the " +
      "legacy direct-Worker path would contradict the contract).",
    whereItLives:
      "Set by the dispatch that deploys the candidate API with the supervisor-owned runtime flag enabled.",
    secret: false,
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_PROVISION",
    description:
      "Opt-in switch (set to `1`) authorizing the self-hosting scenarios (SELFHOST-INSTALL-1 cold boot, " +
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
    secret: false,
    lanes: ["local"],
  },
  {
    name: "TIER2_BILLING_STRIPE_SECRET_KEY",
    description:
      "Stripe TEST secret key (sk_test_…) the Tier-2 billing scenarios' financial cells use via the real " +
      "Stripe test-mode API (customers, subscriptions, invoices, test clocks). Resolved at boot by " +
      "bootBillingStack (this env, then STRIPE_SECRET_KEY/STRIPE_TEST_SECRET_KEY, then `stripe config " +
      "--list`); an unresolved key returns every financial cell BLOCKED (never green). Declared here so " +
      "its value is redacted from the persisted report; NOT a scenario requiredEnv (the local `stripe " +
      "config` fallback must keep working). Never live mode.",
    whereItLives:
      "Local: the developer's Stripe CLI test-mode config, or ~/.proliferate-local/dev/*.env. " +
      "CI: the GitHub `Qualification` environment's Stripe test secret.",
    secret: true,
  },
  {
    name: "TIER2_BILLING_STRIPE_WEBHOOK_SECRET",
    description:
      "The webhook signing secret (whsec_…) the Tier-2 billing harness self-signs deliveries with and the " +
      "booted server verifies against. Generated per boot by bootBillingStack and exported to process.env; " +
      "declared here so it is redacted from the persisted report. Not a scenario requiredEnv.",
    whereItLives: "Generated per run by tests/intent/stack/billing-boot.ts; never committed.",
    secret: true,
  },
  {
    name: "RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY",
    description:
      "Dedicated bounded BYOK (bring-your-own-key) Anthropic provider key. Local lane: the LOCAL-3 user-API-key " +
      "route of the CLAUDE harness (and the LOCAL-6 route-change actor); stored + selected through the product " +
      "Settings UI as a user-owned credential, the user-key route must consume ZERO managed LLM credit and leave " +
      "the managed balance unchanged. Self-host lane: SELFHOST-INSTALL-1's SH-BASE-TURN cell stores it through the " +
      "product (POST /v1/cloud/agent-gateway/keys) and the controller-local candidate AnyHarness spawns the harness " +
      "with the raw key (no LiteLLM/E2B). Distinct from RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY so the two " +
      "Anthropic-consuming harnesses (claude, opencode) stay isolated. Never enters logs or evidence.",
    whereItLives:
      "A rate/spend-bounded Anthropic API key reserved for qualification BYOK. Local: " +
      "~/.proliferate-local/dev/qualification-infra.env (mode 0600). CI: the `Qualification` environment secret.",
    secret: true,
    lanes: ["local", "selfhost"],
  },
  {
    name: "RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY",
    description:
      "Second bounded BYOK Anthropic provider key. Local lane: the LOCAL-3 user-API-key route of the OPENCODE " +
      "harness (its matching DIRECT provider, distinct from the injected `proliferate` gateway provider). Self-host " +
      "lane: reserved for a future two-key scenario (e.g. key rotation/replacement); not consumed by the current " +
      "single-key SH-BASE-TURN cell. Kept separate from RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY so concurrent " +
      "claude/opencode user-key cells do not share a key. Zero managed spend / zero balance change asserted. " +
      "Never enters logs or evidence.",
    whereItLives:
      "A second rate/spend-bounded Anthropic API key. Local: ~/.proliferate-local/dev/qualification-infra.env " +
      "(mode 0600). CI: the `Qualification` environment secret.",
    secret: true,
    lanes: ["local", "selfhost"],
  },
  {
    name: "RELEASE_E2E_BYOK_OPENAI_API_KEY",
    description:
      "Bounded BYOK OpenAI provider key for the LOCAL-3 user-API-key route of the CODEX harness (codex's own " +
      "provider family). Stored + selected through the product Settings UI; the user-key route must consume " +
      "zero managed LLM credit. Never enters logs or evidence.",
    whereItLives:
      "A rate/spend-bounded OpenAI API key reserved for qualification BYOK. Local: " +
      "~/.proliferate-local/dev/qualification-infra.env (mode 0600). CI: the `Qualification` environment secret.",
    secret: true,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_BYOK_XAI_API_KEY",
    description:
      "Bounded BYOK xAI provider key for the LOCAL-3 user-API-key route of the GROK harness. Stored + selected " +
      "through the product Settings UI; the user-key route must consume zero managed LLM credit. Never enters " +
      "logs or evidence. (Cursor is EXCLUDED from the user-key matrix: its CURSOR_API_KEY is an account key, " +
      "not a provider key — no BYOK var is declared for it.)",
    whereItLives:
      "A rate/spend-bounded xAI API key reserved for qualification BYOK. Local: " +
      "~/.proliferate-local/dev/qualification-infra.env (mode 0600). CI: the `Qualification` environment secret.",
    secret: true,
    lanes: ["local"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_REGION",
    description:
      "AWS region SELFHOST-INSTALL-1 provisions its run-scoped EC2 box, security group, key pair, and Route53 " +
      "A record in (qualification.proliferate.com zone).",
    whereItLives:
      "Local: `~/.proliferate-local/dev/qualification-infra.env` (mode 0600). CI: the `Qualification` " +
      "environment's `RELEASE_E2E_SELFHOST_REGION` variable.",
    secret: false,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_HOSTED_ZONE_ID",
    description:
      "Route53 hosted-zone id for `qualification.proliferate.com`, the owned zone SELFHOST-INSTALL-1 upserts a " +
      "collision-free run-subdomain A record into (Caddy then issues real Let's Encrypt TLS for that FQDN).",
    whereItLives:
      "Local: `~/.proliferate-local/dev/qualification-infra.env` (mode 0600). CI: the `Qualification` " +
      "environment's `RELEASE_E2E_SELFHOST_HOSTED_ZONE_ID` variable.",
    secret: false,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_INSTANCE_TYPE",
    description:
      "EC2 instance type SELFHOST-INSTALL-1 provisions for the run-scoped self-host box (a cheap, throwaway " +
      "size; the shipped installer runs the full compose bundle on it).",
    whereItLives:
      "Local: `~/.proliferate-local/dev/qualification-infra.env` (mode 0600). CI: the `Qualification` " +
      "environment's `RELEASE_E2E_SELFHOST_INSTANCE_TYPE` variable.",
    secret: false,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_GITHUB_OAUTH_CLIENT_ID",
    description:
      "GitHub OAuth application client id SELFHOST-QUAL-1's SH-GITHUB-AUTH cell configures on the instance " +
      "(written to .env.static as GITHUB_OAUTH_CLIENT_ID, then bootstrap.sh re-resolves + restarts the api). " +
      "The OAuth app has a single fixed registered callback " +
      "(https://selfhost-fixed.qualification.proliferate.com/auth/github/callback), which is why the cell " +
      "provisions the box on the FIXED serial-lane origin. Absent -> the cell fails closed (never skipped).",
    whereItLives:
      "The qualification GitHub OAuth app (registered once against the fixed serial origin). Local: " +
      "`~/.proliferate-local/dev/qualification-infra.env` (mode 0600). CI: the `Qualification` environment's " +
      "`RELEASE_E2E_SELFHOST_GITHUB_OAUTH_CLIENT_ID` variable.",
    secret: false,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_GITHUB_OAUTH_SECRET",
    description:
      "GitHub OAuth application client SECRET paired with RELEASE_E2E_SELFHOST_GITHUB_OAUTH_CLIENT_ID " +
      "(written to .env.static as GITHUB_OAUTH_CLIENT_SECRET over the SSH control handle, never on argv). " +
      "SH-GITHUB-AUTH fails closed when it is absent. Never stored in evidence.",
    whereItLives:
      "The qualification GitHub OAuth app. Local: `~/.proliferate-local/dev/qualification-infra.env` (mode " +
      "0600). CI: the `Qualification` environment's `RELEASE_E2E_SELFHOST_GITHUB_OAUTH_SECRET` secret.",
    secret: true,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_A_STATE",
    description:
      "Filesystem path to a Playwright storage-state JSON seeding a logged-in github.com session for identity " +
      "A (the verified GitHub identity whose email matches the password-claimed owner). SH-GITHUB-AUTH drives " +
      "the product's real Authorize-GitHub flow from a browser context loaded with this state so no interactive " +
      "github.com login is needed. The path (not the cookies) is the env value; the file itself is the secret " +
      "and is never printed. Absent -> the cell fails closed.",
    whereItLives:
      "Captured once from a real github.com sign-in of identity A. Local: out-of-band 0600 JSON; path passed " +
      "to the runner. CI: written from the `Qualification` environment's storage-state secret before the run.",
    secret: false,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_B_STATE",
    description:
      "Playwright storage-state JSON path for a logged-in github.com session for identity B (a SECOND, distinct " +
      "GitHub identity). SH-GITHUB-AUTH signs B in UNINVITED first (must be denied), then admits B through a " +
      "product-UI invitation. See RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_A_STATE for the path/secret convention. " +
      "Absent -> the cell fails closed.",
    whereItLives:
      "Captured once from a real github.com sign-in of identity B. Local: out-of-band 0600 JSON; path passed " +
      "to the runner. CI: written from the `Qualification` environment's storage-state secret before the run.",
    secret: false,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_A_EMAIL",
    description:
      "Identity A's verified GitHub email. SH-GITHUB-AUTH claims the owner via password with THIS email so " +
      "A's later GitHub sign-in links to the existing owner (no duplicate user). Absent -> the cell fails closed.",
    whereItLives:
      "The verified primary email on identity A's GitHub account. Local: " +
      "`~/.proliferate-local/dev/qualification-infra.env`. CI: the `Qualification` environment variable.",
    secret: false,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_B_EMAIL",
    description:
      "Identity B's verified GitHub email. SH-GITHUB-AUTH invites THIS email through the product UI so B's " +
      "GitHub sign-in consumes the pending invitation and receives its role. Absent -> the cell fails closed.",
    whereItLives:
      "The verified primary email on identity B's GitHub account. Local: " +
      "`~/.proliferate-local/dev/qualification-infra.env`. CI: the `Qualification` environment variable.",
    secret: false,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_LITELLM_IMAGE_TAG",
    description:
      "The exact LiteLLM image tag SELFHOST-QUAL-1's SH-GATEWAY cell pins the operator agent-gateway profile to " +
      "(written as PROLIFERATE_LITELLM_IMAGE_TAG into the instance env before bootstrap brings the profile up). " +
      "Defaults to \"stable\" when unset; CI SHOULD pin a specific immutable tag/digest here. The cell records " +
      "the OBSERVED image digest (docker inspect over SSH) into evidence regardless, so evidence stays honest " +
      "even under a rolling default.",
    whereItLives:
      "The published proliferate-litellm image tag under test. Local: " +
      "`~/.proliferate-local/dev/qualification-infra.env`. CI: the `Qualification` environment's " +
      "`RELEASE_E2E_SELFHOST_LITELLM_IMAGE_TAG` variable (pin to the release's LiteLLM tag).",
    secret: false,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_CFN_BUCKET",
    description:
      "S3 bucket SELFHOST-CFN-1's SH-CFN-WRAPPER cell uploads the candidate proliferate-deploy.tar.gz + its " +
      "self-hosted-assets.SHA256SUMS into (key prefix qualification/<run-id>/<shard-id>/), then presigns bounded " +
      "GET URLs it passes to the shipped CloudFormation template as DeployBundleUrl/DeployBundleChecksumUrl. The " +
      "scenario registers each s3_object cleanup intent BEFORE upload and deletes them on teardown. Absent -> the " +
      "cell fails CLOSED (a required case is green or red, never a silent skip). Pending founder provisioning.",
    whereItLives:
      "A dedicated qualification S3 bucket (private, lifecycle-expiring) in the RELEASE_E2E_SELFHOST_REGION account. " +
      "Local: `~/.proliferate-local/dev/qualification-infra.env` (mode 0600). CI: the `Qualification` environment's " +
      "`RELEASE_E2E_SELFHOST_CFN_BUCKET` variable.",
    secret: false,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_CFN_IMAGE_REPO",
    description:
      "GHCR container repo (ghcr.io/<org>/<name>, e.g. ghcr.io/proliferate-ai/proliferate-server-qualification) " +
      "SELFHOST-CFN-1 pushes the docker-loaded candidate server image to under a run-scoped immutable tag " +
      "(<run-id>-<shard-id>), then passes as the template's ServerImageRepository. The scenario registers the " +
      "ghcr_package_version cleanup intent BEFORE the push and deletes the version by tag on teardown (gh api DELETE " +
      "/orgs/{org}/packages/container/{name}/versions/{id}). docker login is assumed ambient (gh auth token); no " +
      "credential is ever printed. Absent -> the cell fails CLOSED. Pending founder provisioning. NOTE (live proof): " +
      "the template's default InstanceType is Graviton (arm64), so the candidate server image must be built for " +
      "linux/arm64 to boot on it.",
    whereItLives:
      "A dedicated qualification GHCR package under the proliferate-ai org (the ambient gh token must be able to push " +
      "and delete package versions). Local: `~/.proliferate-local/dev/qualification-infra.env` (mode 0600). CI: the " +
      "`Qualification` environment's `RELEASE_E2E_SELFHOST_CFN_IMAGE_REPO` variable.",
    secret: false,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_SSH_USER",
    description:
      "SSH login user on the box's Ubuntu AMI. Optional; defaults to \"ubuntu\" when unset (the standard " +
      "Ubuntu 24.04 cloud-image user, matching selfhost-box.sh's convention).",
    whereItLives:
      "Local: `~/.proliferate-local/dev/qualification-infra.env` (mode 0600), if overridden. CI: the " +
      "`Qualification` environment's `RELEASE_E2E_SELFHOST_SSH_USER` variable, if overridden.",
    secret: false,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_CLOUD_E2B_API_KEY",
    description:
      "E2B API key the SELFHOST-QUAL-1 SH-CLOUD-ADDON cell writes into the instance env (E2B_API_KEY) so the " +
      "self-host box's OWN server process provisions its personal cloud sandbox under this account. This is the " +
      "INSTANCE's provider key (distinct from the harness-side RELEASE_E2E_E2B_API_KEY ground-truth backdoor); the " +
      "cell also passes it to the E2B reap so the separate-account sandbox is torn down with the box's own key. " +
      "Absent -> the cell fails CLOSED (a required case is green or red, never a silent skip). Pending founder provisioning.",
    whereItLives:
      "A dedicated qualification E2B account/team key. Local: `~/.proliferate-local/dev/qualification-infra.env` " +
      "(mode 0600). CI: the `Qualification` environment's `RELEASE_E2E_SELFHOST_CLOUD_E2B_API_KEY` secret.",
    secret: true,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_CLOUD_E2B_TEMPLATE_NAME",
    description:
      "The immutable self-built E2B runtime template ref (candidate runtime bytes) the SH-CLOUD-ADDON cell writes " +
      "as E2B_TEMPLATE_NAME — the E2B_API_KEY + E2B_TEMPLATE_NAME complete pair is what common.sh gates the " +
      "cloud-workspaces compose profile on. Recorded as the evidence's e2b_template_id receipt. Absent -> the cell " +
      "fails CLOSED. Pending founder provisioning.",
    whereItLives:
      "The self-built qualification runtime template published to the RELEASE_E2E_SELFHOST_CLOUD_E2B_API_KEY account. " +
      "Local: `~/.proliferate-local/dev/qualification-infra.env` (mode 0600). CI: the `Qualification` environment's " +
      "`RELEASE_E2E_SELFHOST_CLOUD_E2B_TEMPLATE_NAME` variable.",
    secret: false,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_ID",
    description:
      "GitHub App id of the INSTANCE's own cloud add-on GitHub App (written as GITHUB_APP_ID), used by the " +
      "SH-CLOUD-ADDON cell's real product GitHub-authorization path that binds a covered repo to the personal " +
      "sandbox. This is a self-host-box App on the fixed origin, DISTINCT from the managed-cloud " +
      "RELEASE_E2E_CLOUD_GITHUB_APP_* set (which targets the harness's managed-cloud staging installation). " +
      "Recorded (hashed) as the evidence's github_app_installation_id_hash. Absent -> the cell fails CLOSED. Pending " +
      "founder provisioning.",
    whereItLives:
      "A standing `Proliferate Self-Host Qualification Cloud` GitHub App (proliferate-e2e org) installed on the e2e " +
      "fixture repo, callback on the fixed origin. Local: `~/.proliferate-local/dev/qualification-infra.env` (0600). " +
      "CI: the `Qualification` environment's `RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_ID` variable.",
    secret: false,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_CLIENT_ID",
    description:
      "OAuth client id of the instance cloud add-on GitHub App (written as GITHUB_APP_CLIENT_ID). Pairs with " +
      "RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_ID. Absent -> the SH-CLOUD-ADDON cell fails CLOSED. Pending founder provisioning.",
    whereItLives:
      "Same `Proliferate Self-Host Qualification Cloud` GitHub App. Local: " +
      "`~/.proliferate-local/dev/qualification-infra.env` (0600). CI: the `Qualification` environment's " +
      "`RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_CLIENT_ID` variable.",
    secret: false,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_CLIENT_SECRET",
    description:
      "OAuth client SECRET of the instance cloud add-on GitHub App (written as GITHUB_APP_CLIENT_SECRET into a 0600 " +
      "file scp'd to the box, never argv). Pairs with RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_CLIENT_ID. Never stored " +
      "in evidence. Absent -> the SH-CLOUD-ADDON cell fails CLOSED. Pending founder provisioning.",
    whereItLives:
      "Same GitHub App. Local: `~/.proliferate-local/dev/qualification-infra.env` (mode 0600). CI: the " +
      "`Qualification` environment's `RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_CLIENT_SECRET` secret.",
    secret: true,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_PRIVATE_KEY",
    description:
      "The PEM private key of the instance cloud add-on GitHub App (written inline as GITHUB_APP_PRIVATE_KEY into a " +
      "0600 file scp'd to the box, never argv). Signs the App JWT the server exchanges for installation tokens. Never " +
      "stored in evidence. Absent -> the SH-CLOUD-ADDON cell fails CLOSED. Pending founder provisioning.",
    whereItLives:
      "Same GitHub App's generated private key (multi-line PEM). Local: `~/.proliferate-local/dev/qualification-infra.env` " +
      "(mode 0600, newlines preserved). CI: the `Qualification` environment's " +
      "`RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_PRIVATE_KEY` secret.",
    secret: true,
    lanes: ["selfhost"],
  },
  {
    name: "RELEASE_E2E_CLOUD_AWS_REGION",
    description:
      "AWS region hosting CLOUD-PROVISION-1's run-scoped EC2 ingress box (Ec2ProvisionConfig.region). " +
      "AWS credentials themselves stay ambient (the `aws` CLI), matching the self-host box precedent " +
      "(RELEASE_E2E_SELFHOST_PROVISION) — never a manifest var.",
    whereItLives:
      "The qualification AWS account's chosen region for `qualification.proliferate.com` ingress boxes. " +
      "Local: `~/.proliferate-local/dev/qualification-infra.env` (0600). CI: the `Qualification` environment.",
    secret: false,
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_CLOUD_ROUTE53_ZONE_ID",
    description:
      "Route53 hosted-zone id for `qualification.proliferate.com` (Ec2ProvisionConfig.hostedZoneId), the " +
      "zone the run-scoped `<run>.qualification.proliferate.com` A record is created under.",
    whereItLives:
      "The qualification AWS account's Route53 console for the `qualification.proliferate.com` zone. " +
      "Local: `~/.proliferate-local/dev/qualification-infra.env` (0600). CI: the `Qualification` environment.",
    secret: false,
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_CLOUD_GITHUB_APP_ID",
    description:
      "App id of the staging qualification GitHub App (`proliferate-cloud-staging`, installed on " +
      "`proliferate-e2e/e2e-fixture`) the candidate Server runs with (CandidateGithubAppConfig.appId).",
    whereItLives:
      "The `proliferate-cloud-staging` GitHub App's settings page. Local: " +
      "`~/.proliferate-local/dev/qualification-infra.env` (0600). CI: the `Qualification` environment.",
    secret: false,
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_ID",
    description: "OAuth client id of the staging qualification GitHub App (CandidateGithubAppConfig.clientId).",
    whereItLives: "Same App settings page as RELEASE_E2E_CLOUD_GITHUB_APP_ID.",
    secret: false,
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_CLOUD_GITHUB_APP_INSTALLATION_ID",
    description:
      "Installation id of the staging qualification GitHub App on `proliferate-e2e/e2e-fixture` " +
      "(CandidateGithubAppConfig.installationId) — the covered-repository scenario materializes.",
    whereItLives: "The App's installation settings for the `proliferate-e2e` org.",
    secret: false,
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_CLOUD_GITHUB_APP_PRIVATE_KEY",
    description:
      "PEM private key of the staging qualification GitHub App. Written to a mode-0600 env file uploaded " +
      "to the candidate Server box (CandidateGithubAppConfig.secretsEnvFilePath) — never argv, never a " +
      "field value, never evidence.",
    whereItLives:
      "Downloaded once from the `proliferate-cloud-staging` App settings page. Local: " +
      "`~/.proliferate-local/dev/qualification-infra.env` (0600). CI: the `Qualification` environment secret.",
    secret: true,
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_SECRET",
    description: "OAuth client secret of the staging qualification GitHub App, same 0600-file discipline as above.",
    whereItLives: "Same App settings page, alongside the private key.",
    secret: true,
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_CLOUD_GITHUB_BOT_SEED_SSM_PARAMETER",
    description:
      "Optional override for the AWS SSM Parameter Store NAME (not the token) holding the durable D2 " +
      "GitHub bot refresh-token seed (SecureString). Defaults to " +
      "/proliferate/qualification/github-bot-refresh-token when unset (box-seeds.ts's " +
      "DEFAULT_BOT_SEED_SSM_PARAMETER). MCW-004: SSM is the resolution-order fallback (env token → local " +
      "seed file → SSM) resolveBotSeedForAutomation uses when neither the env token nor a local seed file " +
      "is available, and the durable rotation-write target in Actions (an ephemeral runner cannot durably " +
      "hold the token GitHub rotates on every use). AWS credentials themselves stay ambient (the `aws` " +
      "CLI), matching the RELEASE_E2E_CLOUD_AWS_REGION precedent — never a manifest var.",
    whereItLives:
      "AWS SSM Parameter Store, the qualification AWS account. This var only overrides the parameter " +
      "NAME; set it only if the default path is wrong for the target account, not to supply a value.",
    secret: false,
    lanes: ["sandbox"],
  },
  // ── Appended for PR 6 (shared fixture layer). Sandbox lane; all secret. Only
  // consumed when a PR-6 fixture / candidate Stripe deploy option is used —
  // absent, the candidate Server keeps today's no-Stripe 503 checkout posture
  // (the CLOUD-PROVISION-1 regression is untouched). Declared here so their
  // values are redacted from the persisted report. ──────────────────────────
  {
    name: "STRIPE_TEST_SECRET_KEY",
    description:
      "Stripe TEST secret key (sk_test_…) the managed-cloud billing journeys use for real Stripe test-mode " +
      "work: the candidate Server's own STRIPE_SECRET_KEY (so real Core-via-Stripe cloud checkout works — " +
      "closing the fundCore 503 debt), and the stripeTestClock fixture's test-clock/customer/subscription " +
      "setup for CLOUD-COMPUTE-RENEW-1. Resolved by the stripeTestClock fixture from this env, falling back " +
      "to TIER2_BILLING_STRIPE_SECRET_KEY; a LIVE-mode key throws (assertCheckoutUrlTestMode discipline) and " +
      "an unresolved key blocks the dependent cells rather than fabricating them. NOT a scenario requiredEnv " +
      "(the Tier-2 fallback must keep working). Never live mode.",
    whereItLives:
      "Local: `~/.proliferate-local/dev/qualification-infra.env` (mode 0600), or the shared Stripe test-mode " +
      "config. CI: the `Qualification` environment's Stripe test secret.",
    secret: true,
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_CLOUD_STRIPE_WEBHOOK_SECRET",
    description:
      "The Stripe webhook signing secret (whsec_…) the candidate Server verifies its /v1/billing/webhooks/stripe " +
      "deliveries against (its STRIPE_WEBHOOK_SECRET). The signed callback relay preserves the exact signed " +
      "bytes end-to-end and never re-signs, so this is the SERVER's verification secret, declared here only for " +
      "redaction — the relay itself never reads it. Absent → the candidate Server keeps today's no-Stripe posture.",
    whereItLives:
      "The Stripe test-mode webhook endpoint config for the qualification account. Local: " +
      "`~/.proliferate-local/dev/qualification-infra.env` (mode 0600). CI: the `Qualification` environment secret.",
    secret: true,
    lanes: ["sandbox"],
  },
  {
    name: "RELEASE_E2E_CLOUD_E2B_WEBHOOK_SECRET",
    description:
      "The E2B webhook signature secret the candidate Server verifies its /v1/cloud/webhooks/e2b deliveries " +
      "against (its E2B_WEBHOOK_SIGNATURE_SECRET). As with the Stripe webhook secret, the signed callback relay " +
      "forwards the exact signed bytes and never re-signs, so this is the SERVER's verification secret, declared " +
      "here only for redaction. Absent → the candidate Server keeps today's posture (no E2B webhook validation).",
    whereItLives:
      "The E2B team's webhook configuration for the qualification account. Local: " +
      "`~/.proliferate-local/dev/qualification-infra.env` (mode 0600). CI: the `Qualification` environment secret.",
    secret: true,
    lanes: ["sandbox"],
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
