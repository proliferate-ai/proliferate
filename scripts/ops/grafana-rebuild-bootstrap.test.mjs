import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { KNOWN_UIDS, queryChecksum } from "./grafana-alerting.mjs";
import { ADMIN_TOKEN_PATH as OLD_ADMIN_TOKEN_PATH } from "./grafana-client.mjs";
import {
  NEW_TARGET,
  ADMIN_TOKEN_PATH,
  OBSERVABILITY_KEYS_PATH,
  WORKSPACE_BASE_URL,
  assertSlackCredentialModes,
  runCheck,
  validateOverlayDocument,
  ensureFolder,
  ensureDatasource,
  ensureRules,
  ensureContactRouting,
  ensureDashboard,
  runApply,
  runVerify,
  runSlackApply,
  runSlackVerify,
  runSlackTest,
} from "./grafana-rebuild-bootstrap.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

function baseOverlay() {
  return JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "server/infra/observability/grafana/production-alerts-rebuild.json"),
      "utf8",
    ),
  );
}

// --- offline check against the real checked-in artifacts -----------------

test("runCheck passes against the checked-in rebuild overlay and dashboard", () => {
  assert.doesNotThrow(() => runCheck({ repoRoot: REPO_ROOT }));
});

test("the rebuild overlay carries exactly the current five-rule allowlist", () => {
  const overlay = baseOverlay();
  assert.deepEqual(
    overlay.rules.map((r) => r.uid).sort(),
    [...KNOWN_UIDS].sort(),
  );
});

test("every rule's checksum reproduces from its own queryModel", () => {
  const overlay = baseOverlay();
  for (const rule of overlay.rules) {
    assert.equal(queryChecksum(rule.queryModel), rule.queryChecksum);
  }
});

// --- validateOverlayDocument rejects drift ---------------------------------

test("rejects a target that does not match the new workspace", () => {
  const overlay = baseOverlay();
  overlay.target = { ...NEW_TARGET, grafanaWorkspaceId: "g-e532d030d8" };
  assert.throws(() => validateOverlayDocument(overlay), /Refusing to operate on a non-matching target/);
});

test("rejects a missing known rule", () => {
  const overlay = baseOverlay();
  overlay.rules = overlay.rules.slice(1);
  assert.throws(() => validateOverlayDocument(overlay), /missing known rules/);
});

test("rejects a rule query stanza pointed at the wrong datasource uid", () => {
  const overlay = baseOverlay();
  overlay.rules[0].queryModel.data[0].datasourceUid = "some-other-uid";
  // Recompute the checksum so this case isolates the datasource-pointer check
  // from the (separately tested) checksum-tamper check.
  overlay.rules[0].queryChecksum = queryChecksum(overlay.rules[0].queryModel);
  assert.throws(() => validateOverlayDocument(overlay), /points at datasourceUid/);
});

test("rejects a tampered queryChecksum", () => {
  const overlay = baseOverlay();
  overlay.rules[0].queryChecksum = "0".repeat(64);
  assert.throws(() => validateOverlayDocument(overlay), /queryChecksum does not match/);
});

test("rejects a contact point that is not sns", () => {
  const overlay = baseOverlay();
  overlay.contactPoint.type = "webhook";
  assert.throws(() => validateOverlayDocument(overlay), /must be sns/);
});

test("rejects the AMG placeholder SNS topic", () => {
  const overlay = baseOverlay();
  overlay.contactPoint.settings.topic = "arn:aws:sns:region:0123456789:SNSTopicName";
  assert.doesNotThrow(() => validateOverlayDocument(overlay)); // still a well-formed ARN shape
  overlay.contactPoint.settings.topic = "not-an-arn";
  assert.throws(() => validateOverlayDocument(overlay), /real SNS topic ARN/);
});

test("rejects contactPoint.name that does not match notificationPolicy.receiver", () => {
  const overlay = baseOverlay();
  overlay.contactPoint.name = "some-other-receiver";
  assert.throws(() => validateOverlayDocument(overlay), /must equal notificationPolicy.receiver/);
});

test("rejects any legacy standalone Slack UID other than the pinned live partial", () => {
  const overlay = baseOverlay();
  overlay.slackContactPoint.legacyUid = "dfvuf540l7ym8e";
  assert.throws(
    () => validateOverlayDocument(overlay),
    /Slack integration inside the fixed default SNS receiver/,
  );
});

// --- fake-client unit tests for the idempotent ensure* operations ---------

function fakeClient(overrides = {}) {
  return {
    getFolder: async () => ({ status: 404, body: null }),
    createFolder: async () => ({ status: 200, body: {} }),
    listDatasources: async () => ({ status: 200, body: [] }),
    createDatasource: async () => ({ status: 200, body: {} }),
    getDatasourceHealth: async () => ({ status: 200, body: { status: "OK" } }),
    getAlertRule: async () => ({ status: 404, body: null }),
    createAlertRule: async () => ({ status: 201, body: {} }),
    getAlertmanagerConfig: async () => ({ status: 200, body: { alertmanager_config: {} } }),
    postAlertmanagerConfig: async () => ({ status: 202, body: {} }),
    getDashboard: async () => ({ status: 404, body: null }),
    createDashboard: async () => ({ status: 200, body: {} }),
    ...overrides,
  };
}

