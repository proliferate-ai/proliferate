import assert from "node:assert/strict";

import type { ScenarioDefinition } from "../types.js";
import { BATTERY_FLOW_REF, assertStagingLane } from "./common.js";

/**
 * T3-BATT-WEB-1 — the web shell serves, thin smoke.
 *
 * The spine UI journey is DESKTOP (ruled 2026-08-26; own slice). Web is one
 * thin smoke inside the API body: the deployed web app at RELEASE_E2E_WEB_URL
 * serves its shell (HTML, 200) at the root and at the login route (SPA
 * fallback), and the API it is configured against answers its health probe.
 *
 * Outcomes asserted: `GET /` → 200 text/html with a document body · `GET /login`
 * → 200 text/html · `GET {api}/health` → 200 with a version string.
 */
export const t3BattWeb1: ScenarioDefinition = {
  id: "T3-BATT-WEB-1",
  title: "battery: web shell + login route serve; API health answers",
  registryFlowRef: BATTERY_FLOW_REF,
  lanes: ["sandbox"],
  requiredEnv: ["RELEASE_E2E_SERVER_URL", "RELEASE_E2E_WEB_URL"],
  plan: () => [
    { description: "GET the web root; assert 200 + text/html with a non-trivial document" },
    { description: "GET /login; assert the SPA serves it (200 + text/html)" },
    { description: "GET the API health route; assert 200 and a version" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    assertStagingLane("T3-BATT-WEB-1", ctx);
    const webUrl = ctx.env.require("RELEASE_E2E_WEB_URL").replace(/\/+$/, "");
    const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL").replace(/\/+$/, "");

    for (const route of ["/", "/login"]) {
      const response = await fetch(`${webUrl}${route}`, { redirect: "follow" });
      assert.equal(response.status, 200, `T3-BATT-WEB-1: GET ${route} must serve 200 (got ${response.status})`);
      const contentType = response.headers.get("content-type") ?? "";
      assert.ok(contentType.includes("text/html"), `T3-BATT-WEB-1: GET ${route} must serve HTML (got ${contentType})`);
      const body = await response.text();
      assert.ok(/<html[\s>]/i.test(body) && body.length > 256, `T3-BATT-WEB-1: GET ${route} must serve a document`);
    }

    const health = await fetch(`${serverUrl}/health`);
    assert.equal(health.status, 200, `T3-BATT-WEB-1: API health must answer 200 (got ${health.status})`);
    const payload = (await health.json()) as { status?: string; version?: string };
    assert.equal(payload.status, "ok", "T3-BATT-WEB-1: API health status must be ok");
    assert.ok(payload.version, "T3-BATT-WEB-1: API health must report a version");

    console.log(`[T3-BATT-WEB-1/staging] green: web shell + /login serve; API ${serverUrl} healthy at ${payload.version}.`);
  },
};
