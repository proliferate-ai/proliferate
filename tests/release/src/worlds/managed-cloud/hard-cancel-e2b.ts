import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { Sandbox, type SandboxInfo } from "e2b";

const PAGE_LIMIT = 100;
const REQUEST_TIMEOUT_MS = 60_000;
const execFile = promisify(execFileCallback);

export interface HardCancelE2bTemplateRow {
  templateId: string;
  aliases: string[];
  names: string[];
}

export interface HardCancelE2bSandboxInventory {
  matches: Array<{
    providerSandboxId: string;
    state: "running" | "paused";
    templateId: string;
  }>;
  count: number;
}

export interface HardCancelE2bCleanupDeps {
  listTemplates(): Promise<HardCancelE2bTemplateRow[]>;
  listSandboxes(templateId: string): Promise<HardCancelE2bSandboxInventory>;
  killSandbox(sandboxId: string): Promise<{ killed: boolean }>;
  deleteTemplate(templateId: string): Promise<void>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface HardCancelE2bPollWindow {
  timeoutMs: number;
  intervalMs: number;
}

export interface E2bCliRunner {
  (command: string, args: string[], options: {
    env: NodeJS.ProcessEnv;
    timeout: number;
    maxBuffer: number;
    encoding: BufferEncoding;
  }): Promise<{ stdout: string | Buffer }>;
}

interface SandboxPaginatorLike {
  readonly hasNext: boolean;
  readonly nextToken: string | undefined;
  nextItems(options?: { apiKey?: string; signal?: AbortSignal }): Promise<SandboxInfo[]>;
}

export interface E2bSandboxAdmin {
  list(options: {
    apiKey: string;
    limit: number;
    query: { state: Array<"running" | "paused"> };
  }): SandboxPaginatorLike;
  kill(sandboxId: string, options: {
    apiKey: string;
    requestTimeoutMs: number;
    signal: AbortSignal;
  }): Promise<boolean>;
}

const DEFAULT_ADMIN: E2bSandboxAdmin = {
  list: (options) => Sandbox.list(options),
  kill: (sandboxId, options) => Sandbox.kill(sandboxId, options),
};

function safeProviderId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,299}$/.test(value)) {
    throw new Error(`${label} is missing or malformed.`);
  }
  return value;
}