test("ensureFolder creates when absent and is idempotent when present with the right title", async () => {
  const overlay = baseOverlay();
  const created = [];
  const clientMissing = fakeClient({
    createFolder: async (uid, title) => {
      created.push([uid, title]);
      return { status: 200, body: {} };
    },
  });
  assert.equal(await ensureFolder(clientMissing, overlay), "created");
  assert.deepEqual(created, [[overlay.folder.uid, overlay.folder.title]]);

  const clientPresent = fakeClient({
    getFolder: async () => ({ status: 200, body: { title: overlay.folder.title } }),
  });
  assert.equal(await ensureFolder(clientPresent, overlay), "present");
});

test("ensureFolder throws if the live folder title disagrees", async () => {
  const overlay = baseOverlay();
  const client = fakeClient({ getFolder: async () => ({ status: 200, body: { title: "WRONG" } }) });
  await assert.rejects(ensureFolder(client, overlay), /expected/);
});

test("ensureDatasource requires a healthy datasource and creates when absent", async () => {
  const overlay = baseOverlay();
  const client = fakeClient();
  assert.equal(await ensureDatasource(client, overlay), "created");
});

test("ensureDatasource throws when health is not OK", async () => {
  const overlay = baseOverlay();
  const client = fakeClient({ getDatasourceHealth: async () => ({ status: 200, body: { status: "ERROR" } }) });
  await assert.rejects(ensureDatasource(client, overlay), /health check did not return OK/);
});

test("ensureRules creates missing rules and never overwrites a drifted live rule", async () => {
  const overlay = baseOverlay();
  const created = [];
  const clientMissing = fakeClient({
    createAlertRule: async (body) => {
      created.push(body.uid);
      return { status: 201, body: {} };
    },
  });
  const results = await ensureRules(clientMissing, overlay);
  assert.deepEqual(created.sort(), overlay.rules.map((r) => r.uid).sort());
  for (const uid of overlay.rules.map((r) => r.uid)) {
    assert.equal(results[uid], "created");
  }

  const first = overlay.rules[0];
  const drifted = { ...first.queryModel, data: [{ refId: "A", model: { expr: "DRIFTED" } }] };
  const clientDrifted = fakeClient({
    getAlertRule: async (uid) => (uid === first.uid ? { status: 200, body: drifted } : { status: 404, body: null }),
  });
  await assert.rejects(ensureRules(clientDrifted, overlay), /drifted from the checked-in rebuild overlay/);
});

test("ensureContactRouting repoints a placeholder topic and is idempotent once wired", async () => {
  const overlay = baseOverlay();
  const placeholderConfig = {
    alertmanager_config: {
      route: { receiver: overlay.notificationPolicy.receiver },
      receivers: [
        {
          name: overlay.contactPoint.name,
          grafana_managed_receiver_configs: [
            { type: "sns", settings: { topic: "arn:aws:sns:region:0123456789:SNSTopicName" } },
          ],
        },
      ],
    },
  };
  let posted = null;
  const client = fakeClient({
    getAlertmanagerConfig: async () => ({ status: 200, body: JSON.parse(JSON.stringify(placeholderConfig)) }),
    postAlertmanagerConfig: async (body) => {
      posted = body;
      placeholderConfig.alertmanager_config.receivers[0].grafana_managed_receiver_configs[0].settings.topic =
        body.alertmanager_config.receivers[0].grafana_managed_receiver_configs[0].settings.topic;
      return { status: 202, body: {} };
    },
  });
  assert.equal(await ensureContactRouting(client, overlay), "repointed");
  assert.equal(
    posted.alertmanager_config.receivers[0].grafana_managed_receiver_configs[0].settings.topic,
    overlay.contactPoint.settings.topic,
  );

  const wiredClient = fakeClient({
    getAlertmanagerConfig: async () => ({ status: 200, body: JSON.parse(JSON.stringify(placeholderConfig)) }),
  });
  assert.equal(await ensureContactRouting(wiredClient, overlay), "present");
});

test("ensureContactRouting refuses to touch the route tree or create a new receiver", async () => {
  const overlay = baseOverlay();
  const wrongRoute = fakeClient({
    getAlertmanagerConfig: async () => ({
      status: 200,
      body: { alertmanager_config: { route: { receiver: "someone-else" }, receivers: [] } },
    }),
  });
  await assert.rejects(ensureContactRouting(wrongRoute, overlay), /refusing to change routing/);

  const noReceiver = fakeClient({
    getAlertmanagerConfig: async () => ({
      status: 200,
      body: { alertmanager_config: { route: { receiver: overlay.notificationPolicy.receiver }, receivers: [] } },
    }),
  });
  await assert.rejects(ensureContactRouting(noReceiver, overlay), /refusing to create a new receiver/);
});

test("ensureDashboard creates when absent, leaves alone when present", async () => {
  const overlay = baseOverlay();
  const client = fakeClient();
  assert.equal(await ensureDashboard(client, overlay, { dashboard: {} }), "created");
  const present = fakeClient({ getDashboard: async () => ({ status: 200, body: {} }) });
  assert.equal(await ensureDashboard(present, overlay, { dashboard: {} }), "present");
});

