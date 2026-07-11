// Tier-2 "mocked intent" stack-boot fixture.
//
// Boots a real server (FastAPI/uvicorn) + real desktop web frontend (Vite,
// `apps/desktop` in web-port mode) against a seeded Postgres, on a dedicated,
// profile-isolated port set. Nothing here fakes the sandbox provider or an
// LLM (that's the tier-2 rule, see specs/developing/testing/README.md) — the
// only things faked at this boundary are auth-adjacent externals (mock IdP,
// email capture, Stripe test mode), and this suite doesn't even need those.
//
// Profile name is fixed to `t2intent` per
// specs/developing/local/dev-profiles.md (one profile per worktree/purpose,
// never `main`, kept for this suite's lifetime since it owns its own
// Postgres DB).
//
// Reuses the same primitives `make run PROFILE=<name>` uses
// (scripts/dev.mjs for port/profile allocation, alembic for migrations)
// rather than shelling out to `make run` itself, because `make run` always
// launches the Tauri desktop shell — tier 2 needs the desktop **web** build
// (`pnpm dev` / vite) per specs/developing/testing/scenarios.md's stated
// convention ("desktop web build (`pnpm dev` on PROLIFERATE_WEB_PORT)").

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startInvocationStub, type InvocationStubServer } from "./invocation-stub.ts";

export const PROFILE = "t2intent";
export const BILLING_PROFILE = "t2billing";

export interface StripeBillingEnv {
  secretKey: string;
  webhookSecret: string;
  proMonthlyPriceId: string;
  overagePriceId: string;
  refillPriceId: string;
  meterId: string;
  billingMode: string;
}

export interface BootOptions {
  /** Profile name to boot under (default: the auth/org `t2intent` profile). */
  profile?: string;
  /** When set, the server boots with Stripe test-mode billing wired: pro
   * billing enabled, `CLOUD_BILLING_MODE` (default `enforce`), and the Stripe
   * test keys/prices. Used only by the billing suite. */
  stripe?: StripeBillingEnv;
  /** Skip the desktop web (Vite) build/serve and the AnyHarness runtime.
   * For specs that only need the real server process (e.g. hitting `/meta`
   * or a JSON API directly) — no browser, no runtime call, so there is
   * nothing for either to serve. Cuts boot time and lets a spec run a
   * second, differently-configured server cheaply on its own profile. */
  skipFrontend?: boolean;
  /** Keep the real desktop-web surface but omit AnyHarness for a connected
   * settings/API journey that cannot start a runtime turn. */
  skipRuntime?: boolean;
  /** Reuse frontend package artifacts built by the suite's global stack.
   * Nested browser fixtures may opt into this only when Playwright globalSetup
   * has already completed the canonical package build in the same worktree. */
  skipFrontendBuild?: boolean;
  /** Extra/overriding server env vars, applied last (after every other
   * default in this function, including the Stripe block) so a caller can
   * flip any posture — telemetry mode, billing mode, E2B config, debug —
   * for a dedicated ephemeral boot without duplicating this whole function. */
  extraServerEnv?: NodeJS.ProcessEnv;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..", "..");

export interface BootedStack {
  profile: string;
  apiBaseUrl: string;
  webBaseUrl: string;
  /** The local AnyHarness runtime's base URL for this profile. Required runs
   * do not return until `/v1/agents` is reachable; optional/skip runs expose
   * the allocated address without promising reachability. */
  anyharnessBaseUrl: string;
  databaseUrl: string;
  setupTokenFile: string;
  invocationStubBaseUrl: string;
  invocationStubApiKey: string;
  /** Kill every process this boot spawned. Safe to call more than once. */
  teardown: () => Promise<void>;
}

interface ProfileInstance {
  profile: string;
  anyharnessRuntimeHome: string;
  desktopHome: string;
  databaseName: string;
  ports: {
    api: number;
    desktopWeb: number;
    hostedWeb: number;
    mobileWeb: number;
    hmr: number;
    anyharness: number;
  };
}

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[tier2-intent/boot] ${message}`);
}

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${detail}`);
  }
  return result.stdout.trim();
}

function localPgHost(): string {
  if (process.env.LOCAL_PGHOST) {
    return process.env.LOCAL_PGHOST;
  }
  // Matches the Makefile's OS-conditional default: Docker Desktop's Postgres
  // listener on macOS is reached over ::1 so it isn't confused with a
  // Homebrew Postgres bound to 127.0.0.1.
  return process.platform === "darwin" ? "::1" : "127.0.0.1";
}