/** Exhausts E2B's paginator and returns only exact immutable-template matches. */
export async function listHardCancelE2bSandboxes(
  templateIdValue: string,
  apiKey: string,
  admin: E2bSandboxAdmin = DEFAULT_ADMIN,
): Promise<HardCancelE2bSandboxInventory> {
  const templateId = safeProviderId(templateIdValue, "E2B template id");
  if (!apiKey.trim()) throw new Error("Qualification E2B API key is required.");
  const paginator = admin.list({
    apiKey,
    limit: 100,
    query: { state: ["running", "paused"] },
  });
  const matches: HardCancelE2bSandboxInventory["matches"] = [];
  const seenTokens = new Set<string>();
  let page = 0;
  while (paginator.hasNext) {
    page += 1;
    if (page > PAGE_LIMIT) throw new Error("E2B sandbox inventory exceeded the bounded page limit.");
    const rows = await paginator.nextItems({
      apiKey,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!Array.isArray(rows)) throw new Error("E2B sandbox inventory returned a malformed page.");
    for (const row of rows) {
      const sandboxId = safeProviderId(row?.sandboxId, "E2B sandbox id");
      const observedTemplateId = safeProviderId(row?.templateId, "E2B observed template id");
      if (row.state !== "running" && row.state !== "paused") {
        throw new Error(`E2B sandbox ${sandboxId} returned an unsupported state.`);
      }
      if (observedTemplateId === templateId) {
        matches.push({ providerSandboxId: sandboxId, state: row.state, templateId: observedTemplateId });
      }
    }
    if (paginator.hasNext) {
      const token = paginator.nextToken;
      if (!token || seenTokens.has(token)) {
        throw new Error("E2B sandbox inventory did not advance its pagination token.");
      }
      seenTokens.add(token);
    }
  }
  return { matches, count: matches.length };
}

/** Idempotent exact-id kill; absence (`false`) is already-clean truth. */
export async function killHardCancelE2bSandbox(
  sandboxIdValue: string,
  apiKey: string,
  admin: E2bSandboxAdmin = DEFAULT_ADMIN,
): Promise<{ killed: boolean }> {
  const sandboxId = safeProviderId(sandboxIdValue, "E2B sandbox id");
  if (!apiKey.trim()) throw new Error("Qualification E2B API key is required.");
  const killed = await admin.kill(sandboxId, {
    apiKey,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { killed };
}

/** Reads strict immutable template identities through the pinned E2B CLI. */
export async function listHardCancelE2bTemplates(
  apiKey: string,
  teamId: string,
  run: E2bCliRunner = execFile,
): Promise<HardCancelE2bTemplateRow[]> {
  if (!apiKey.trim() || !teamId.trim()) {
    throw new Error("Qualification E2B API key and team id are required.");
  }
  const { stdout } = await run(
    "e2b",
    ["template", "list", "--team", teamId, "--format", "json"],
    {
      env: { ...process.env, E2B_API_KEY: apiKey },
      timeout: REQUEST_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8",
    },
  );
  const parsed = JSON.parse(stdout.toString().trim()) as unknown;
  if (!Array.isArray(parsed)) throw new Error("E2B template inventory returned a non-array payload.");
  const seen = new Set<string>();
  return parsed.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`E2B template inventory row ${index} is malformed.`);
    }
    const row = candidate as Record<string, unknown>;
    const templateId = safeProviderId(row.templateID ?? row.templateId, `E2B template row ${index} id`);
    const aliases = strictNames(row.aliases, `E2B template row ${index} aliases`);
    const names = strictNames(row.names, `E2B template row ${index} names`);
    if (seen.has(templateId)) throw new Error(`E2B template inventory repeated immutable id ${templateId}.`);
    seen.add(templateId);
    return { templateId, aliases, names };
  });
}

function strictNames(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((name) => typeof name !== "string" || !name)) {
    throw new Error(`${label} are malformed.`);
  }
  return value as string[];
}

function exactTemplateName(row: HardCancelE2bTemplateRow, name: string): boolean {
  return row.aliases.includes(name) || row.names.includes(name) || row.names.some((candidate) => {
    const parts = candidate.split("/");
    return parts.length === 2 && parts[1] === name;
  });
}

function pollClock(deps: Pick<HardCancelE2bCleanupDeps, "now" | "sleep">): {
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
} {
  return {
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? (async (milliseconds) => {
      await new Promise((resolve) => setTimeout(resolve, milliseconds));
    }),
  };
}