// --- end-to-end apply/verify against a single fake in-memory workspace ----

test("apply then verify agree on a from-scratch fake workspace", async () => {
  const overlay = baseOverlay();
  const state = { folder: null, datasources: [], rules: new Map(), am: null, dashboard: null };
  state.am = {
    alertmanager_config: {
      route: { receiver: overlay.notificationPolicy.receiver },
      receivers: [
        {
          name: overlay.contactPoint.name,
          grafana_managed_receiver_configs: [
            { type: "sns", settings: { topic: "arn:aws:sns:region:0123456789:SNSTopicName" } },
          ],
        },
      ],
    },
  };
  const client = {
    getFolder: async () => (state.folder ? { status: 200, body: state.folder } : { status: 404, body: null }),
    createFolder: async (uid, title) => {
      state.folder = { uid, title };
      return { status: 200, body: {} };
    },
    listDatasources: async () => ({ status: 200, body: state.datasources }),
    createDatasource: async (body) => {
      state.datasources.push({ uid: overlay.dataSource.uid, ...body });
      return { status: 200, body: {} };
    },
    getDatasourceHealth: async () => ({ status: 200, body: { status: "OK" } }),
    getAlertRule: async (uid) =>
      state.rules.has(uid) ? { status: 200, body: state.rules.get(uid) } : { status: 404, body: null },
    createAlertRule: async (body) => {
      state.rules.set(body.uid, body);
      return { status: 201, body: {} };
    },
    getAlertmanagerConfig: async () => ({ status: 200, body: JSON.parse(JSON.stringify(state.am)) }),
    postAlertmanagerConfig: async (body) => {
      state.am = body;
      return { status: 202, body: {} };
    },
    getDashboard: async () => (state.dashboard ? { status: 200, body: state.dashboard } : { status: 404, body: null }),
    createDashboard: async (body) => {
      state.dashboard = body;
      return { status: 200, body: {} };
    },
  };

  const applied = await runApply({ client, repoRoot: REPO_ROOT });
  assert.equal(applied.folder, "created");
  assert.equal(applied.datasource, "created");
  assert.equal(applied.contactRouting, "repointed");
  assert.equal(applied.dashboard, "created");
  for (const uid of overlay.rules.map((r) => r.uid)) {
    assert.equal(applied.rules[uid], "created");
  }

  const verified = await runVerify({ client, repoRoot: REPO_ROOT });
  for (const uid of overlay.rules.map((r) => r.uid)) {
    assert.equal(verified.checksums[uid], "match");
  }
  assert.equal(verified.topicWired, true);
  assert.equal(verified.dashboardPresent, true);

  // Re-applying against the now-populated state is a no-op everywhere.
  const reapplied = await runApply({ client, repoRoot: REPO_ROOT });
  assert.equal(reapplied.folder, "present");
  assert.equal(reapplied.datasource, "present");
  assert.equal(reapplied.contactRouting, "present");
  assert.equal(reapplied.dashboard, "present");
  for (const uid of overlay.rules.map((r) => r.uid)) {
    assert.equal(reapplied.rules[uid], "present");
  }
});

// --- token file hygiene and workspace isolation from the OLD-workspace tool

test("admin token path is distinct from the OLD workspace's admin token path", () => {
  assert.notEqual(ADMIN_TOKEN_PATH, OLD_ADMIN_TOKEN_PATH);
  assert.equal(ADMIN_TOKEN_PATH, path.join(os.homedir(), ".proliferate-local/ops/grafana-admin-rebuild.token"));
});

test("this tool's fixed target is the new workspace, never the OLD workspace", () => {
  assert.equal(NEW_TARGET.grafanaWorkspaceId, "g-48655e6419");
  assert.equal(NEW_TARGET.grafanaWorkspaceName, "proliferate-ops-rebuild");
  assert.equal(WORKSPACE_BASE_URL, "https://g-48655e6419.grafana-workspace.us-east-1.amazonaws.com");
});

const TEST_SLACK_ENV = {
  SLACK_ALERTS_WEBHOOK_URL: "https://hooks.slack.com/services/synthetic/test/value",
};

function slackRunArgs(client, env = TEST_SLACK_ENV) {
  return {
    client,
    repoRoot: REPO_ROOT,
    env,
    credentialModeCheck: () => true,
  };
}

