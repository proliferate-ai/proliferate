import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cleanupSharedTemplateProviderResources,
  resolveSharedTemplateIntentName,
  type SharedTemplateProviderCleanupDeps,
  type SharedTemplateProviderCleanupPolicy,
} from "./shared-template-provider-cleanup.js";

const TEMPLATE_ID = "tpl_exact_1";
const TEMPLATE_NAME = "proliferate-qualification-run-1";
const POLICY: SharedTemplateProviderCleanupPolicy = {
  sandboxAbsence: { timeoutMs: 100, intervalMs: 25 },
  templateAbsence: { timeoutMs: 100, intervalMs: 25 },
};

function fakeClock(): {
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  elapsed: () => number;
} {
  let time = 0;
  return {
    now: () => time,
    sleep: async (milliseconds) => {
      time += milliseconds;
    },
    elapsed: () => time,
  };
}

function baseDeps(
  overrides: Partial<SharedTemplateProviderCleanupDeps> = {},
): SharedTemplateProviderCleanupDeps {
  const clock = fakeClock();
  return {
    listSandboxes: async () => ({ matches: [], count: 0 }),
    killSandbox: async () => ({ killed: true }),
    deleteTemplate: async () => undefined,
    listTemplates: async () => [],
    now: clock.now,
    sleep: clock.sleep,
    ...overrides,
  };
}

test("cleanup kills every exact-template sandbox, proves zero, then deletes and proves absence", async () => {
  const calls: string[] = [];
  let sandboxPoll = 0;
  let templatePoll = 0;
  const deps = baseDeps({
    async listSandboxes(templateId) {
      calls.push(`list-sandboxes:${templateId}`);
      sandboxPoll += 1;
      return sandboxPoll === 1
        ? {
            matches: [
              { providerSandboxId: "sbx_2", state: "paused", templateId },
              { providerSandboxId: "sbx_1", state: "running", templateId },
            ],
            count: 2,
          }
        : { matches: [], count: 0 };
    },
    async killSandbox(providerSandboxId) {
      calls.push(`kill:${providerSandboxId}`);
      return { killed: true };
    },
    async deleteTemplate(templateId) {
      calls.push(`delete:${templateId}`);
    },
    async listTemplates() {
      calls.push("list-templates");
      templatePoll += 1;
      return templatePoll === 1
        ? [{ templateId: TEMPLATE_ID, aliases: [TEMPLATE_NAME], names: [] }]
        : [];
    },
  });

  const result = await cleanupSharedTemplateProviderResources(TEMPLATE_ID, deps, POLICY);

  assert.deepEqual(result, {
    templateId: TEMPLATE_ID,
    killedSandboxIds: ["sbx_1", "sbx_2"],
    killAttempts: 2,
    sandboxInventoryPolls: 2,
    templateInventoryPolls: 2,
  });
  assert.deepEqual(calls, [
    `list-sandboxes:${TEMPLATE_ID}`,
    "kill:sbx_2",
    "kill:sbx_1",
    `list-sandboxes:${TEMPLATE_ID}`,
    "list-templates",
    `delete:${TEMPLATE_ID}`,
    "list-templates",
  ]);
});

test("cleanup treats exact provider absence as a crash-safe retry without deleting twice", async () => {
  let deleteCalls = 0;
  const result = await cleanupSharedTemplateProviderResources(
    TEMPLATE_ID,
    baseDeps({
      listTemplates: async () => [],
      deleteTemplate: async () => {
        deleteCalls += 1;
      },
    }),
    POLICY,
  );
  assert.equal(deleteCalls, 0);
  assert.equal(result.templateInventoryPolls, 1);
});

test("cleanup fails closed when a sandbox kill is not positively affirmed", async () => {
  let templateDeleted = false;
  const deps = baseDeps({
    listSandboxes: async () => ({
      matches: [{ providerSandboxId: "sbx_1", state: "running", templateId: TEMPLATE_ID }],
      count: 1,
    }),
    killSandbox: async () => ({ killed: false }),
    deleteTemplate: async () => {
      templateDeleted = true;
    },
  });

  await assert.rejects(
    () => cleanupSharedTemplateProviderResources(TEMPLATE_ID, deps, POLICY),
    /did not affirm that sandbox sbx_1 was killed/,
  );
  assert.equal(templateDeleted, false);
});

test("cleanup rejects malformed or ambiguously attributed sandbox inventory before mutation", async () => {
  let mutations = 0;
  const deps = baseDeps({
    listSandboxes: async () => ({
      matches: [{ providerSandboxId: "sbx_1", state: "running", templateId: "tpl_other" }],
      count: 1,
    }),
    killSandbox: async () => {
      mutations += 1;
      return { killed: true };
    },
    deleteTemplate: async () => {
      mutations += 1;
    },
  });

  await assert.rejects(
    () => cleanupSharedTemplateProviderResources(TEMPLATE_ID, deps, POLICY),
    /ambiguously attributed/,
  );
  assert.equal(mutations, 0);
});

