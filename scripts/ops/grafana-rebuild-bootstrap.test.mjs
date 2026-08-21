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
  WORKSPACE_BASE_URL,
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

function slackWorkspace({ dropSnsReceiverOnRouteWrite = false, dropExistingRoutesOnRouteWrite = false } = {}) {
  const overlay = baseOverlay();
  const originalRoutes = [
    {
      receiver: overlay.notificationPolicy.receiver,
      object_matchers: [["__grafana_autogenerated__", "=", "true"]],
      routes: [{
        receiver: overlay.notificationPolicy.receiver,
        group_by: ["grafana_folder", "alertname"],
        object_matchers: [["__grafana_receiver__", "=", overlay.notificationPolicy.receiver]],
      }],
    },
    { receiver: "pre-existing-triage", matchers: [["severity", "=", "warning"]], continue: true },
  ];
  const snsReceiver = {
    name: overlay.contactPoint.name,
    grafana_managed_receiver_configs: [{
      type: "sns",
      uid: "sns-uid",
      settings: structuredClone(overlay.contactPoint.settings),
    }],
  };
  const state = {
    contacts: [],
    calls: [],
    createPayload: null,
    updatePayload: null,
    testPayload: null,
    am: {
      alertmanager_config: {
        route: { receiver: overlay.notificationPolicy.receiver, routes: structuredClone(originalRoutes) },
        receivers: [structuredClone(snsReceiver)],
      },
    },
  };
  const client = {
    listContactPoints: async () => {
      state.calls.push("listContactPoints");
      return { status: 200, body: structuredClone(state.contacts) };
    },
    createContactPoint: async (body) => {
      state.calls.push("createContactPoint");
      state.createPayload = structuredClone(body);
      state.contacts.push({ name: body.name, type: body.type, uid: "slack-uid" });
      state.am.alertmanager_config.receivers.push({
        name: body.name,
        grafana_managed_receiver_configs: [{ ...structuredClone(body), uid: "slack-uid" }],
      });
      return { status: 201, body: {} };
    },
    updateContactPoint: async (uid, body) => {
      state.calls.push("updateContactPoint");
      state.updatePayload = structuredClone(body);
      const receiver = state.am.alertmanager_config.receivers.find((entry) => entry.name === body.name);
      receiver.grafana_managed_receiver_configs = [{ ...structuredClone(body), uid }];
      return { status: 202, body: {} };
    },
    getAlertmanagerConfig: async () => {
      state.calls.push("getAlertmanagerConfig");
      return { status: 200, body: structuredClone(state.am) };
    },
    postAlertmanagerConfig: async (body) => {
      state.calls.push("postAlertmanagerConfig");
      state.am = structuredClone(body);
      if (dropSnsReceiverOnRouteWrite) {
        state.am.alertmanager_config.receivers = state.am.alertmanager_config.receivers.filter(
          (entry) => entry.name !== overlay.contactPoint.name,
        );
      }
      if (dropExistingRoutesOnRouteWrite) {
        state.am.alertmanager_config.route.routes = state.am.alertmanager_config.route.routes.slice(0, 1);
      }
      return { status: 202, body: {} };
    },
    testReceiver: async (body) => {
      state.calls.push("testReceiver");
      state.testPayload = structuredClone(body);
      return {
        status: 200,
        body: {
          receivers: [{
            configs: [{ uid: body.receivers[0].grafana_managed_receiver_configs[0].uid, status: "ok" }],
          }],
        },
      };
    },
  };
  return { overlay, originalRoutes, snsReceiver, state, client };
}

test("Slack create/test payloads put the webhook only in settings.url", async () => {
  const { overlay, state, client } = slackWorkspace();
  await runSlackApply({ client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV });

  const expectedContactPayload = {
    name: overlay.slackContactPoint.name,
    type: "slack",
    disableResolveMessage: false,
    settings: {
      url: TEST_SLACK_ENV.SLACK_ALERTS_WEBHOOK_URL,
      title: "{{ template \"slack.default.title\" . }}",
      text: "{{ template \"slack.default.text\" . }}",
    },
  };
  assert.deepEqual(state.createPayload, expectedContactPayload);

  await runSlackTest({ client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV });
  assert.deepEqual(state.testPayload, {
    receivers: [{
      name: overlay.slackContactPoint.name,
      grafana_managed_receiver_configs: [{ uid: "slack-uid", ...expectedContactPayload }],
    }],
  });
});