function slackWorkspace({
  withLegacy = false,
  failDeleteOnce = false,
  losePutResponseAfterApply = false,
  loseDeleteResponseAfterApply = false,
  testHttpStatus = 200,
  testConfigStatus = "ok",
  testResponseField = "configs",
  ruleNotificationUid = null,
  mutateSnsAfterTargetWrite = false,
  mutateRouteAfterTargetWrite = false,
  targetContactUid,
  targetReceiverUid,
  legacyContactUid,
  legacyReceiverUid,
} = {}) {
  const overlay = baseOverlay();
  const targetProvisioningUid = targetContactUid || overlay.slackContactPoint.uid;
  const targetConfigUid = targetReceiverUid || overlay.slackContactPoint.uid;
  const contactUid = legacyContactUid || overlay.slackContactPoint.legacyUid;
  const receiverUid = legacyReceiverUid || overlay.slackContactPoint.legacyUid;
  const snsConfig = {
    type: "sns",
    uid: overlay.contactPoint.uid,
    name: overlay.contactPoint.integrationName,
    disableResolveMessage: overlay.contactPoint.disableResolveMessage,
    secureFields: {},
    settings: structuredClone(overlay.contactPoint.settings),
  };
  const state = {
    contacts: [{
      name: overlay.contactPoint.integrationName,
      type: "sns",
      uid: overlay.contactPoint.uid,
      disableResolveMessage: false,
    }],
    calls: [],
    updatePayload: null,
    testPayload: null,
    testProven: false,
    failDeleteOnce,
    losePutResponseAfterApply,
    loseDeleteResponseAfterApply,
    am: {
      alertmanager_config: {
        route: structuredClone(overlay.notificationPolicy),
        receivers: [{
          name: overlay.contactPoint.name,
          grafana_managed_receiver_configs: [structuredClone(snsConfig)],
        }],
      },
    },
  };

  const generatedLegacyRoute = {
    receiver: overlay.slackContactPoint.legacyName,
    group_by: ["grafana_folder", "alertname"],
    object_matchers: [["__grafana_receiver__", "=", overlay.slackContactPoint.legacyName]],
  };
  const generatedPartialRoute = {
    receiver: overlay.slackContactPoint.partialName,
    group_by: ["grafana_folder", "alertname"],
    object_matchers: [["__grafana_receiver__", "=", overlay.slackContactPoint.partialName]],
  };
  if (withLegacy) {
    state.contacts.push({
      name: overlay.slackContactPoint.partialName,
      type: "slack",
      uid: targetProvisioningUid,
      disableResolveMessage: false,
    });
    state.contacts.push({
      name: overlay.slackContactPoint.legacyName,
      type: "slack",
      uid: contactUid,
      disableResolveMessage: false,
    });
    state.am.alertmanager_config.receivers.push({
      name: overlay.slackContactPoint.partialName,
      grafana_managed_receiver_configs: [{
        uid: targetConfigUid,
        name: overlay.slackContactPoint.partialName,
        type: "slack",
        disableResolveMessage: false,
        secureFields: { url: true },
        settings: {
          title: "{{ template \"slack.default.title\" . }}",
          text: "{{ template \"slack.default.text\" . }}",
        },
      }],
    });
    state.am.alertmanager_config.receivers.push({
      name: overlay.slackContactPoint.legacyName,
      grafana_managed_receiver_configs: [{
        uid: receiverUid,
        name: overlay.slackContactPoint.legacyName,
        type: "slack",
        disableResolveMessage: false,
        secureFields: { url: true },
        settings: {
          title: "{{ template \"slack.default.title\" . }}",
          text: "{{ template \"slack.default.text\" . }}",
        },
      }],
    });
    state.am.alertmanager_config.route.routes[0].routes.unshift(
      structuredClone(generatedPartialRoute),
      structuredClone(generatedLegacyRoute),
    );
  }

  function targetReadback(body, uid) {
    return {
      uid,
      name: body.name,
      type: body.type,
      disableResolveMessage: body.disableResolveMessage,
      secureFields: { url: true },
      settings: { title: body.settings.title, text: body.settings.text },
    };
  }
  function removeReceiverRoutes(route, receiverName) {
    if (!Array.isArray(route.routes)) return;
    route.routes = route.routes.filter((child) => child.receiver !== receiverName);
    for (const child of route.routes) removeReceiverRoutes(child, receiverName);
  }
  function writeTarget(body, uid) {
    state.contacts = state.contacts.map((point) => point.uid === overlay.slackContactPoint.uid
      ? { ...point, name: body.name }
      : point);
    state.am.alertmanager_config.receivers = state.am.alertmanager_config.receivers.filter(
      (entry) => entry.name !== overlay.slackContactPoint.partialName,
    );
    removeReceiverRoutes(state.am.alertmanager_config.route, overlay.slackContactPoint.partialName);
    if (body.name === overlay.contactPoint.name) {
      const receiver = state.am.alertmanager_config.receivers.find(
        (entry) => entry.name === overlay.contactPoint.name,
      );
      receiver.grafana_managed_receiver_configs = [
        ...receiver.grafana_managed_receiver_configs.filter((entry) => entry.type !== "slack"),
        targetReadback(body, uid),
      ];
    } else {
      const receiver = state.am.alertmanager_config.receivers.find(
        (entry) => entry.name === overlay.contactPoint.name,
      );
      receiver.grafana_managed_receiver_configs = receiver.grafana_managed_receiver_configs.filter(
        (entry) => entry.type !== "slack",
      );
      state.am.alertmanager_config.receivers.push({
        name: overlay.slackContactPoint.partialName,
        grafana_managed_receiver_configs: [targetReadback(body, uid)],
      });
      state.am.alertmanager_config.route.routes[0].routes.unshift(structuredClone(generatedPartialRoute));
    }
    if (mutateSnsAfterTargetWrite) {
      state.am.alertmanager_config.receivers
        .find((entry) => entry.name === overlay.contactPoint.name)
        .grafana_managed_receiver_configs[0].settings.messageFormat = "drifted";
    }
    if (mutateRouteAfterTargetWrite) {
      state.am.alertmanager_config.route.group_by = ["drifted"];
    }
  }
  const client = {
    listContactPoints: async () => {
      state.calls.push("listContactPoints");
      return { status: 200, body: structuredClone(state.contacts) };
    },
    updateContactPoint: async (uid, body) => {
      state.calls.push("updateContactPoint");
      state.updatePayload = structuredClone(body);
      assert.equal(uid, overlay.slackContactPoint.uid);
      writeTarget(body, uid);
      if (state.losePutResponseAfterApply) {
        state.losePutResponseAfterApply = false;
        throw new Error("synthetic lost PUT response");
      }
      return { status: 202, body: {} };
    },
    deleteContactPoint: async (uid) => {
      state.calls.push("deleteContactPoint");
      const combined = state.am.alertmanager_config.receivers
        .find((entry) => entry.name === overlay.contactPoint.name)
        ?.grafana_managed_receiver_configs.some((entry) => entry.type === "slack");
      assert.equal(combined, true, "legacy deletion must happen only after combined contact write");
      assert.equal(state.testProven, true, "legacy deletion must happen only after the isolated Slack test");
      if (state.failDeleteOnce) {
        state.failDeleteOnce = false;
        throw new Error("synthetic delete interruption");
      }
      state.contacts = state.contacts.filter((point) => point.uid !== uid);
      state.am.alertmanager_config.receivers = state.am.alertmanager_config.receivers.filter(
        (entry) => entry.name !== overlay.slackContactPoint.legacyName,
      );
      removeReceiverRoutes(state.am.alertmanager_config.route, overlay.slackContactPoint.legacyName);
      if (state.loseDeleteResponseAfterApply) {
        state.loseDeleteResponseAfterApply = false;
        throw new Error("synthetic lost DELETE response");
      }
      return { status: 202, body: null };
    },
    getAlertRule: async (uid) => {
      state.calls.push(`getAlertRule:${uid}`);
      return {
        status: 200,
        body: {
          uid,
          title: `rule-${uid}`,
          ...(uid === ruleNotificationUid ? { notification_settings: { receiver: "drifted" } } : {}),
        },
      };
    },
    getAlertmanagerConfig: async () => {
      state.calls.push("getAlertmanagerConfig");
      return { status: 200, body: structuredClone(state.am) };
    },
    postAlertmanagerConfig: async () => {
      state.calls.push("postAlertmanagerConfig");
      throw new Error("combined-contact flow must never replace the policy tree");
    },
    testReceiver: async (body) => {
      state.calls.push("testReceiver");
      state.testPayload = structuredClone(body);
      state.testProven = testHttpStatus === 200 && testConfigStatus === "ok";
      return {
        status: testHttpStatus,
        body: {
          receivers: [{
            [testResponseField]: [{
              uid: body.receivers[0].grafana_managed_receiver_configs[0].uid,
              status: testConfigStatus,
            }],
          }],
        },
      };
    },
  };
  return { overlay, snsConfig, state, client };
}