test("cleanup preserves the template when sandbox inventory never converges to zero", async () => {
  let deleteCalls = 0;
  let killCalls = 0;
  const deps = baseDeps({
    listSandboxes: async () => ({
      matches: [{ providerSandboxId: "sbx_stuck", state: "paused", templateId: TEMPLATE_ID }],
      count: 1,
    }),
    killSandbox: async () => {
      killCalls += 1;
      return { killed: true };
    },
    deleteTemplate: async () => {
      deleteCalls += 1;
    },
  });

  await assert.rejects(
    () => cleanupSharedTemplateProviderResources(TEMPLATE_ID, deps, POLICY),
    /Timed out proving zero sandboxes/,
  );
  assert.equal(killCalls, 5);
  assert.equal(deleteCalls, 0);
});

test("cleanup fails closed when the deleted template remains in authoritative inventory", async () => {
  let deleteCalls = 0;
  const deps = baseDeps({
    deleteTemplate: async () => {
      deleteCalls += 1;
    },
    listTemplates: async () => [
      { templateId: TEMPLATE_ID, aliases: [TEMPLATE_NAME], names: [] },
    ],
  });

  await assert.rejects(
    () => cleanupSharedTemplateProviderResources(TEMPLATE_ID, deps, POLICY),
    /Timed out proving exact template .* absent/,
  );
  assert.equal(deleteCalls, 1);
});

test("cleanup rejects duplicate immutable ids in authoritative inventory", async () => {
  const deps = baseDeps({
    listTemplates: async () => [
      { templateId: TEMPLATE_ID, aliases: [], names: [] },
      { templateId: TEMPLATE_ID, aliases: [], names: [] },
    ],
  });

  await assert.rejects(
    () => cleanupSharedTemplateProviderResources(TEMPLATE_ID, deps, POLICY),
    /duplicate immutable id/,
  );
});

test("intent resolution observes the full window and returns null after no exact match", async () => {
  const clock = fakeClock();
  let polls = 0;
  const result = await resolveSharedTemplateIntentName(
    TEMPLATE_NAME,
    {
      listTemplates: async () => {
        polls += 1;
        return [{
          templateId: "tpl_unrelated",
          aliases: [`prefix-${TEMPLATE_NAME}`],
          names: [`team/prefix-${TEMPLATE_NAME}`],
        }];
      },
      now: clock.now,
      sleep: clock.sleep,
    },
    { timeoutMs: 100, intervalMs: 25 },
  );

  assert.equal(result, null);
  assert.equal(polls, 5);
  assert.equal(clock.elapsed(), 100);
});

test("intent resolution accepts the exact team-qualified name used by E2B inventory", async () => {
  const clock = fakeClock();
  const result = await resolveSharedTemplateIntentName(
    TEMPLATE_NAME,
    {
      listTemplates: async () => [{
        templateId: TEMPLATE_ID,
        aliases: [],
        names: [`qualification-team/${TEMPLATE_NAME}`],
      }],
      now: clock.now,
      sleep: clock.sleep,
    },
    { timeoutMs: 0, intervalMs: 25 },
  );
  assert.equal(result?.templateId, TEMPLATE_ID);
});

test("intent resolution rejects nested or suffix-only qualified names", async () => {
  const clock = fakeClock();
  const result = await resolveSharedTemplateIntentName(
    TEMPLATE_NAME,
    {
      listTemplates: async () => [{
        templateId: TEMPLATE_ID,
        aliases: [],
        names: [`unrelated/nested/${TEMPLATE_NAME}`],
      }],
      now: clock.now,
      sleep: clock.sleep,
    },
    { timeoutMs: 0, intervalMs: 25 },
  );
  assert.equal(result, null);
});

test("intent resolution returns the sole exact alias/name match after the observation window", async () => {
  const clock = fakeClock();
  let polls = 0;
  const result = await resolveSharedTemplateIntentName(
    TEMPLATE_NAME,
    {
      listTemplates: async () => {
        polls += 1;
        return polls < 2
          ? []
          : [{ templateId: TEMPLATE_ID, aliases: [TEMPLATE_NAME], names: ["display-name"] }];
      },
      now: clock.now,
      sleep: clock.sleep,
    },
    { timeoutMs: 100, intervalMs: 25 },
  );

  assert.deepEqual(result, {
    templateId: TEMPLATE_ID,
    aliases: [TEMPLATE_NAME],
    names: ["display-name"],
  });
  assert.equal(polls, 5);
});

test("intent resolution rejects simultaneous exact-name ambiguity", async () => {
  const deps = baseDeps({
    listTemplates: async () => [
      { templateId: "tpl_1", aliases: [TEMPLATE_NAME], names: [] },
      { templateId: "tpl_2", aliases: [], names: [TEMPLATE_NAME] },
    ],
  });

  await assert.rejects(
    () => resolveSharedTemplateIntentName(TEMPLATE_NAME, deps, { timeoutMs: 100, intervalMs: 25 }),
    /matches multiple authoritative provider templates/,
  );
});

test("intent resolution rejects different exact ids observed across the bounded window", async () => {
  const clock = fakeClock();
  let polls = 0;
  await assert.rejects(
    () => resolveSharedTemplateIntentName(
      TEMPLATE_NAME,
      {
        listTemplates: async () => {
          polls += 1;
          return [{
            templateId: polls === 1 ? "tpl_1" : "tpl_2",
            aliases: [TEMPLATE_NAME],
            names: [],
          }];
        },
        now: clock.now,
        sleep: clock.sleep,
      },
      { timeoutMs: 100, intervalMs: 25 },
    ),
    /resolved to multiple immutable ids/,
  );
});