function profileInstancePath(profile: string): string {
  return path.join(
    process.env.HOME ?? "",
    ".proliferate-local",
    "dev",
    "profiles",
    profile,
    "instance.json",
  );
}

function ensureProfilePorts(profile: string): ProfileInstance {
  run("node", ["scripts/dev.mjs", "ensure", "--profile", profile, "--lock"]);
  const raw = readFileSync(profileInstancePath(profile), "utf8");
  return JSON.parse(raw) as ProfileInstance;
}

function ensureDatabase(dbName: string): void {
  run("node", ["scripts/dev.mjs", "ensure-db", "--db-name", dbName], {
    env: { USE_EXISTING_POSTGRES: "1" },
  });
}

function databaseUrlFor(dbName: string): string {
  return run("node", ["scripts/dev.mjs", "database-url", "--db-name", dbName], {
    env: { LOCAL_PGHOST: localPgHost() },
  });
}

function ensureRedisReachable(): void {
  const result = spawnSync("make", ["server-redis-ready"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    log(`warning: could not confirm local Redis is ready (${(result.stderr || "").trim()}); continuing anyway`);
  }
}

/** Shared frontend packages are consumed as built dist by apps/desktop; build
 * them before every boot. A directory-exists check can accept stale or
 * partially-written output and leave Vite serving an import-error overlay. */
function ensureFrontendBuilt(): void {
  const packages = [
    "@anyharness/sdk",
    "@anyharness/sdk-react",
    "@proliferate/cloud-sdk",
    "@proliferate/cloud-sdk-react",
    "@proliferate/design",
    "@proliferate/product-domain",
    "@proliferate/ui",
    "@proliferate/product-ui",
    "@proliferate/product-surfaces",
  ];
  for (const packageName of packages) {
    log(`building ${packageName}...`);
    run("pnpm", ["--filter", packageName, "build"]);
  }
}

function resolveAnyharnessRuntimeBin(): string {
  if (process.env.ANYHARNESS_DEV_RUNTIME_BIN) {
    if (!existsSync(process.env.ANYHARNESS_DEV_RUNTIME_BIN)) {
      throw new Error(
        `ANYHARNESS_DEV_RUNTIME_BIN does not exist: ${process.env.ANYHARNESS_DEV_RUNTIME_BIN}`,
      );
    }
    return process.env.ANYHARNESS_DEV_RUNTIME_BIN;
  }
  // The shared prebuilt binary local dev keeps at this fixed path (built from
  // main, refreshed by `pdevui`/`make build-rust`) — reusing it here mirrors
  // the `pdevui` shortcut documented in feature-worktree-auth.md, and this
  // suite makes no Rust changes so main's runtime is a correct stand-in.
  const shared = path.join(
    process.env.HOME ?? "",
    ".proliferate-local",
    "dev",
    "runtime-bin",
    "anyharness",
  );
  if (existsSync(shared)) {
    return shared;
  }
  const targetDir = path.join(REPO_ROOT, "target", "runtime-local");
  const built = path.join(targetDir, "debug", "anyharness");
  if (!existsSync(built)) {
    log("no prebuilt AnyHarness runtime binary found; building (this can take a while)...");
    run("cargo", ["build", "--bin", "anyharness"], {
      env: { CARGO_TARGET_DIR: targetDir },
    });
  }
  return built;
}

async function waitForHttpOk(
  url: string,
  { timeoutMs = 120_000, intervalMs = 500, allowNotFound = true }:
    { timeoutMs?: number; intervalMs?: number; allowNotFound?: boolean } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok || (allowNotFound && response.status === 404)) {
        // 404 still proves the server is up and routing (e.g. Vite root
        // during initial cold compile can 404 briefly before serving index).
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${url} to respond${lastError ? `: ${String(lastError)}` : ""}`);
}

function spawnTracked(
  children: ChildProcess[],
  command: string,
  args: string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv; name: string },
): ChildProcess {
  const child = spawn(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const prefix = `[${options.name}]`;
  child.stdout?.on("data", (chunk: Buffer) => {
    if (process.env.TIER2_INTENT_VERBOSE) {
      process.stdout.write(`${prefix} ${chunk}`);
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    if (process.env.TIER2_INTENT_VERBOSE) {
      process.stderr.write(`${prefix} ${chunk}`);
    }
  });
  children.push(child);
  return child;
}

function killTracked(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  try {
    if (process.platform !== "win32" && child.pid) {
      // Negative pid signals the whole detached process group (uvicorn/vite
      // spawn their own children; a plain SIGTERM to the parent alone can
      // leave orphans holding the port open across test runs).
      process.kill(-child.pid, "SIGTERM");
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    // Already gone.
  }
}

export async function bootStack(options: BootOptions = {}): Promise<BootedStack> {
  // Server-only nested fixtures deliberately have no runtime. The requirement
  // applies to the primary full-stack boot that owns the gateway-policy seam.
  const runtimeRequired =
    !options.skipFrontend && !options.skipRuntime && process.env.TIER2_INTENT_REQUIRE_RUNTIME === "1";
  if (runtimeRequired && process.env.TIER2_INTENT_SKIP_RUNTIME === "1") {
    throw new Error(
      "TIER2_INTENT_REQUIRE_RUNTIME=1 is incompatible with TIER2_INTENT_SKIP_RUNTIME=1",
    );
  }

  // TIER2_INTENT_PROFILE lets a local run boot the same harness on its own
  // profile so parallel worktrees don't collide on ports/DB/run-lock (this
  // branch was verified on `t2auth`). Callers that pass an explicit profile
  // (the billing suite) still win; CI keeps the default, one profile per
  // isolated container.
  const profile = options.profile ?? process.env.TIER2_INTENT_PROFILE ?? PROFILE;
  log(`preparing profile "${profile}"...`);
  const instance = ensureProfilePorts(profile);
  let databaseUrl: string;
  const apiBaseUrl = `http://127.0.0.1:${instance.ports.api}`;
  const webBaseUrl = `http://127.0.0.1:${instance.ports.desktopWeb}`;
  // The allocated address is published for optional and required runs. A
  // required run proves it reachable before returning from this function.
  const anyharnessBaseUrl = `http://127.0.0.1:${instance.ports.anyharness}`;
  const setupTokenFile = `/tmp/proliferate-${profile}-setup-token`;
  // Fresh setup token file per boot: a stale token from a prior claimed run
  // would otherwise sit there confusing the next claim attempt.
  rmSync(setupTokenFile, { force: true });
  const children: ChildProcess[] = [];
  let invocationStub: InvocationStubServer;
  try {
    ensureDatabase(instance.databaseName);
    databaseUrl = databaseUrlFor(instance.databaseName);
    ensureRedisReachable();
    log(`running alembic migrations against ${instance.databaseName}...`);
    run(path.join(REPO_ROOT, "server", ".venv", "bin", "alembic"), ["upgrade", "head"], {
      cwd: path.join(REPO_ROOT, "server"),
      env: { DATABASE_URL: databaseUrl, DEBUG: "true" },
    });
    mkdirSync(instance.anyharnessRuntimeHome, { recursive: true });
    invocationStub = await startInvocationStub();
  } catch (error) {
    // `ensure --lock` happens before any child exists. Release that lock when
    // database/migration/stub setup fails so Playwright retries can boot.
    rmSync(path.join(path.dirname(profileInstancePath(profile)), "run.lock"), { force: true });
    throw error;
  }
  log(`invocation stub ready: ${invocationStub.baseUrl}`);

  let torndown = false;
  const teardown = async () => {
    if (torndown) {
      return;
    }
    torndown = true;
    log("tearing down...");
    for (const child of children) {
      killTracked(child);
    }
    await closeInvocationStub(invocationStub);
    // Release the profile run lock the `ensure --lock` call above took, same
    // as `make run`'s exit trap — otherwise the next boot within the lock's
    // 2-minute staleness window refuses to start.
    rmSync(path.join(path.dirname(profileInstancePath(profile)), "run.lock"), { force: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
  };

  // ── Server (FastAPI/uvicorn) ──
  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DEBUG: "true",
    DATABASE_URL: databaseUrl,
    API_BASE_URL: apiBaseUrl,
    FRONTEND_BASE_URL: webBaseUrl,
    SINGLE_ORG_MODE: "true",
    SETUP_TOKEN_FILE: setupTokenFile,
    CORS_ALLOW_ORIGINS: [
      `http://localhost:${instance.ports.desktopWeb}`,
      `http://127.0.0.1:${instance.ports.desktopWeb}`,
    ].join(","),
    // Password + first-run claim only: never let a leaked shell env accidentally
    // point this profile at a real GitHub OAuth app (main's callback is
    // registered against a different port; see feature-worktree-auth.md).
    GITHUB_OAUTH_CLIENT_ID: "",
    GITHUB_OAUTH_CLIENT_SECRET: "",
    // Tier 2 captures the invitation token from the API and never sends mail.
    // Blank ambient/.env Resend credentials so a developer machine cannot
    // turn the deterministic fixture into a real provider call.
    RESEND_API_KEY: "",
    // T2-AUTH-3's mock IdP is a plain-HTTP loopback server (fakes/mock-idp) —
    // the server's OIDC client rejects private/HTTP provider URLs by default
    // (server/proliferate/integrations/sso/oidc.py's `_validate_oidc_url`);
    // this settings seam exists for exactly this local/test case (see
    // server/tests/unit/auth/test_sso.py's own http://127.0.0.1 coverage).
    PROLIFERATE_SSO_OIDC_ALLOW_PRIVATE_PROVIDER_URLS: "true",
    // Self-hosting posture, pinned explicitly so every self-hosting spec
    // asserting "add-ons off"/local-dev gets a deterministic answer
    // regardless of a developer's ambient .env/.env.local (pydantic-settings
    // reads those from `server/`'s cwd) — mirrors the GITHUB_OAUTH_* blanking
    // above. Deliberately does NOT touch E2B_API_KEY: the Stripe/billing
    // block below has a documented "ambient key wins" contract for it
    // (`if (!serverEnv.E2B_API_KEY) { ...placeholder... }`); specs that need
    // a deterministic E2B posture (on OR off) set it via `extraServerEnv` on
    // their own dedicated boot instead. A caller's `extraServerEnv` (applied
    // last, below) overrides any of these for a differently-configured
    // ephemeral boot.
    TELEMETRY_MODE: "local_dev",
    CLOUD_BILLING_MODE: "off",
    AGENT_GATEWAY_ENABLED: "false",
    INSTANCE_NAME: "",
    INSTANCE_LOGO_URL: "",
    INSTANCE_SUPPORT_EMAIL: "",
    INSTANCE_SUPPORT_URL: "",
  };
  if (options.stripe) {
    // Billing suite: wire real Stripe test-mode + turn enforcement on. The
    // webhook receiver verifies signatures against STRIPE_WEBHOOK_SECRET, so
    // the harness signs deliveries with the same value (see stack/billing.ts).
    const s = options.stripe;
    // CLOUD_BILLING_MODE=enforce refuses to boot without E2B_API_KEY
    // (main.py _validate_cloud_billing_configuration — a presence check so
    // metering/reconciliation could run). Tier-2 billing never provisions a
    // sandbox (compute usage is seeded usage_segment rows) and no spec calls
    // the reconciler's provider path, so a placeholder satisfies the boot
    // gate on CI runners that have no real key. A real key in the ambient
    // env (local dev) always wins.
    if (!serverEnv.E2B_API_KEY) {
      serverEnv.E2B_API_KEY = "e2b_tier2_billing_boot_placeholder";
    }
    serverEnv.PRO_BILLING_ENABLED = "true";
    serverEnv.CLOUD_BILLING_MODE = s.billingMode;
    serverEnv.STRIPE_SECRET_KEY = s.secretKey;
    serverEnv.STRIPE_WEBHOOK_SECRET = s.webhookSecret;
    serverEnv.STRIPE_PRO_MONTHLY_PRICE_ID = s.proMonthlyPriceId;
    serverEnv.STRIPE_CLOUD_MONTHLY_PRICE_ID = s.proMonthlyPriceId;
    serverEnv.STRIPE_MANAGED_CLOUD_OVERAGE_PRICE_ID = s.overagePriceId;
    serverEnv.STRIPE_SANDBOX_OVERAGE_PRICE_ID = s.overagePriceId;
    serverEnv.STRIPE_MANAGED_CLOUD_OVERAGE_METER_ID = s.meterId;
    serverEnv.STRIPE_SANDBOX_METER_ID = s.meterId;
    serverEnv.STRIPE_REFILL_10H_PRICE_ID = s.refillPriceId;
    serverEnv.STRIPE_CHECKOUT_SUCCESS_URL = `${webBaseUrl}/settings?section=billing&checkout=success`;
    serverEnv.STRIPE_CHECKOUT_CANCEL_URL = `${webBaseUrl}/settings?section=billing&checkout=cancel`;
    serverEnv.STRIPE_CUSTOMER_PORTAL_RETURN_URL = `${webBaseUrl}/settings?section=billing`;
  }
  if (options.extraServerEnv) {
    Object.assign(serverEnv, options.extraServerEnv);
  }
  spawnTracked(
    children,
    path.join(REPO_ROOT, "server", ".venv", "bin", "uvicorn"),
    ["proliferate.main:app", "--host", "127.0.0.1", "--port", String(instance.ports.api)],
    { cwd: path.join(REPO_ROOT, "server"), env: serverEnv, name: "server" },
  );

  if (options.skipFrontend) {
    log("skipFrontend: no AnyHarness runtime, no desktop web — server-only boot");
  } else {
    // ── AnyHarness runtime ──
    // Settings/auth/org/invitation surfaces (this suite's scope) don't read
    // through the runtime, but booting it keeps the app shell from showing a
    // persistent "runtime unavailable" state that could shadow assertions.
    // Optional targeted local runs may skip it. The required CI run provides
    // a prebuilt binary and sets TIER2_INTENT_REQUIRE_RUNTIME=1, so a missing
    // or unhealthy runtime fails stack boot.
    if (options.skipRuntime || process.env.TIER2_INTENT_SKIP_RUNTIME === "1") {
      log("skipping AnyHarness runtime for this profile");
    } else try {
      const runtimeBin = resolveAnyharnessRuntimeBin();
      spawnTracked(
        children,
        runtimeBin,
        ["serve", "--port", String(instance.ports.anyharness), "--runtime-home", instance.anyharnessRuntimeHome],
        {
          env: { ...process.env, RUST_LOG: "info", ANYHARNESS_DEV_CORS: "1" },
          name: "anyharness",
        },
      );
    } catch (error) {
      if (runtimeRequired) {
        await teardown();
        throw new Error(`required AnyHarness runtime failed to start: ${String(error)}`);
      }
      log(`warning: could not start AnyHarness runtime (${String(error)}); continuing without it`);
    }

    // ── Desktop web (Vite dev server, web-port mode) ──
    if (options.skipFrontendBuild) {
      log("reusing frontend packages built by Playwright globalSetup");
    } else {
      try {
        ensureFrontendBuilt();
      } catch (error) {
        await teardown();
        throw error;
      }
    }
    const desktopEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PROLIFERATE_WEB_PORT: String(instance.ports.desktopWeb),
      PROLIFERATE_WEB_HMR_PORT: String(instance.ports.hmr),
      VITE_PROLIFERATE_API_BASE_URL: apiBaseUrl,
      VITE_PROLIFERATE_ENVIRONMENT: "development",
      VITE_PROLIFERATE_TELEMETRY_DISABLED: "true",
      // Vite dev builds default to auth-not-required (anonymous app shell).
      // These scenarios assert the real login/logout lifecycle, so force the
      // auth gate on and make sure no leaked dev bypass sneaks in.
      VITE_REQUIRE_AUTH: "true",
    };
    delete desktopEnv.VITE_DEV_DISABLE_AUTH;
    spawnTracked(
      children,
      "pnpm",
      ["exec", "vite", "--host", "127.0.0.1", "--port", String(instance.ports.desktopWeb), "--strictPort"],
      { cwd: path.join(REPO_ROOT, "apps", "desktop"), env: desktopEnv, name: "desktop-web" },
    );
  }

  try {
    log("waiting for server to become ready...");
    await waitForHttpOk(`${apiBaseUrl}/health`);
    if (runtimeRequired) {
      log("waiting for required AnyHarness runtime to become ready...");
      await waitForHttpOk(`${anyharnessBaseUrl}/v1/agents`, { allowNotFound: false });
    }
    if (!options.skipFrontend) {
      await waitForHttpOk(webBaseUrl);
    }
  } catch (error) {
    await teardown();
    throw error;
  }
  log(`ready: api=${apiBaseUrl}${options.skipFrontend ? "" : ` web=${webBaseUrl}`}`);

  return {
    profile,
    apiBaseUrl,
    webBaseUrl,
    anyharnessBaseUrl,
    databaseUrl,
    setupTokenFile,
    invocationStubBaseUrl: invocationStub.baseUrl,
    invocationStubApiKey: invocationStub.apiKey,
    teardown,
  };
}

async function closeInvocationStub(invocationStub: InvocationStubServer): Promise<void> {
  try {
    await invocationStub.close();
  } catch (error) {
    log(`warning: could not close invocation stub (${String(error)})`);
  }
}