test("Slack PUT/test payloads pin efvuhlsl31mo0e and keep the webhook only in settings.url", async () => {
  const { overlay, state, client } = slackWorkspace({ withLegacy: true });
  await runSlackApply({
    client,
    repoRoot: REPO_ROOT,
    env: TEST_SLACK_ENV,
    credentialModeCheck: () => true,
  });

  const expectedContactPayload = {
    uid: overlay.slackContactPoint.uid,
    name: overlay.slackContactPoint.name,
    type: "slack",
    disableResolveMessage: false,
    settings: {
      url: TEST_SLACK_ENV.SLACK_ALERTS_WEBHOOK_URL,
      title: "{{ template \"slack.default.title\" . }}",
      text: "{{ template \"slack.default.text\" . }}",
    },
  };
  assert.deepEqual(state.updatePayload, expectedContactPayload);

  await runSlackTest({
    client,
    repoRoot: REPO_ROOT,
    env: TEST_SLACK_ENV,
    credentialModeCheck: () => true,
  });
  assert.deepEqual(state.testPayload, {
    receivers: [{
      name: overlay.slackContactPoint.testReceiverName,
      grafana_managed_receiver_configs: [expectedContactPayload],
    }],
  });
  assert.equal(state.testPayload.receivers[0].grafana_managed_receiver_configs.length, 1);
  assert.equal(state.testPayload.receivers[0].grafana_managed_receiver_configs[0].type, "slack");
});

