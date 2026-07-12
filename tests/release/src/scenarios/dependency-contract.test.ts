import assert from "node:assert/strict";
import test from "node:test";

import { envVarNames } from "../config/env-manifest.js";
import { SCENARIOS } from "./registry.js";

const EXPECTED_T3_CELL_DEPENDENCIES = {
  "T3-PROV-1/sandbox": [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
    "RELEASE_E2E_LOCAL_DATABASE_URL",
  ],
  "T3-PROV-2/sandbox": [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_E2B_API_KEY",
  ],
  "T3-WT-1/local": ["RELEASE_E2E_LOCAL_RUNTIME_URL"],
  "T3-WT-1/sandbox": [],
  "T3-CHAT-1/local": ["RELEASE_E2E_LOCAL_RUNTIME_URL"],
  "T3-CHAT-1/sandbox": [],
  "T3-GW-1/local": [
    "RELEASE_E2E_GATEWAY_TEST_KEY",
    "RELEASE_E2E_GATEWAY_BASE_URL",
    "RELEASE_E2E_LOCAL_RUNTIME_URL",
  ],
  "T3-CFG-1/local": ["RELEASE_E2E_LOCAL_RUNTIME_URL"],
  "T3-UPDATE-1/local": [],
  "T3-UPDATE-1/sandbox": [],
  "T3-SEC-MAT-1/sandbox": [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_E2B_API_KEY",
    "RELEASE_E2E_LOCAL_DATABASE_URL",
  ],
  "T3-REPO-1/local": [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_LOCAL_DATABASE_URL",
  ],
  "T3-REPO-1/sandbox": [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_LOCAL_DATABASE_URL",
  ],
  "T3-INT-1/local": [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
    "RELEASE_E2E_INTEGRATION_API_KEY",
    "RELEASE_E2E_LOCAL_DATABASE_URL",
    "RELEASE_E2E_LOCAL_RUNTIME_URL",
  ],
  "T3-INT-1/sandbox": [],
  "T3-BILL-1/local": ["RELEASE_E2E_DURABLE_USER_EMAIL", "RELEASE_E2E_LOCAL_DATABASE_URL"],
  "T3-BILL-1/sandbox": ["RELEASE_E2E_DURABLE_USER_EMAIL", "RELEASE_E2E_LOCAL_DATABASE_URL"],
  "T3-BILL-2/sandbox": [],
  "T3-BILL-3/sandbox": [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
  ],
  "T3-BILL-4/sandbox": [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
  ],
  "T3-SH-1/local": ["RELEASE_E2E_SELFHOST_PROVISION"],
  "T3-SH-2/local": [],
  "T3-SH-3/local": ["RELEASE_E2E_SELFHOST_URL", "RELEASE_E2E_GATEWAY_TEST_KEY"],
  "T3-SH-4/local": ["RELEASE_E2E_SELFHOST_URL"],
  "T3-SH-5/local": ["RELEASE_E2E_SELFHOST_URL"],
  "T3-WF-1/local": [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
  ],
  "T3-WF-1/sandbox": [],
  "T3-WF-2/local": [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
  ],
  "T3-WF-2/sandbox": [],
  "T3-WF-3/local": [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
    "RELEASE_E2E_INTEGRATION_API_KEY",
  ],
  "T3-WF-3/sandbox": [],
  "T3-WF-4/sandbox": [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
  ],
  "T3-WF-5/local": [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
  ],
  "T3-WF-6/sandbox": [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
  ],
  "T3-WF-7/local": [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
    "RELEASE_E2E_LOCAL_DATABASE_URL",
    "RELEASE_E2E_LOCAL_RUNTIME_URL",
    "RELEASE_E2E_DESKTOP_WEB_URL",
  ],
} as const satisfies Record<string, readonly string[]>;

test("every registered T3 cell declares its exact hard environment dependencies", () => {
  const manifestNames = new Set(envVarNames());
  const actual = new Map<string, string[]>();

  for (const scenario of SCENARIOS.filter(({ id }) => id.startsWith("T3-"))) {
    for (const lane of Object.keys(scenario.requiredEnvByLane ?? {})) {
      assert.ok(
        scenario.lanes.includes(lane as (typeof scenario.lanes)[number]),
        `${scenario.id}: requiredEnvByLane declares unsupported lane ${lane}`,
      );
    }

    for (const lane of scenario.lanes) {
      const cell = `${scenario.id}/${lane}`;
      const declared = [...scenario.requiredEnv, ...(scenario.requiredEnvByLane?.[lane] ?? [])];
      assert.equal(new Set(declared).size, declared.length, `${cell}: dependencies must not be duplicated`);
      for (const name of declared) {
        assert.ok(manifestNames.has(name), `${cell}: ${name} is absent from ENV_MANIFEST`);
      }
      actual.set(cell, [...declared].sort());
    }
  }

  assert.deepEqual([...actual.keys()].sort(), Object.keys(EXPECTED_T3_CELL_DEPENDENCIES).sort());
  for (const [cell, expected] of Object.entries(EXPECTED_T3_CELL_DEPENDENCIES)) {
    assert.deepEqual(actual.get(cell), [...expected].sort(), `${cell}: hard dependency contract drifted`);
  }
});
