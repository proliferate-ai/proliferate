import assert from "node:assert/strict";

import type { ScenarioDefinition } from "../types.js";
import { ApiClient } from "../../fixtures/http.js";

/**
 * T3-SH-4 — base-install capability contract holds on real infra.
 * specs/developing/testing/self-hosting.md#T3-SH-4
 *
 * server/tests/unit/test_meta_endpoint.py already pins the pure
 * `build_server_capabilities(Settings)` contract exhaustively (every field,
 * every posture, hosted vs self-managed vs add-ons-on/off), and
 * capability-contract.spec.ts (T2-SH-5) proves the same contract end-to-end
 * against a REAL process for two EXPLICIT postures the test controls
 * (self-managed/off and hosted/on). Neither proves the contract on the deploy
 * ARTIFACT itself — the production compose bundle, the real GHCR image,
 * running on a real box. This is that proof, and it is deliberately
 * POSTURE-AGNOSTIC: it does not assume any add-on is off (the standing box
 * this runs against may legitimately have the gateway add-on on for T3-SH-3's
 * purposes), only that the invariants a SELF-HOSTED deployment can never
 * violate actually hold for real:
 *   - never reports `hosted_product` (this box is not the hosted product);
 *   - never advertises vendor support or vendor pricing (those are the
 *     hosted product's own, never a self-hosted operator's);
 *   - never advertises a hosted web app (self-managed connects via desktop,
 *     never a hosted web handoff);
 *   - the version the capability contract's sibling fields report is the
 *     same version `/health` reports (one process, one version, no split
 *     brain between the two endpoints).
 *
 * Read-only against a STANDING box (RELEASE_E2E_SELFHOST_URL, the same var
 * T3-SH-3 uses) — no provisioning, no mutation, so this never competes with
 * T3-SH-1's cold-boot journey or any other scenario for the box. BLOCKED
 * (not red) without that var.
 */
export const t3Sh4: ScenarioDefinition = {
  id: "T3-SH-4",
  title: "base-install capability contract holds on real infra",
  registryFlowRef: "specs/developing/testing/self-hosting.md#T3-SH-4",
  lanes: ["local"],
  requiredEnv: ["RELEASE_E2E_SELFHOST_URL"],
  plan: () => [
    { description: "GET /meta on the standing self-hosted box; parse capabilities" },
    { description: "assert self-hosting invariants: never hosted_product, never vendor support/pricing, never a hosted web app" },
    { description: "assert /meta's serverVersion matches /health's version (no split brain)" },
    { description: "log the observed add-on posture (billing/usageMetering/cloudWorkspaces/agentGateway) for visibility" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    const baseUrl = ctx.env.require("RELEASE_E2E_SELFHOST_URL").replace(/\/+$/, "");
    const client = new ApiClient({ baseUrl });

    const meta = await client.get<{
      serverVersion?: string;
      capabilities?: {
        deployment?: { mode?: string; displayName?: string };
        billing?: boolean;
        usageMetering?: boolean;
        cloudWorkspaces?: boolean;
        agentGateway?: boolean;
        webApp?: { available?: boolean };
        support?: { kind?: string };
        pricing?: { available?: boolean };
      };
    }>("/meta");

    const caps = meta.capabilities;
    assert.ok(caps, "T3-SH-4: /meta returned no capabilities block");
    assert.notEqual(
      caps.deployment?.mode,
      "hosted_product",
      `T3-SH-4: a self-hosted box must never report deployment.mode=hosted_product, got ${caps.deployment?.mode}`,
    );
    assert.notEqual(
      caps.support?.kind,
      "vendor",
      `T3-SH-4: a self-hosted box must never advertise vendor support, got ${caps.support?.kind}`,
    );
    assert.equal(
      caps.pricing?.available,
      false,
      "T3-SH-4: a self-hosted box must never advertise vendor pricing",
    );
    assert.equal(
      caps.webApp?.available,
      false,
      "T3-SH-4: a self-hosted box must never advertise a hosted web app",
    );

    const health = await client.get<{ version?: string }>("/health");
    assert.equal(
      meta.serverVersion,
      health.version,
      `T3-SH-4: /meta serverVersion (${meta.serverVersion}) and /health version (${health.version}) disagree`,
    );

    console.log(
      `[T3-SH-4] ${baseUrl} self-hosting invariants hold (mode=${caps.deployment?.mode}, ` +
        `serverVersion=${meta.serverVersion}). Observed add-on posture: billing=${caps.billing} ` +
        `usageMetering=${caps.usageMetering} cloudWorkspaces=${caps.cloudWorkspaces} agentGateway=${caps.agentGateway}.`,
    );
  },
};