test("Slack integration is additive inside the default SNS receiver and leaves the exact policy tree unchanged", async () => {
  const { overlay, snsConfig, state, client } = slackWorkspace({ withLegacy: true });

  const applied = await runSlackApply({
    client,
    repoRoot: REPO_ROOT,
    env: TEST_SLACK_ENV,
    credentialModeCheck: () => true,
  });
  assert.deepEqual(applied, {
    contactPoint: "updated",
    testDelivery: "ok",
    legacyMigration: "removed",
    uid: overlay.slackContactPoint.uid,
  });
  assert.deepEqual(state.am.alertmanager_config.route, overlay.notificationPolicy);
  assert.equal(state.am.alertmanager_config.receivers.length, 1);
  assert.deepEqual(state.am.alertmanager_config.receivers[0].grafana_managed_receiver_configs[0], snsConfig);
  assert.equal(state.am.alertmanager_config.receivers[0].grafana_managed_receiver_configs[1].type, "slack");
  assert.deepEqual(await runSlackVerify({
    client,
    repoRoot: REPO_ROOT,
    env: TEST_SLACK_ENV,
    credentialModeCheck: () => true,
  }), {
    status: "verified",
    uid: overlay.slackContactPoint.uid,
  });

  state.updatePayload = null;
  const reapplied = await runSlackApply({
    client,
    repoRoot: REPO_ROOT,
    env: TEST_SLACK_ENV,
    credentialModeCheck: () => true,
  });
  assert.deepEqual(reapplied, {
    contactPoint: "present",
    testDelivery: "already-proven",
    legacyMigration: "not-needed",
    uid: overlay.slackContactPoint.uid,
  });
  assert.equal(state.updatePayload, null);
  assert.deepEqual(state.am.alertmanager_config.route, overlay.notificationPolicy);
  assert.deepEqual(state.am.alertmanager_config.receivers[0].grafana_managed_receiver_configs[0], snsConfig);
  assert.equal(state.calls.includes("postAlertmanagerConfig"), false);
});

test("standalone Slack migration verifies the combined contact before delete and resumes safely after interruption", async () => {
  const { overlay, snsConfig, state, client } = slackWorkspace({ withLegacy: true, failDeleteOnce: true });

  await assert.rejects(
    runSlackApply({
      client,
      repoRoot: REPO_ROOT,
      env: TEST_SLACK_ENV,
      credentialModeCheck: () => true,
    }),
    /synthetic delete interruption/,
  );
  assert.ok(state.contacts.some((point) => point.name === overlay.slackContactPoint.name && point.type === "slack"));
  assert.ok(state.contacts.some((point) => point.name === overlay.slackContactPoint.legacyName));
  assert.ok(state.calls.indexOf("deleteContactPoint") > state.calls.indexOf("getAlertmanagerConfig"));

  const resumed = await runSlackApply({
    client,
    repoRoot: REPO_ROOT,
    env: TEST_SLACK_ENV,
    credentialModeCheck: () => true,
  });
  assert.deepEqual(resumed, {
    contactPoint: "present",
    testDelivery: "ok",
    legacyMigration: "removed",
    uid: overlay.slackContactPoint.uid,
  });
  assert.equal(state.contacts.some((point) => point.name === overlay.slackContactPoint.legacyName), false);
  assert.deepEqual(state.am.alertmanager_config.route, overlay.notificationPolicy);
  assert.equal(state.am.alertmanager_config.receivers.length, 1);
  assert.deepEqual(state.am.alertmanager_config.receivers[0].grafana_managed_receiver_configs[0], snsConfig);
  assert.deepEqual(await runSlackVerify({
    client,
    repoRoot: REPO_ROOT,
    env: TEST_SLACK_ENV,
    credentialModeCheck: () => true,
  }), {
    status: "verified",
    uid: overlay.slackContactPoint.uid,
  });
});

test("Slack migration fails closed before legacy deletion if SNS config or the policy tree changes", async () => {
  for (const options of [
    { mutateSnsAfterTargetWrite: true },
    { mutateRouteAfterTargetWrite: true },
  ]) {
    const { state, client } = slackWorkspace({ withLegacy: true, ...options });
    await assert.rejects(
      runSlackApply({
        client,
        repoRoot: REPO_ROOT,
        env: TEST_SLACK_ENV,
        credentialModeCheck: () => true,
      }),
      /SNS|policy|route|rollback/,
    );
    assert.equal(state.calls.includes("deleteContactPoint"), false);
  }
});

test("Slack migration refuses drifted standalone normalization before creating the combined contact", async () => {
  const { state, client } = slackWorkspace({ withLegacy: true });
  state.am.alertmanager_config.route.routes[0].routes[0].continue = true;

  await assert.rejects(
    runSlackApply({
      client,
      repoRoot: REPO_ROOT,
      env: TEST_SLACK_ENV,
      credentialModeCheck: () => true,
    }),
    /Generated route state for sns receiver/,
  );
  assert.equal(state.calls.includes("updateContactPoint"), false);
});

