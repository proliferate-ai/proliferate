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

export const PROFILE = "t2intent";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..", "..");

export interface BootedStack {
  profile: string;
  apiBaseUrl: string;
  webBaseUrl: string;
  databaseUrl: string;
  setupTokenFile: string;
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

function pathHasDist(relative: string): boolean {
  return existsSync(path.join(REPO_ROOT, relative, "dist"));
}

/** Shared frontend packages are consumed as built dist by apps/desktop; build
 * them once (skips packages that already have a dist dir) instead of relying
 * on HMR, matching apps/desktop's own `dev:built` script. */
function ensureFrontendBuilt(): void {
  const packages: Array<{ filter: string; path: string }> = [
    { filter: "@anyharness/sdk", path: "anyharness/sdk" },
    { filter: "@anyharness/sdk-react", path: "anyharness/sdk-react" },
    { filter: "@proliferate/cloud-sdk", path: "cloud/sdk" },
    { filter: "@proliferate/cloud-sdk-react", path: "cloud/sdk-react" },
    { filter: "@proliferate/design", path: "apps/packages/design" },
    { filter: "@proliferate/product-domain", path: "apps/packages/product-domain" },
    { filter: "@proliferate/ui", path: "apps/packages/ui" },
    { filter: "@proliferate/product-ui", path: "apps/packages/product-ui" },
    { filter: "@proliferate/product-surfaces", path: "apps/packages/product-surfaces" },
  ];
  for (const pkg of packages) {
    if (pathHasDist(pkg.path)) {
      continue;
    }
    log(`building ${pkg.filter} (no dist found)...`);
    run("pnpm", ["--filter", pkg.filter, "build"]);
  }
}

function resolveAnyharnessRuntimeBin(): string {
  if (process.env.ANYHARNESS_DEV_RUNTIME_BIN) {
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

async function waitForHttpOk(url: string, { timeoutMs = 120_000, intervalMs = 500 } = {}): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok || response.status === 404) {
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

export async function bootStack(): Promise<BootedStack> {
  const profile = PROFILE;
  log(`preparing profile "${profile}"...`);
  const instance = ensureProfilePorts(profile);
  ensureDatabase(instance.databaseName);
  ensureRedisReachable();

  const databaseUrl = databaseUrlFor(instance.databaseName);
  const apiBaseUrl = `http://127.0.0.1:${instance.ports.api}`;
  const webBaseUrl = `http://127.0.0.1:${instance.ports.desktopWeb}`;
  const setupTokenFile = `/tmp/proliferate-${profile}-setup-token`;
  // Fresh setup token file per boot: a stale token from a prior claimed run
  // would otherwise sit there confusing the next claim attempt.
  rmSync(setupTokenFile, { force: true });

  log(`running alembic migrations against ${instance.databaseName}...`);
  run(path.join(REPO_ROOT, "server", ".venv", "bin", "alembic"), ["upgrade", "head"], {
    cwd: path.join(REPO_ROOT, "server"),
    env: { DATABASE_URL: databaseUrl, DEBUG: "true" },
  });

  mkdirSync(instance.anyharnessRuntimeHome, { recursive: true });

  const children: ChildProcess[] = [];

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
  };
  spawnTracked(
    children,
    path.join(REPO_ROOT, "server", ".venv", "bin", "uvicorn"),
    ["proliferate.main:app", "--host", "127.0.0.1", "--port", String(instance.ports.api)],
    { cwd: path.join(REPO_ROOT, "server"), env: serverEnv, name: "server" },
  );

  // ── AnyHarness runtime ──
  // Settings/auth/org/invitation surfaces (this suite's scope) don't read
  // through the runtime, but booting it keeps the app shell from showing a
  // persistent "runtime unavailable" state that could shadow assertions.
  // TIER2_INTENT_SKIP_RUNTIME=1 (CI) skips it entirely: building the Rust
  // binary from scratch is far too slow for a per-PR job, and no current
  // scenario needs it.
  if (process.env.TIER2_INTENT_SKIP_RUNTIME === "1") {
    log("skipping AnyHarness runtime (TIER2_INTENT_SKIP_RUNTIME=1)");
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
    log(`warning: could not start AnyHarness runtime (${String(error)}); continuing without it`);
  }

  // ── Desktop web (Vite dev server, web-port mode) ──
  ensureFrontendBuilt();
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

  log("waiting for server + desktop web to become ready...");
  await waitForHttpOk(`${apiBaseUrl}/health`);
  await waitForHttpOk(webBaseUrl);
  log(`ready: api=${apiBaseUrl} web=${webBaseUrl}`);

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
    // Release the profile run lock the `ensure --lock` call above took, same
    // as `make run`'s exit trap — otherwise the next boot within the lock's
    // 2-minute staleness window refuses to start.
    rmSync(path.join(path.dirname(profileInstancePath(profile)), "run.lock"), { force: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
  };

  return { profile, apiBaseUrl, webBaseUrl, databaseUrl, setupTokenFile, teardown };
}
