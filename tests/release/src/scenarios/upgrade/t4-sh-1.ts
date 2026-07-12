import assert from "node:assert/strict";

import type { ScenarioDefinition } from "../types.js";
import { ScenarioBlockedError } from "../types.js";
import { ApiClient } from "../../fixtures/http.js";
import {
  provisionSelfHostBox,
  terminateSelfHostBox,
  readSetupTokenOverSsh,
  runUpdateOverSsh,
  ssh,
  COMPOSE_OVER_SSH,
  type SelfHostBox,
} from "../../fixtures/selfhost.js";

/**
 * T4-SH-1 — operator update motion.
 * specs/developing/testing/self-hosting.md#T4-SH-1
 *
 * Boots a self-hosted box pinned to the previous server release (N-1), claims
 * an admin (so there is existing user data to preserve), then runs the exact
 * operator updater — `./update.sh`, which pulls the new image, runs
 * `alembic upgrade head`, and restarts — pinned to N, and asserts:
 *   - migrations applied (alembic_version populated),
 *   - health green,
 *   - /meta reports N,
 *   - the pre-update admin still logs in (session/user data intact).
 *
 * Both published artifact versions are explicit: the runner never guesses
 * N-1 from the candidate patch number and never silently substitutes the
 * checkout VERSION. Cost-gated behind RELEASE_E2E_SELFHOST_PROVISION;
 * terminates the box in a finally.
 */

const ADMIN_PASSWORD = "proliferate-e2e-admin-1";

export const t4Sh1: ScenarioDefinition = {
  id: "T4-SH-1",
  title: "operator update motion (update.sh N-1 -> N, data intact)",
  registryFlowRef: "specs/developing/testing/self-hosting.md#T4-SH-1",
  lanes: ["local"],
  requiredEnv: [
    "RELEASE_E2E_SELFHOST_PROVISION",
    "RELEASE_E2E_SELFHOST_UPDATE_FROM",
    "RELEASE_E2E_SELFHOST_UPDATE_TO",
  ],
  plan: () => [
    { description: "provision a self-hosted box pinned to the previous release (N-1)" },
    { description: "claim an admin so there is existing user data to preserve" },
    { description: "record baseline /meta serverVersion == N-1" },
    { description: "run ./update.sh pinned to N (pull + alembic upgrade head + restart)" },
    { description: "assert migrations applied, health green, /meta reports N" },
    { description: "assert the pre-update admin still logs in (data intact)" },
    { description: "terminate the box (finally)" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    if (process.env.RELEASE_E2E_SELFHOST_PROVISION?.trim() !== "1") {
      throw new ScenarioBlockedError(
        "T4-SH-1: provisioning a fresh self-hosted EC2 box costs real infra. Set " +
          "RELEASE_E2E_SELFHOST_PROVISION=1 (with AWS creds) to run it for real. Not set.",
      );
    }
    await runReal();
  },
};

async function runReal(): Promise<void> {
  const rawFrom = nonEmpty(process.env.RELEASE_E2E_SELFHOST_UPDATE_FROM);
  const rawTo = nonEmpty(process.env.RELEASE_E2E_SELFHOST_UPDATE_TO);
  if (!rawFrom || !rawTo) {
    throw new Error(
      "T4-SH-1: RELEASE_E2E_SELFHOST_UPDATE_FROM and RELEASE_E2E_SELFHOST_UPDATE_TO must both name " +
        "explicit immutable published versions; version inference is forbidden.",
    );
  }
  const fromVersion = releaseVersion(rawFrom, "N-1");
  const toVersion = releaseVersion(rawTo, "candidate N");
  assert.notEqual(fromVersion, toVersion, "T4-SH-1: N-1 and candidate N must differ");

  const box = await provisionSelfHostBox(fromVersion);
  try {
    const adminEmail = `admin-${box.instanceId}@proliferate-releasee2e.dev`;
    const client = new ApiClient({ baseUrl: box.url });

    const before = await client.get<{ serverVersion?: string }>("/meta");
    assert.equal(before.serverVersion, fromVersion, `T4-SH-1: box did not boot on N-1=${fromVersion}`);
    console.log(`[T4-SH-1] booted on N-1=${before.serverVersion}`);

    // Claim so there is durable user data across the update.
    const setupToken = await readSetupTokenOverSsh(box);
    assert.ok(setupToken.length > 0, "T4-SH-1: could not read the setup token");
    await claim(box.url, adminEmail, ADMIN_PASSWORD, setupToken);
    await desktopLogin(box.url, adminEmail, ADMIN_PASSWORD); // proves it works pre-update
    const usersBefore = await psqlScalar(box, 'select count(*) from "user"');

    // The operator update motion.
    console.log(`[T4-SH-1] running ./update.sh -> N=${toVersion}`);
    await runUpdateOverSsh(box, toVersion);

    // Migrations applied.
    const alembicRows = await psqlScalar(box, "select count(*) from alembic_version");
    assert.ok(/^[1-9]/.test(alembicRows), `T4-SH-1: alembic_version empty after update (${alembicRows})`);

    // Health green + /meta reports N.
    const health = await client.get<{ status?: string }>("/health");
    assert.equal(health.status, "ok", "T4-SH-1: health not ok after update");
    const after = await client.get<{ serverVersion?: string }>("/meta");
    assert.equal(after.serverVersion, toVersion, `T4-SH-1: /meta should report N=${toVersion} after update`);
    console.log(`[T4-SH-1] converged: /meta serverVersion=${after.serverVersion}`);

    // Data intact: the pre-update admin still authenticates, and the row count held.
    await desktopLogin(box.url, adminEmail, ADMIN_PASSWORD);
    const usersAfter = await psqlScalar(box, 'select count(*) from "user"');
    assert.equal(usersAfter, usersBefore, `T4-SH-1: user rows changed across update (${usersBefore} -> ${usersAfter})`);
    console.log(`[T4-SH-1] data intact: admin still logs in, users=${usersAfter}`);
  } finally {
    await terminateSelfHostBox(box);
  }
}

async function claim(baseUrl: string, email: string, password: string, setupToken: string): Promise<void> {
  const body = new URLSearchParams({ email, password, setup_token: setupToken });
  const response = await fetch(`${baseUrl}/setup`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await response.text();
  assert.ok(response.ok && text.includes("You are all set"), `T4-SH-1: claim failed ${response.status}`);
}

async function desktopLogin(baseUrl: string, email: string, password: string): Promise<void> {
  const client = new ApiClient({ baseUrl });
  const res = await client.post<{ access_token?: string; accessToken?: string }>(
    "/auth/desktop/password/login",
    { email, password },
  );
  assert.ok(res.access_token ?? res.accessToken, `T4-SH-1: login for ${email} returned no token`);
}

async function psqlScalar(box: SelfHostBox, query: string): Promise<string> {
  const out = await ssh(
    box,
    `cd ~/proliferate/deploy && ${COMPOSE_OVER_SSH} exec -T db psql -U proliferate -d proliferate -tAc '${query}'`,
  );
  return out.trim();
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

function releaseVersion(value: string, label: string): string {
  const version = value.trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`T4-SH-1: ${label} version is not an immutable semver: ${JSON.stringify(value)}`);
  }
  return version;
}