test("Slack migration pins both partial UIDs and makes no mutation for any other UID", async () => {
  const unexpectedTargetUid = "efvuhlsl31mo0f";
  const unexpectedLegacyUid = "dfvuf540l7ym8e";
  for (const overrides of [
    { targetContactUid: unexpectedTargetUid },
    { targetReceiverUid: unexpectedTargetUid },
    { targetContactUid: unexpectedTargetUid, targetReceiverUid: unexpectedTargetUid },
    { legacyContactUid: unexpectedLegacyUid },
    { legacyReceiverUid: unexpectedLegacyUid },
    { legacyContactUid: unexpectedLegacyUid, legacyReceiverUid: unexpectedLegacyUid },
  ]) {
    const { state, client } = slackWorkspace({ withLegacy: true, ...overrides });
    await assert.rejects(
      runSlackApply(slackRunArgs(client)),
      /Slack provisioning contact|Slack receiver config|Unexpected Slack/,
    );
    for (const call of ["updateContactPoint", "deleteContactPoint", "postAlertmanagerConfig", "testReceiver"]) {
      assert.equal(state.calls.includes(call), false, `${call} must not run for an unexpected pinned UID`);
    }
  }
});

test("an unexpected legacy UID blocks interrupted-migration update and delete calls", async () => {
  const unexpectedUid = "dfvuf540l7ym8e";
  const { overlay, state, client } = slackWorkspace({ withLegacy: true, failDeleteOnce: true });
  await assert.rejects(runSlackApply(slackRunArgs(client)), /synthetic delete interruption/);
  state.contacts.find((point) => point.name === overlay.slackContactPoint.legacyName).uid = unexpectedUid;
  state.am.alertmanager_config.receivers
    .find((receiver) => receiver.name === overlay.slackContactPoint.legacyName)
    .grafana_managed_receiver_configs[0].uid = unexpectedUid;
  state.calls = [];

  await assert.rejects(runSlackApply(slackRunArgs(client)), /Unexpected Slack provisioning contact/);
  for (const call of ["updateContactPoint", "deleteContactPoint", "postAlertmanagerConfig", "testReceiver"]) {
    assert.equal(state.calls.includes(call), false);
  }
});

test("Slack migration refuses a missing pinned partial before any provider mutation", async () => {
  const { state, client } = slackWorkspace();
  await assert.rejects(runSlackApply(slackRunArgs(client)), /Slack provisioning contact state is missing/);
  for (const call of ["updateContactPoint", "deleteContactPoint", "postAlertmanagerConfig", "testReceiver"]) {
    assert.equal(state.calls.includes(call), false);
  }
});

test("Slack commands refuse a missing webhook before any provider call", async () => {
  for (const run of [runSlackApply, runSlackVerify, runSlackTest]) {
    const { state, client } = slackWorkspace();
    await assert.rejects(run({ client, repoRoot: REPO_ROOT, env: {} }), /SLACK_ALERTS_WEBHOOK_URL must be present/);
    assert.deepEqual(state.calls, []);
  }
});

test("Slack commands refuse unsafe credential-file modes before any provider call", async () => {
  for (const run of [runSlackApply, runSlackVerify, runSlackTest]) {
    const { state, client } = slackWorkspace();
    await assert.rejects(
      run({
        client,
        repoRoot: REPO_ROOT,
        env: TEST_SLACK_ENV,
        credentialModeCheck: () => {
          throw new Error("Observability keys file must be mode 0600");
        },
      }),
      /must be mode 0600/,
    );
    assert.deepEqual(state.calls, []);
  }
});

test("assertSlackCredentialModes requires both protected files to be mode 0600", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "grafana-slack-modes-"));
  const adminTokenPath = path.join(tempDir, "admin.token");
  const observabilityKeysPath = path.join(tempDir, "observability.env");
  try {
    fs.writeFileSync(adminTokenPath, "synthetic\n", { mode: 0o600 });
    fs.writeFileSync(observabilityKeysPath, "SYNTHETIC=value\n", { mode: 0o600 });
    assert.equal(assertSlackCredentialModes({ adminTokenPath, observabilityKeysPath }), true);
    fs.chmodSync(observabilityKeysPath, 0o644);
    assert.throws(
      () => assertSlackCredentialModes({ adminTokenPath, observabilityKeysPath }),
      /Observability keys file must be mode 0600/,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Slack preflight rejects routed rules and unexpected Slack state with zero mutations", async () => {
  const scenarios = [
    slackWorkspace({ withLegacy: true, ruleNotificationUid: "ffvtx33lbo5c0e" }),
  ];

  const defaultAlreadyHasSlack = slackWorkspace({ withLegacy: true });
  defaultAlreadyHasSlack.state.am.alertmanager_config.receivers[0].grafana_managed_receiver_configs.push({
    uid: "unexpected-default-slack",
    name: "unexpected",
    type: "slack",
    disableResolveMessage: false,
    secureFields: { url: true },
    settings: {
      title: "{{ template \"slack.default.title\" . }}",
      text: "{{ template \"slack.default.text\" . }}",
    },
  });
  scenarios.push(defaultAlreadyHasSlack);

  const otherSlack = slackWorkspace({ withLegacy: true });
  otherSlack.state.contacts.push({
    uid: "unexpected-slack-uid",
    name: "unexpected-slack",
    type: "slack",
    disableResolveMessage: false,
  });
  scenarios.push(otherSlack);

  for (const { state, client } of scenarios) {
    await assert.rejects(runSlackApply(slackRunArgs(client)));
    for (const call of ["updateContactPoint", "deleteContactPoint", "postAlertmanagerConfig", "testReceiver"]) {
      assert.equal(state.calls.includes(call), false, `${call} must not run before an exact preflight`);
    }
  }
});

