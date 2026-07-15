import assert from "node:assert/strict";

import type { ScenarioDefinition } from "../types.js";
import { ApiClient } from "../../fixtures/http.js";

/**
 * T3-SH-5 — adaptive sign-in surface is truthful on real infra.
 * specs/developing/testing/self-hosting.md#T3-SH-5
 *
 * self-hosting.spec.ts (T2-SH-4) proves the desktop's login screen renders
 * whatever `GET /auth/desktop/methods` + `GET /auth/desktop/github/
 * availability` advertise, against a server this repo's own test harness
 * booted and configured. This closes the gap that leaves: does the REAL
 * deploy artifact, on a REAL box, actually answer those two probes
 * truthfully and consistently — never a crash, never a self-contradicting
 * shape — regardless of which auth methods that particular box has
 * configured? Deliberately posture-agnostic (does not assume GitHub OAuth is
 * or isn't configured on the box this runs against), asserting internal
 * consistency and the one thing every self-hosted box must offer: password
 * login. Also spot-checks the SSO discovery entry point (`/auth/sso/
 * discover`, T2-AUTH-5's server-level seam) survives on real infra without an
 * org context — a self-hosted box may have no SSO connections at all, and
 * discover must answer cleanly rather than 500.
 *
 * Read-only against a STANDING box (RELEASE_E2E_SELFHOST_URL, same var
 * T3-SH-3/T3-SH-4 use) — no provisioning, no mutation, no login attempted
 * (this box's real admin credentials are not available to this scenario).
 * BLOCKED (not red) without that var.
 */
export const t3Sh5: ScenarioDefinition = {
  id: "T3-SH-5",
  title: "adaptive sign-in surface is truthful on real infra",
  registryFlowRef: "specs/developing/testing/self-hosting.md#T3-SH-5",
  lanes: ["local"],
  requiredEnv: ["RELEASE_E2E_SELFHOST_URL"],
  plan: () => [
    { description: "GET /auth/desktop/methods; assert password_login=true and the shape is well-formed" },
    { description: "GET /auth/desktop/github/availability; assert enabled<->client_id consistency" },
    { description: "GET /auth/sso/discover with no org context; assert it answers cleanly (never 500) with no ids" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    const baseUrl = ctx.env.require("RELEASE_E2E_SELFHOST_URL").replace(/\/+$/, "");
    const client = new ApiClient({ baseUrl });

    const methods = await client.get<{ password_login?: boolean; github?: boolean }>(
      "/auth/desktop/methods",
    );
    assert.equal(
      methods.password_login,
      true,
      "T3-SH-5: every self-hosted box must advertise password login",
    );
    assert.equal(typeof methods.github, "boolean", "T3-SH-5: methods.github must be a boolean");

    const github = await client.get<{ enabled?: boolean; client_id?: string | null }>(
      "/auth/desktop/github/availability",
    );
    assert.equal(typeof github.enabled, "boolean", "T3-SH-5: github availability.enabled must be a boolean");
    if (github.enabled) {
      assert.ok(
        typeof github.client_id === "string" && github.client_id.length > 0,
        "T3-SH-5: github.enabled=true but no client_id — the button would render with nothing to start",
      );
    } else {
      assert.equal(
        github.client_id ?? null,
        null,
        "T3-SH-5: github.enabled=false but a client_id leaked — should be null when unavailable",
      );
    }
    // methods.github and the availability probe must agree — the login
    // screen reads both, and a mismatch would render a broken half-state.
    assert.equal(
      methods.github,
      github.enabled,
      `T3-SH-5: /auth/desktop/methods.github (${methods.github}) disagrees with ` +
        `/auth/desktop/github/availability.enabled (${github.enabled})`,
    );

    // Posture-agnostic (this box may or may not have deployment-level SSO
    // configured, which this scenario has no way to know) — the guarantee
    // worth proving on real infra is that the route survives at all and
    // returns a well-formed answer, never a 500, for the no-context case
    // every unconfigured self-hosted box hits by default.
    const discover = await client.get<{
      enabled?: boolean;
      connectionId?: string | null;
    }>("/auth/sso/discover");
    assert.equal(typeof discover.enabled, "boolean", "T3-SH-5: discover.enabled must be a boolean");
    if (!discover.enabled) {
      assert.equal(
        discover.connectionId ?? null,
        null,
        "T3-SH-5: discover must not report a connection id when SSO is not enabled",
      );
    }

    console.log(
      `[T3-SH-5] ${baseUrl} sign-in surface is truthful (password_login=true, github=${methods.github}, ` +
        `discover.enabled=${discover.enabled} for the no-context case).`,
    );
  },
};
