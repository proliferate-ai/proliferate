import assert from "node:assert/strict";

import type { ScenarioDefinition } from "../types.js";
import { BillingHttpClient } from "../../fixtures/billing-http.js";
import {
  BATTERY_FLOW_REF,
  DURABLE_USER_EMAIL_DEFAULT,
  assertStagingLane,
  authenticateBattery,
  durableOrgId,
} from "./common.js";

/**
 * T3-BATT-AUTH-1 — identity + org membership, live on staging.
 *
 * Journey: the durable staging user authenticates (browser-free session
 * rotation — the same `/auth/mobile/session/refresh` route every client uses),
 * the session identifies the expected account, and the account's organization
 * list contains the durable org with an active membership.
 *
 * Outcomes asserted: a bearer session exists · `user.email` is the seeded
 * durable identity · the durable org (RELEASE_E2E_DURABLE_ORG_ID when set,
 * else exactly one owned org) is listed with a live membership.
 */
export const t3BattAuth1: ScenarioDefinition = {
  id: "T3-BATT-AUTH-1",
  title: "battery: durable login → identity → org membership",
  registryFlowRef: BATTERY_FLOW_REF,
  lanes: ["sandbox"],
  requiredEnv: ["RELEASE_E2E_SERVER_URL"],
  plan: () => [
    { description: "rotate the durable staging session (POST /auth/mobile/session/refresh)" },
    { description: "assert the session names the seeded durable identity" },
    { description: "GET the organizations list; assert the durable org is present with an active membership" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    assertStagingLane("T3-BATT-AUTH-1", ctx);
    const { serverUrl, session } = await authenticateBattery("T3-BATT-AUTH-1", ctx);

    assert.ok(session.accessToken.length > 0, "T3-BATT-AUTH-1: session must carry an access token");
    assert.equal(session.tokenType, "bearer", "T3-BATT-AUTH-1: session token type must be bearer");
    assert.ok(session.user?.id, "T3-BATT-AUTH-1: session must identify a user");
    // The session must belong to THE durable identity — a session for any other
    // user must red this journey (refuter finding 10). The env override exists
    // for future worlds; on staging the seeded identity is the default.
    const expectedEmail = process.env.RELEASE_E2E_DURABLE_USER_EMAIL?.trim() || DURABLE_USER_EMAIL_DEFAULT;
    assert.equal(
      session.user.email,
      expectedEmail,
      `T3-BATT-AUTH-1: the session must identify the durable user ${expectedEmail} (got ${session.user.email})`,
    );

    const billing = new BillingHttpClient(serverUrl, session.accessToken);
    const orgs = await billing.organizations();
    assert.ok(orgs.length > 0, "T3-BATT-AUTH-1: the durable user must belong to at least one organization");

    const expectedOrg = durableOrgId();
    const target = expectedOrg ? orgs.find((org) => org.id === expectedOrg) : orgs.length === 1 ? orgs[0] : undefined;
    assert.ok(
      target,
      `T3-BATT-AUTH-1: durable org ${expectedOrg ?? "(single owned org)"} must appear in the user's organizations ` +
        `(found ${orgs.map((org) => org.id).join(", ")})`,
    );
    if (target.membership) {
      assert.notEqual(
        target.membership.status,
        "revoked",
        `T3-BATT-AUTH-1: durable org membership must be live (status=${target.membership.status})`,
      );
    }

    console.log(
      `[T3-BATT-AUTH-1/staging] green: user ${session.user.email} authenticated; org ${target.id} (${target.name}) ` +
        `membership ${target.membership?.role ?? "?"}/${target.membership?.status ?? "?"}.`,
    );
  },
};