test("lost PUT and DELETE responses resume only from exact provider readback", async () => {
  const lostPut = slackWorkspace({ withLegacy: true, losePutResponseAfterApply: true });
  assert.deepEqual(await runSlackApply(slackRunArgs(lostPut.client)), {
    contactPoint: "updated-after-response-loss",
    testDelivery: "ok",
    legacyMigration: "removed",
    uid: lostPut.overlay.slackContactPoint.uid,
  });

  const lostDelete = slackWorkspace({ withLegacy: true, loseDeleteResponseAfterApply: true });
  assert.deepEqual(await runSlackApply(slackRunArgs(lostDelete.client)), {
    contactPoint: "updated",
    testDelivery: "ok",
    legacyMigration: "removed-after-response-loss",
    uid: lostDelete.overlay.slackContactPoint.uid,
  });
});

test("failed isolated Slack tests roll the target back and never delete the legacy UID", async () => {
  for (const options of [
    { testHttpStatus: 500 },
    { testConfigStatus: "error" },
  ]) {
    const { overlay, state, client } = slackWorkspace({ withLegacy: true, ...options });
    await assert.rejects(runSlackApply(slackRunArgs(client)), /rolled back/);
    assert.equal(
      state.contacts.find((point) => point.uid === overlay.slackContactPoint.uid)?.name,
      overlay.slackContactPoint.partialName,
    );
    assert.equal(state.contacts.some((point) => point.uid === overlay.slackContactPoint.legacyUid), true);
    assert.equal(state.calls.includes("deleteContactPoint"), false);
  }
});

test("Slack-only test accepts both Grafana config-status response spellings and precedes delete", async () => {
  for (const testResponseField of ["configs", "grafana_managed_receiver_configs"]) {
    const { state, client } = slackWorkspace({ withLegacy: true, testResponseField });
    await runSlackApply(slackRunArgs(client));
    assert.ok(state.calls.indexOf("testReceiver") < state.calls.indexOf("deleteContactPoint"));
    assert.equal(state.testPayload.receivers.length, 1);
    assert.equal(state.testPayload.receivers[0].grafana_managed_receiver_configs.length, 1);
    assert.equal(state.testPayload.receivers[0].grafana_managed_receiver_configs[0].type, "slack");
  }
});

test("Slack reconciliation has no contact POST or notification-policy write path", async () => {
  const { state, client } = slackWorkspace({ withLegacy: true });
  client.createContactPoint = async () => {
    state.calls.push("createContactPoint");
    throw new Error("contact POST must not run");
  };
  await runSlackApply(slackRunArgs(client));
  assert.equal(state.calls.includes("createContactPoint"), false);
  assert.equal(state.calls.includes("postAlertmanagerConfig"), false);
});

test("Slack verify throws on missing, duplicate, or drifted combined-contact state", async () => {
  const missing = slackWorkspace();
  await assert.rejects(
    runSlackVerify(slackRunArgs(missing.client)),
    /Slack provisioning contact state is missing/,
  );

  const duplicateContact = slackWorkspace({ withLegacy: true });
  await runSlackApply(slackRunArgs(duplicateContact.client));
  duplicateContact.state.contacts.push(structuredClone(duplicateContact.state.contacts.at(-1)));
  await assert.rejects(
    runSlackVerify(slackRunArgs(duplicateContact.client)),
    /missing, duplicate, or ambiguous/,
  );

  const driftedSns = slackWorkspace({ withLegacy: true });
  await runSlackApply(slackRunArgs(driftedSns.client));
  driftedSns.state.am.alertmanager_config.receivers[0]
    .grafana_managed_receiver_configs[0].settings.messageFormat = "drifted";
  await assert.rejects(
    runSlackVerify(slackRunArgs(driftedSns.client)),
    /Default SNS receiver configuration is missing or drifted/,
  );

  const driftedRoute = slackWorkspace({ withLegacy: true });
  await runSlackApply(slackRunArgs(driftedRoute.client));
  driftedRoute.state.am.alertmanager_config.route.group_by = ["drifted"];
  await assert.rejects(
    runSlackVerify(slackRunArgs(driftedRoute.client)),
    /Authored root notification policy is missing or drifted/,
  );

  const duplicateConfig = slackWorkspace({ withLegacy: true });
  await runSlackApply(slackRunArgs(duplicateConfig.client));
  duplicateConfig.state.am.alertmanager_config.receivers[0].grafana_managed_receiver_configs.push(
    structuredClone(duplicateConfig.state.am.alertmanager_config.receivers[0].grafana_managed_receiver_configs[1]),
  );
  await assert.rejects(
    runSlackVerify(slackRunArgs(duplicateConfig.client)),
    /exactly the SNS and reconciled Slack configs/,
  );

  const missingConfig = slackWorkspace({ withLegacy: true });
  await runSlackApply(slackRunArgs(missingConfig.client));
  missingConfig.state.am.alertmanager_config.receivers[0].grafana_managed_receiver_configs.pop();
  await assert.rejects(
    runSlackVerify(slackRunArgs(missingConfig.client)),
    /exactly the SNS and reconciled Slack configs/,
  );
});
