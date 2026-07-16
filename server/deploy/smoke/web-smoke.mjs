#!/usr/bin/env node
// Browser proof that the self-hosted server image serves the real, executable
// ProductClient Web application same-origin with its API.
//
// Loads the given base URL in headless Chromium against the LIVE stack (so the
// bundled JavaScript resolves its API from window.location.origin, reaches the
// real API through Caddy, and renders the signed-out login surface), then
// asserts:
//   - the bundled JS actually executed (the #root shell mounted content);
//   - the durable ProductClient login-ready marker [data-auth-screen="auth"]
//     appears (rendered only once the shell resolves to the sign-in surface);
//   - at least one hashed JS and one hashed CSS asset loaded with HTTP 200;
//   - a direct load of a deep client route (refresh) also boots the app.
//
// Usage: node web-smoke.mjs <base-url>
// Exits nonzero with a clear message on the first failed assertion.

import process from "node:process";

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error("[web-smoke] FAIL: base URL argument is required");
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (error) {
  console.error(
    "[web-smoke] FAIL: playwright is not installed. Install it before running "
      + `the browser smoke (import error: ${error?.message ?? error}).`,
  );
  process.exit(2);
}

function log(message) {
  console.log(`[web-smoke] ${message}`);
}

function fail(message) {
  console.error(`[web-smoke] FAIL: ${message}`);
  process.exit(1);
}

const browser = await chromium.launch();
let exitCode = 0;
try {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Record which hashed assets loaded successfully so we can prove real CSS/JS
  // were fetched with 200s (not just the HTML shell).
  const okAssets = { js: 0, css: 0 };
  page.on("response", (response) => {
    const url = response.url();
    if (response.status() !== 200) return;
    if (/\/assets\/.+\.js(\?|$)/.test(url)) okAssets.js += 1;
    if (/\/assets\/.+\.css(\?|$)/.test(url)) okAssets.css += 1;
  });

  const loginUrl = new URL("/login", baseUrl).toString();
  log(`loading ${loginUrl}`);
  const resp = await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 60000 });
  if (!resp || resp.status() !== 200) {
    fail(`GET /login returned ${resp ? resp.status() : "no response"}`);
  }

  // Bundled JS executed if the login-ready marker rendered. AuthScreenLayout
  // emits [data-auth-screen="auth"] only after the shell resolves to the
  // signed-out sign-in surface, so this proves both execution and readiness.
  try {
    await page.waitForSelector('[data-auth-screen="auth"]', { timeout: 45000 });
  } catch {
    const bodyText = (await page.textContent("body").catch(() => "")) ?? "";
    fail(
      "the login-ready marker [data-auth-screen=\"auth\"] never appeared; the "
        + `bundled app did not render the sign-in surface. Body head: ${bodyText.slice(0, 200)}`,
    );
  }
  log('login-ready marker [data-auth-screen="auth"] rendered (JS executed)');

  const rootHasContent = await page.evaluate(() => {
    const root = document.getElementById("root");
    return Boolean(root && root.childElementCount > 0);
  });
  if (!rootHasContent) {
    fail("#root mounted no content; the bundled app did not hydrate");
  }
  log("#root mounted app content");

  if (okAssets.js < 1) fail("no hashed JS asset loaded with HTTP 200");
  if (okAssets.css < 1) fail("no hashed CSS asset loaded with HTTP 200");
  log(`hashed assets loaded: ${okAssets.js} JS, ${okAssets.css} CSS`);

  // Direct load of a deep client route (a browser refresh on a client route)
  // must also boot the app via the SPA fallback, not 404.
  const deepUrl = new URL("/settings", baseUrl).toString();
  log(`refreshing deep client route ${deepUrl}`);
  const deepResp = await page.goto(deepUrl, { waitUntil: "networkidle", timeout: 60000 });
  if (!deepResp || deepResp.status() !== 200) {
    fail(`direct GET /settings returned ${deepResp ? deepResp.status() : "no response"}`);
  }
  const deepRootHasContent = await page.evaluate(() => {
    const root = document.getElementById("root");
    return Boolean(root && root.childElementCount > 0);
  });
  if (!deepRootHasContent) {
    fail("deep-route refresh did not boot the app (#root empty)");
  }
  log("deep client route refresh booted the app");

  log("OK: the server image serves the real, executable Web application");
} catch (error) {
  console.error(`[web-smoke] FAIL: unexpected error: ${error?.stack ?? error}`);
  exitCode = 1;
} finally {
  await browser.close();
}
process.exit(exitCode);