function validWindow(window: HardCancelE2bPollWindow): HardCancelE2bPollWindow {
  if (!Number.isSafeInteger(window.timeoutMs) || window.timeoutMs < 0) {
    throw new Error("E2B cleanup timeout must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(window.intervalMs) || window.intervalMs <= 0) {
    throw new Error("E2B cleanup interval must be a positive safe integer.");
  }
  return window;
}

async function pollAgain(
  deadline: number,
  intervalMs: number,
  clock: ReturnType<typeof pollClock>,
): Promise<boolean> {
  const now = clock.now();
  if (!Number.isFinite(now) || now >= deadline) return false;
  await clock.sleep(Math.min(intervalMs, deadline - now));
  return true;
}

/** Resolves one exact run-scoped name, failing on simultaneous or temporal ambiguity. */
export async function resolveHardCancelE2bTemplateName(
  templateName: string,
  deps: Pick<HardCancelE2bCleanupDeps, "listTemplates" | "now" | "sleep">,
  windowValue: HardCancelE2bPollWindow,
): Promise<HardCancelE2bTemplateRow | null> {
  const name = safeProviderId(templateName, "E2B template name");
  const window = validWindow(windowValue);
  const clock = pollClock(deps);
  const started = clock.now();
  if (!Number.isFinite(started)) throw new Error("E2B cleanup clock is non-finite.");
  const deadline = started + window.timeoutMs;
  let observed: HardCancelE2bTemplateRow | null = null;
  do {
    const matches = (await deps.listTemplates()).filter((row) => exactTemplateName(row, name));
    if (matches.length > 1) throw new Error(`E2B template name ${name} matches multiple immutable ids.`);
    if (matches[0]) {
      if (observed && observed.templateId !== matches[0].templateId) {
        throw new Error(`E2B template name ${name} changed immutable ids during recovery.`);
      }
      observed = matches[0];
    }
  } while (await pollAgain(deadline, window.intervalMs, clock));
  return observed;
}

/** Kills exact-template sandboxes, proves zero, deletes the template, then proves absence. */
export async function cleanupHardCancelE2bTemplate(
  templateIdValue: string,
  deps: HardCancelE2bCleanupDeps,
  policy: { sandboxAbsence: HardCancelE2bPollWindow; templateAbsence: HardCancelE2bPollWindow },
): Promise<{ killedSandboxIds: string[] }> {
  const templateId = safeProviderId(templateIdValue, "E2B template id");
  const sandboxWindow = validWindow(policy.sandboxAbsence);
  const templateWindow = validWindow(policy.templateAbsence);
  const clock = pollClock(deps);
  const killed = new Set<string>();
  const sandboxDeadline = clock.now() + sandboxWindow.timeoutMs;
  while (true) {
    const inventory = await deps.listSandboxes(templateId);
    validateSandboxInventory(inventory, templateId);
    if (inventory.count === 0) break;
    for (const sandbox of inventory.matches) {
      const result = await deps.killSandbox(sandbox.providerSandboxId);
      if (!result || typeof result.killed !== "boolean") {
        throw new Error(`E2B kill for ${sandbox.providerSandboxId} returned an ambiguous result.`);
      }
      if (result.killed) killed.add(sandbox.providerSandboxId);
    }
    if (!(await pollAgain(sandboxDeadline, sandboxWindow.intervalMs, clock))) {
      throw new Error(`Timed out proving zero sandboxes for E2B template ${templateId}.`);
    }
  }

  const before = (await deps.listTemplates()).filter((row) => row.templateId === templateId);
  if (before.length > 1) throw new Error(`E2B inventory repeated immutable template ${templateId}.`);
  if (before.length === 0) return { killedSandboxIds: [...killed].sort() };
  await deps.deleteTemplate(templateId);

  const templateDeadline = clock.now() + templateWindow.timeoutMs;
  while (true) {
    const remaining = (await deps.listTemplates()).filter((row) => row.templateId === templateId);
    if (remaining.length === 0) return { killedSandboxIds: [...killed].sort() };
    if (remaining.length > 1) throw new Error(`E2B inventory repeated immutable template ${templateId}.`);
    if (!(await pollAgain(templateDeadline, templateWindow.intervalMs, clock))) {
      throw new Error(`Timed out proving E2B template ${templateId} absent after deletion.`);
    }
  }
}

function validateSandboxInventory(inventory: HardCancelE2bSandboxInventory, templateId: string): void {
  if (!inventory || !Number.isSafeInteger(inventory.count) || inventory.count < 0 ||
      !Array.isArray(inventory.matches) || inventory.count !== inventory.matches.length) {
    throw new Error("E2B sandbox inventory is malformed or non-exhaustive.");
  }
  const seen = new Set<string>();
  for (const row of inventory.matches) {
    const sandboxId = safeProviderId(row.providerSandboxId, "E2B sandbox id");
    if (row.templateId !== templateId || (row.state !== "running" && row.state !== "paused")) {
      throw new Error(`E2B sandbox ${sandboxId} has ambiguous template/state attribution.`);
    }
    if (seen.has(sandboxId)) throw new Error(`E2B sandbox inventory repeated ${sandboxId}.`);
    seen.add(sandboxId);
  }
}
