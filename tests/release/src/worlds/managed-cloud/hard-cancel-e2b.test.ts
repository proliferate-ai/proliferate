import assert from "node:assert/strict";
import { test } from "node:test";

import type { SandboxInfo } from "e2b";

import {
  cleanupHardCancelE2bTemplate,
  killHardCancelE2bSandbox,
  listHardCancelE2bSandboxes,
  listHardCancelE2bTemplates,
  resolveHardCancelE2bTemplateName,
  type E2bSandboxAdmin,
} from "./hard-cancel-e2b.js";

const TEMPLATE = "tmpl-owned";

function row(sandboxId: string, templateId: string, state: "running" | "paused"): SandboxInfo {
  return { sandboxId, templateId, state } as SandboxInfo;
}

function pagedAdmin(pages: SandboxInfo[][]): { admin: E2bSandboxAdmin; killed: string[] } {
  let index = 0;
  let nextToken = pages.length > 0 ? "initial" : undefined;
  const killed: string[] = [];
  const paginator = {
    get hasNext() { return index < pages.length; },
    get nextToken() { return nextToken; },
    async nextItems() {
      const page = pages[index++] ?? [];
      nextToken = index < pages.length ? `page-${index + 1}` : undefined;
      return page;
    },
  };
  return {
    killed,
    admin: {
      list() { return paginator; },
      async kill(sandboxId) { killed.push(sandboxId); return true; },
    },
  };
}

test("exhausts running and paused pages and keeps only the exact immutable template", async () => {
  const fake = pagedAdmin([
    [row("sbx-owned-1", TEMPLATE, "running"), row("sbx-foreign", "tmpl-foreign", "running")],
    [row("sbx-owned-2", TEMPLATE, "paused")],
  ]);
  assert.deepEqual(await listHardCancelE2bSandboxes(TEMPLATE, "e2b-key", fake.admin), {
    matches: [
      { providerSandboxId: "sbx-owned-1", state: "running", templateId: TEMPLATE },
      { providerSandboxId: "sbx-owned-2", state: "paused", templateId: TEMPLATE },
    ],
    count: 2,
  });
});

test("a repeated or missing provider pagination token fails closed", async () => {
  let page = 0;
  const admin: E2bSandboxAdmin = {
    list() {
      return {
        get hasNext() { return page < 3; },
        get nextToken() { return "same-token"; },
        async nextItems() { page += 1; return []; },
      };
    },
    async kill() { throw new Error("not called"); },
  };
  await assert.rejects(
    () => listHardCancelE2bSandboxes(TEMPLATE, "e2b-key", admin),
    /did not advance its pagination token/,
  );
});

test("kill is exact-id and preserves provider absence as idempotently clean", async () => {
  const fake = pagedAdmin([]);
  fake.admin.kill = async (sandboxId) => { fake.killed.push(sandboxId); return false; };
  assert.deepEqual(await killHardCancelE2bSandbox("sbx-owned", "e2b-key", fake.admin), { killed: false });
  assert.deepEqual(fake.killed, ["sbx-owned"]);
});

test("strict template inventory uses the exact team and rejects duplicate immutable ids", async () => {
  const calls: unknown[][] = [];
  const run = async (...args: unknown[]) => {
    calls.push(args);
    return {
      stdout: JSON.stringify([
        { templateID: TEMPLATE, aliases: ["qual-name"], names: ["team/qual-name"] },
      ]),
    };
  };
  assert.deepEqual(
    await listHardCancelE2bTemplates("e2b-key", "team-id", run as never),
    [{ templateId: TEMPLATE, aliases: ["qual-name"], names: ["team/qual-name"] }],
  );
  assert.deepEqual((calls[0]![1] as string[]), ["template", "list", "--team", "team-id", "--format", "json"]);

  await assert.rejects(
    () => listHardCancelE2bTemplates("e2b-key", "team-id", (async () => ({
      stdout: JSON.stringify([
        { templateID: TEMPLATE, aliases: [], names: [] },
        { templateID: TEMPLATE, aliases: [], names: [] },
      ]),
    })) as never),
    /repeated immutable id/,
  );
});

test("template resolution is exact and fails on multiple immutable matches", async () => {
  let now = 0;
  const rows = [
    { templateId: TEMPLATE, aliases: ["proliferate-runtime-qual-r"], names: [] },
    { templateId: "tmpl-prefix", aliases: ["proliferate-runtime-qual-r-extra"], names: [] },
  ];
  assert.equal((await resolveHardCancelE2bTemplateName(
    "proliferate-runtime-qual-r",
    { async listTemplates() { return rows; }, now: () => now, sleep: async (ms) => { now += ms; } },
    { timeoutMs: 1, intervalMs: 1 },
  ))?.templateId, TEMPLATE);

  await assert.rejects(
    () => resolveHardCancelE2bTemplateName(
      "proliferate-runtime-qual-r",
      {
        async listTemplates() {
          return [rows[0]!, { templateId: "tmpl-second", aliases: ["proliferate-runtime-qual-r"], names: [] }];
        },
        now: () => now,
        sleep: async (ms) => { now += ms; },
      },
      { timeoutMs: 1, intervalMs: 1 },
    ),
    /multiple immutable ids/,
  );
});

test("cleanup proves sandbox absence before template deletion and then proves template absence", async () => {
  let now = 0;
  let sandboxes = [{ providerSandboxId: "sbx-owned", state: "running" as const, templateId: TEMPLATE }];
  let templates = [{ templateId: TEMPLATE, aliases: ["qual"], names: [] }];
  const calls: string[] = [];
  const result = await cleanupHardCancelE2bTemplate(TEMPLATE, {
    async listSandboxes() {
      calls.push("list-sandboxes");
      return { matches: sandboxes, count: sandboxes.length };
    },
    async killSandbox(id) {
      calls.push(`kill:${id}`);
      sandboxes = [];
      return { killed: true };
    },
    async listTemplates() { calls.push("list-templates"); return templates; },
    async deleteTemplate(id) { calls.push(`delete-template:${id}`); templates = []; },
    now: () => now,
    sleep: async (ms) => { now += ms; },
  }, {
    sandboxAbsence: { timeoutMs: 10, intervalMs: 1 },
    templateAbsence: { timeoutMs: 10, intervalMs: 1 },
  });
  assert.deepEqual(result, { killedSandboxIds: ["sbx-owned"] });
  assert.ok(calls.indexOf("delete-template:tmpl-owned") > calls.lastIndexOf("list-sandboxes"));
  assert.equal(calls.at(-1), "list-templates");
});

test("malformed provider rows fail before any classification", async () => {
  const fake = pagedAdmin([[{ sandboxId: "sbx-owned", templateId: TEMPLATE, state: "deleted" } as unknown as SandboxInfo]]);
  await assert.rejects(
    () => listHardCancelE2bSandboxes(TEMPLATE, "e2b-key", fake.admin),
    /unsupported state/,
  );
});
