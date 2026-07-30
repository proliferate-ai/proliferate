import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { verifyWebDeployment } from "./verify-web-deployment.mjs";

const API_BASE_URL = "https://app.proliferate.test/api";
const WEB_URL = "https://web.proliferate.test";
const HEALTH_URL = `${API_BASE_URL}/health`;
const ASSET_URL = `${WEB_URL}/assets/index.js`;

function response(body, status = 200, contentType = "text/plain") {
  return new Response(body, {
    status,
    headers: { "Content-Type": contentType },
  });
}

function fakeFetch(routes) {
  const calls = [];
  const requests = [];
  const fetchImpl = async (input, options) => {
    const url = String(input);
    calls.push(url);
    requests.push({ options, url });
    const value = routes.get(url);
    if (!value) {
      throw new Error(`unexpected URL ${url}`);
    }
    return value;
  };
  return { calls, fetchImpl, requests };
}

function healthyRoutes(
  assetSource = `const apiBase = "${API_BASE_URL}";`,
  healthBody = '{"status":"ok","version":"1.2.3"}',
) {
  return new Map([
    [HEALTH_URL, response(healthBody, 200, "application/json")],
    [
      WEB_URL,
      response(
        '<!doctype html><script type="module" src="/assets/index.js"></script>',
        200,
        "text/html",
      ),
    ],
    [ASSET_URL, response(assetSource, 200, "application/javascript")],
  ]);
}

test("verifies the API health and exact base baked into the candidate bundle", async () => {
  const fake = fakeFetch(healthyRoutes());

  const receipt = await verifyWebDeployment({
    webUrl: `${WEB_URL}/`,
    apiBaseUrl: `${API_BASE_URL}/`,
    fetchImpl: fake.fetchImpl,
  });

  assert.deepEqual(fake.calls, [HEALTH_URL, WEB_URL, ASSET_URL]);
  assert.equal(fake.requests[0].options?.redirect, "manual");
  assert.deepEqual(receipt, {
    apiBaseUrl: API_BASE_URL,
    healthUrl: HEALTH_URL,
    webUrl: WEB_URL,
    matchedAssetUrl: ASSET_URL,
  });
});

test("rejects the production Cloudflare 530 failure before checking Web", async () => {
  const routes = healthyRoutes();
  routes.set(HEALTH_URL, response("error code: 1016", 530));
  const fake = fakeFetch(routes);

  await assert.rejects(
    () =>
      verifyWebDeployment({
        webUrl: WEB_URL,
        apiBaseUrl: API_BASE_URL,
        fetchImpl: fake.fetchImpl,
      }),
    /API health returned HTTP 530/,
  );
  assert.deepEqual(fake.calls, [HEALTH_URL]);
});

test("rejects an API health redirect before checking Web", async () => {
  const routes = healthyRoutes();
  routes.set(HEALTH_URL, response("", 302));
  const fake = fakeFetch(routes);

  await assert.rejects(
    () =>
      verifyWebDeployment({
        webUrl: WEB_URL,
        apiBaseUrl: API_BASE_URL,
        fetchImpl: fake.fetchImpl,
      }),
    /API health returned HTTP 302/,
  );
  assert.equal(fake.requests[0].options?.redirect, "manual");
  assert.deepEqual(fake.calls, [HEALTH_URL]);
});

test("rejects an unrelated successful health response before checking Web", async () => {
  const routes = healthyRoutes();
  routes.set(
    HEALTH_URL,
    response("<html>Sign in</html>", 200, "text/html"),
  );
  const fake = fakeFetch(routes);

  await assert.rejects(
    () =>
      verifyWebDeployment({
        webUrl: WEB_URL,
        apiBaseUrl: API_BASE_URL,
        fetchImpl: fake.fetchImpl,
      }),
    /API health did not return JSON/,
  );
  assert.deepEqual(fake.calls, [HEALTH_URL]);
});

test("rejects a generic JSON health response before checking Web", async () => {
  const fake = fakeFetch(healthyRoutes('const unused = "ok";', '{"status":"ok"}'));

  await assert.rejects(
    () =>
      verifyWebDeployment({
        webUrl: WEB_URL,
        apiBaseUrl: API_BASE_URL,
        fetchImpl: fake.fetchImpl,
      }),
    /API health did not return the product health contract/,
  );
  assert.deepEqual(fake.calls, [HEALTH_URL]);
});

test("rejects a candidate bundle that baked a stale API base", async () => {
  const fake = fakeFetch(
    healthyRoutes('const apiBase = "https://api.proliferate.test";'),
  );

  await assert.rejects(
    () =>
      verifyWebDeployment({
        webUrl: WEB_URL,
        apiBaseUrl: API_BASE_URL,
        fetchImpl: fake.fetchImpl,
      }),
    /did not bake the expected API base/,
  );
  assert.deepEqual(fake.calls, [HEALTH_URL, WEB_URL, ASSET_URL]);
});

test("rejects a longer API base that only contains the expected target", async () => {
  const fake = fakeFetch(
    healthyRoutes(`const apiBase = "${API_BASE_URL}/v2";`),
  );

  await assert.rejects(
    () =>
      verifyWebDeployment({
        webUrl: WEB_URL,
        apiBaseUrl: API_BASE_URL,
        fetchImpl: fake.fetchImpl,
      }),
    /did not bake the expected API base/,
  );
  assert.deepEqual(fake.calls, [HEALTH_URL, WEB_URL, ASSET_URL]);
});

test("Web workflow pins and verifies the API base before aliasing", async () => {
  const source = await readFile(
    new URL("../../.github/workflows/_deploy-web.yml", import.meta.url),
    "utf8",
  );

  assert.match(source, /API_BASE_URL: \$\{\{ vars\.API_BASE_URL \}\}/);
  assert.match(
    source,
    /: "\$\{API_BASE_URL:\?Set API_BASE_URL on the GitHub environment\.\}"/,
  );
  assert.match(
    source,
    /args\+=\(--build-env "VITE_PROLIFERATE_API_BASE_URL=\$API_BASE_URL"\)/,
  );
  assert.match(source, /args\+=\(--skip-domain\)/);

  const deploy = source.indexOf("- name: Deploy to Vercel");
  const verify = source.indexOf("- name: Verify candidate Web/API pair");
  const alias = source.indexOf("- name: Alias web domain");
  assert.ok(
    deploy >= 0 && deploy < verify && verify < alias,
    "candidate verification must pass after deploy and before aliasing",
  );
  assert.match(
    source.slice(verify, alias),
    /node scripts\/ci-cd\/verify-web-deployment\.mjs[\s\S]*?--web-url[\s\S]*?--api-base-url "\$API_BASE_URL"/,
  );
});
