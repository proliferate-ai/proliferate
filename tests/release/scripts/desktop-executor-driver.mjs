/**
 * T3-WF-7 desktop-executor driver (scenario-local; NOT a permanent suite couple).
 *
 * Stands up the REAL desktop workflow claim poller the way a signed-in desktop
 * WEB session would: launches a headless Chromium against the desktop web build
 * (`make run PROFILE=<name>` serves it on PROLIFERATE_WEB_PORT — 1604 for gatec),
 * injects a real product session into localStorage (the same
 * `proliferate.auth.session` key the app's browser-mode auth store reads), and
 * keeps the page alive. Once the page hydrates, `useLocalWorkflowExecutor` mounts
 * `useLocalWorkflowClaimPoller` (cloud active + runtime healthy + workflowsEnabled)
 * and begins the 10s claim poll → mint worktree → deliver plan → 2s relay loop —
 * i.e. this process IS the desktop executor for T3-WF-7.
 *
 * It authenticates by doing a real `POST /auth/desktop/password/login` for the
 * durable user, so no browser login UI is driven. Runs until SIGTERM/SIGINT (the
 * scenario spawns it, then kills it in a finally) or until `--max-seconds` elapses.
 *
 * Env / flags:
 *   RELEASE_E2E_SERVER_URL          API base (default http://127.0.0.1:8092)
 *   RELEASE_E2E_DESKTOP_WEB_URL     desktop web build (default http://127.0.0.1:1604)
 *   RELEASE_E2E_DURABLE_USER_EMAIL / _PASSWORD   durable login
 *   --max-seconds=N                 hard lifetime cap (default 600)
 *   --headed                        run headed (debugging)
 *
 * Playwright is resolved from the repo-root node_modules (walked up from here);
 * tests/release itself declares no Playwright dep on purpose.
 */

import { chromium } from "playwright";

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const SERVER_URL = (process.env.RELEASE_E2E_SERVER_URL ?? "http://127.0.0.1:8092").replace(/\/$/, "");
const WEB_URL = (process.env.RELEASE_E2E_DESKTOP_WEB_URL ?? "http://127.0.0.1:1604").replace(/\/$/, "");
const EMAIL = process.env.RELEASE_E2E_DURABLE_USER_EMAIL;
const PASSWORD = process.env.RELEASE_E2E_DURABLE_USER_PASSWORD;
const MAX_SECONDS = Number(arg("max-seconds", "600"));

function log(msg, extra) {
  const line = `[wf7-driver] ${msg}`;
  if (extra !== undefined) {
    console.log(line, typeof extra === "string" ? extra : JSON.stringify(extra));
  } else {
    console.log(line);
  }
}

async function desktopLogin() {
  if (!EMAIL || !PASSWORD) {
    throw new Error("RELEASE_E2E_DURABLE_USER_EMAIL / _PASSWORD must be set");
  }
  const res = await fetch(`${SERVER_URL}/auth/desktop/password/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`desktop login failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

function storedSessionFrom(tokens) {
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 604800) * 1000).toISOString();
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    user_id: tokens.user?.id ?? "",
    email: tokens.user?.email ?? EMAIL,
    display_name: tokens.user?.display_name ?? null,
    github_login: null,
    avatar_url: null,
  };
}

async function main() {
  log(`server=${SERVER_URL} web=${WEB_URL} email=${EMAIL}`);
  const tokens = await desktopLogin();
  const session = storedSessionFrom(tokens);
  log("durable session minted; launching browser");

  const browser = await chromium.launch({ headless: !hasFlag("headed") });
  const context = await browser.newContext();
  // Inject the product session before any app script runs, under the exact
  // localStorage key the desktop app's browser-mode auth store reads.
  await context.addInitScript((s) => {
    try {
      window.localStorage.setItem("proliferate.auth.session", JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, session);

  const page = await context.newPage();
  page.on("console", (m) => {
    const t = m.text();
    if (/workflow|claim|executor|runtime|cloud\.availability/i.test(t)) {
      log(`console: ${t}`.slice(0, 300));
    }
  });
  let claimPolls = 0;
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/workflows/executor/local/claims")) {
      claimPolls += 1;
      if (claimPolls <= 3 || claimPolls % 5 === 0) log(`claim poll #${claimPolls} -> POST ${u}`);
    } else if (u.includes("/executor/local/runs/") || u.includes("/workflow-runs")) {
      log(`executor call -> ${req.method()} ${u}`);
    }
  });

  await page.goto(WEB_URL, { waitUntil: "domcontentloaded" });
  log("page loaded; keeping executor alive");

  let stopped = false;
  const stop = async (why) => {
    if (stopped) return;
    stopped = true;
    log(`stopping (${why}); claim polls observed=${claimPolls}`);
    await browser.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
  setTimeout(() => void stop("max-seconds"), MAX_SECONDS * 1000);

  // Heartbeat so a spawning parent sees liveness.
  setInterval(() => log(`alive; claim polls=${claimPolls}`), 30_000);
}

main().catch((err) => {
  log(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