test("Slack receiver is additive and preserves the exact SNS receiver and every existing route", async () => {
  const { overlay, originalRoutes, snsReceiver, state, client } = slackWorkspace();

  const applied = await runSlackApply({ client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV });
  assert.deepEqual(applied, { contactPoint: "created", route: "created", uid: "slack-uid" });
  assert.equal(state.am.alertmanager_config.route.receiver, overlay.notificationPolicy.receiver);
  assert.deepEqual(state.am.alertmanager_config.route.routes.slice(1), originalRoutes);
  assert.deepEqual(state.am.alertmanager_config.receivers[0], snsReceiver);
  assert.deepEqual(state.am.alertmanager_config.route.routes[0], {
    object_matchers: [["__grafana_autogenerated__", "=", "true"]],
    receiver: overlay.slackContactPoint.name,
    continue: true,
  });

  state.am.alertmanager_config.route.routes[0] = {
    matchers: [],
    object_matchers: [["__grafana_autogenerated__", "=", "true"]],
    continue: true,
    routes: [],
    receiver: overlay.slackContactPoint.name,
  };
  assert.deepEqual(await runSlackVerify({ client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV }), {
    status: "verified",
  });

  const reapplied = await runSlackApply({ client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV });
  assert.deepEqual(reapplied, { contactPoint: "updated", route: "present", uid: "slack-uid" });
  assert.equal(state.updatePayload.settings.url, TEST_SLACK_ENV.SLACK_ALERTS_WEBHOOK_URL);
  assert.equal(Object.hasOwn(state.updatePayload, "secureSettings"), false);
  assert.deepEqual(state.am.alertmanager_config.route.routes.slice(1), originalRoutes);
  assert.deepEqual(state.am.alertmanager_config.receivers[0], snsReceiver);
});

test("Slack route write fails closed if Grafana loses SNS config or any existing child route", async () => {
  for (const options of [
    { dropSnsReceiverOnRouteWrite: true },
    { dropExistingRoutesOnRouteWrite: true },
  ]) {
    const { client } = slackWorkspace(options);
    await assert.rejects(
      runSlackApply({ client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV }),
      /SNS receiver|non-Slack child route|delivery child route/,
    );
  }
});

test("Slack apply refuses an ambiguous SNS delivery child before any mutation", async () => {
  const { overlay, state, client } = slackWorkspace();
  state.am.alertmanager_config.route.routes.push({
    receiver: overlay.notificationPolicy.receiver,
    object_matchers: [["severity", "=", "critical"]],
  });

  await assert.rejects(
    runSlackApply({ client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV }),
    /SNS delivery child route is missing or ambiguous/,
  );
  assert.equal(state.calls.includes("createContactPoint"), false);
  assert.equal(state.calls.includes("postAlertmanagerConfig"), false);
});

test("Slack commands refuse a missing webhook before any provider call", async () => {
  for (const run of [runSlackApply, runSlackVerify, runSlackTest]) {
    const { state, client } = slackWorkspace();
    await assert.rejects(run({ client, repoRoot: REPO_ROOT, env: {} }), /SLACK_ALERTS_WEBHOOK_URL must be present/);
    assert.deepEqual(state.calls, []);
  }
});

test("Slack verify throws on missing, duplicate, or drifted receiver and route state", async () => {
  const missing = slackWorkspace();
  await assert.rejects(
    runSlackVerify({ client: missing.client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV }),
    /contact point is missing/,
  );

  const duplicateContact = slackWorkspace();
  await runSlackApply({ client: duplicateContact.client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV });
  duplicateContact.state.contacts.push(structuredClone(duplicateContact.state.contacts[0]));
  await assert.rejects(
    runSlackVerify({ client: duplicateContact.client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV }),
    /multiple contact points/,
  );

  const driftedRoute = slackWorkspace();
  await runSlackApply({ client: driftedRoute.client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV });
  driftedRoute.state.am.alertmanager_config.route.routes[0].continue = false;
  await assert.rejects(
    runSlackVerify({ client: driftedRoute.client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV }),
    /route is missing, ambiguous, or drifted/,
  );

  const driftedMatcher = slackWorkspace();
  await runSlackApply({ client: driftedMatcher.client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV });
  driftedMatcher.state.am.alertmanager_config.route.routes[0].object_matchers[0][2] = "false";
  await assert.rejects(
    runSlackVerify({ client: driftedMatcher.client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV }),
    /route is missing, ambiguous, or drifted/,
  );

  const duplicateReceiver = slackWorkspace();
  await runSlackApply({ client: duplicateReceiver.client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV });
  duplicateReceiver.state.am.alertmanager_config.receivers.push(
    structuredClone(duplicateReceiver.state.am.alertmanager_config.receivers.at(-1)),
  );
  await assert.rejects(
    runSlackVerify({ client: duplicateReceiver.client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV }),
    /receiver is missing or ambiguous/,
  );

  const missingReceiver = slackWorkspace();
  await runSlackApply({ client: missingReceiver.client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV });
  missingReceiver.state.am.alertmanager_config.receivers.pop();
  await assert.rejects(
    runSlackVerify({ client: missingReceiver.client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV }),
    /receiver is missing or ambiguous/,
  );

  const duplicateRoute = slackWorkspace();
  await runSlackApply({ client: duplicateRoute.client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV });
  duplicateRoute.state.am.alertmanager_config.route.routes.unshift(
    structuredClone(duplicateRoute.state.am.alertmanager_config.route.routes[0]),
  );
  await assert.rejects(
    runSlackVerify({ client: duplicateRoute.client, repoRoot: REPO_ROOT, env: TEST_SLACK_ENV }),
    /route is missing, ambiguous, or drifted/,
  );
});
