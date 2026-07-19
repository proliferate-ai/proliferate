/**
 * Provider-agnostic cleanup rules for one run-owned immutable E2B template.
 *
 * This module intentionally has no provider defaults. Callers inject the
 * authoritative inventory and mutation operations, while this owner enforces
 * exact attribution, bounded convergence, and fail-closed transitions before
 * shared-template custody may be released.
 */

export interface SharedTemplateSandboxInventory {
  matches: Array<{
    providerSandboxId: string;
    state: "running" | "paused";
    templateId: string;
  }>;
  count: number;
}

export interface SharedTemplateInventoryRow {
  templateId: string;
  aliases: string[];
  names: string[];
}

export interface SharedTemplateProviderCleanupDeps {
  listSandboxes(templateId: string): Promise<unknown>;
  killSandbox(providerSandboxId: string): Promise<unknown>;
  deleteTemplate(templateId: string): Promise<void>;
  listTemplates(): Promise<unknown>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface SharedTemplateProviderPollWindow {
  timeoutMs: number;
  intervalMs: number;
}

export interface SharedTemplateProviderCleanupPolicy {
  sandboxAbsence: SharedTemplateProviderPollWindow;
  templateAbsence: SharedTemplateProviderPollWindow;
}

export interface SharedTemplateProviderCleanupResult {
  templateId: string;
  killedSandboxIds: string[];
  killAttempts: number;
  sandboxInventoryPolls: number;
  templateInventoryPolls: number;
}

export class SharedTemplateProviderCleanupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedTemplateProviderCleanupError";
  }
}

interface PollClock {
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}

const DEFAULT_CLOCK: PollClock = {
  now: Date.now,
  sleep: async (milliseconds) => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  },
};

/**
 * Deletes every sandbox positively attributed to `templateId`, proves the
 * exhaustive sandbox inventory converges to zero, deletes that exact template,
 * then proves the immutable id disappears from authoritative inventory.
 */
export async function cleanupSharedTemplateProviderResources(
  templateId: string,
  deps: SharedTemplateProviderCleanupDeps,
  policy: SharedTemplateProviderCleanupPolicy,
): Promise<SharedTemplateProviderCleanupResult> {
  const exactTemplateId = requireProviderId(templateId, "templateId");
  const clock = resolveClock(deps);
  const sandboxWindow = validateWindow(policy.sandboxAbsence, "sandboxAbsence");
  const templateWindow = validateWindow(policy.templateAbsence, "templateAbsence");
  const killedSandboxIds = new Set<string>();
  let killAttempts = 0;
  let sandboxInventoryPolls = 0;

  const sandboxPoll = beginPoll(sandboxWindow, clock);
  while (true) {
    const inventory = validateSandboxInventory(
      await deps.listSandboxes(exactTemplateId),
      exactTemplateId,
    );
    sandboxInventoryPolls += 1;
    if (inventory.count === 0) {
      break;
    }

    for (const sandbox of inventory.matches) {
      const outcome = await deps.killSandbox(sandbox.providerSandboxId);
      killAttempts += 1;
      assertKilled(outcome, sandbox.providerSandboxId);
      killedSandboxIds.add(sandbox.providerSandboxId);
    }

    if (!(await waitForNextObservation(sandboxPoll, clock))) {
      throw new SharedTemplateProviderCleanupError(
        `Timed out proving zero sandboxes for exact template ${exactTemplateId}; ` +
          `last authoritative count was ${inventory.count}.`,
      );
    }
  }

  let templateInventoryPolls = 0;
  const beforeDelete = validateTemplateInventory(await deps.listTemplates());
  templateInventoryPolls += 1;
  const beforeDeleteMatches = beforeDelete.filter((row) => row.templateId === exactTemplateId);
  if (beforeDeleteMatches.length > 1) {
    throw new SharedTemplateProviderCleanupError(
      `Authoritative template inventory contains duplicate immutable id ${exactTemplateId}.`,
    );
  }
  // Crash-safe retry: provider deletion may have succeeded before the custody
  // journal was durably marked released. Exact sandbox + template absence is
  // already sufficient proof; do not issue a non-idempotent second delete.
  if (beforeDeleteMatches.length === 0) {
    return {
      templateId: exactTemplateId,
      killedSandboxIds: [...killedSandboxIds].sort(),
      killAttempts,
      sandboxInventoryPolls,
      templateInventoryPolls,
    };
  }

  await deps.deleteTemplate(exactTemplateId);

  const templatePoll = beginPoll(templateWindow, clock);
  while (true) {
    const inventory = validateTemplateInventory(await deps.listTemplates());
    templateInventoryPolls += 1;
    const exactMatches = inventory.filter((row) => row.templateId === exactTemplateId);
    if (exactMatches.length === 0) {
      return {
        templateId: exactTemplateId,
        killedSandboxIds: [...killedSandboxIds].sort(),
        killAttempts,
        sandboxInventoryPolls,
        templateInventoryPolls,
      };
    }
    if (exactMatches.length > 1) {
      throw new SharedTemplateProviderCleanupError(
        `Authoritative template inventory contains duplicate immutable id ${exactTemplateId}.`,
      );
    }
    if (!(await waitForNextObservation(templatePoll, clock))) {
      throw new SharedTemplateProviderCleanupError(
        `Timed out proving exact template ${exactTemplateId} absent after deletion.`,
      );
    }
  }
}

/**
 * Resolves an intent-only journal by an exact alias/name over the complete
 * configured observation window. Zero matches returns `null`; one immutable
 * id returns its row; multiple simultaneous or temporally distinct ids fail
 * closed as ambiguous. A team-qualified `team/<exactName>` is accepted because
 * that is E2B's inventory shape; arbitrary prefixes/substrings never count.
 */
export async function resolveSharedTemplateIntentName(
  templateName: string,
  deps: Pick<SharedTemplateProviderCleanupDeps, "listTemplates" | "now" | "sleep">,
  window: SharedTemplateProviderPollWindow,
): Promise<SharedTemplateInventoryRow | null> {
  const exactName = requireInventoryName(templateName, "templateName");
  const clock = resolveClock(deps);
  const poll = beginPoll(validateWindow(window, "intentResolution"), clock);
  let observed: SharedTemplateInventoryRow | null = null;

  while (true) {
    const inventory = validateTemplateInventory(await deps.listTemplates());
    const matches = inventory.filter((row) =>
      row.aliases.includes(exactName) ||
      row.names.includes(exactName) ||
      row.names.some((name) => isOneSegmentQualifiedName(name, exactName)),
    );
    if (matches.length > 1) {
      throw new SharedTemplateProviderCleanupError(
        `Intent name ${exactName} matches multiple authoritative provider templates.`,
      );
    }
    if (matches[0]) {
      if (observed && observed.templateId !== matches[0].templateId) {
        throw new SharedTemplateProviderCleanupError(
          `Intent name ${exactName} resolved to multiple immutable ids during the observation window.`,
        );
      }
      observed = cloneTemplateRow(matches[0]);
    }
    if (!(await waitForNextObservation(poll, clock))) {
      return observed;
    }
  }
}

function isOneSegmentQualifiedName(candidate: string, exactName: string): boolean {
  const separator = candidate.indexOf("/");
  return separator > 0 && candidate.indexOf("/", separator + 1) === -1 && candidate.slice(separator + 1) === exactName;
}

interface PollState {
  deadline: number;
  intervalMs: number;
  observationsRemaining: number;
}

function beginPoll(window: SharedTemplateProviderPollWindow, clock: PollClock): PollState {
  const startedAt = clock.now();
  if (!Number.isFinite(startedAt)) {
    throw new SharedTemplateProviderCleanupError("Injected cleanup clock returned a non-finite time.");
  }
  return {
    deadline: startedAt + window.timeoutMs,
    intervalMs: window.intervalMs,
    observationsRemaining: Math.ceil(window.timeoutMs / window.intervalMs) + 1,
  };
}

async function waitForNextObservation(state: PollState, clock: PollClock): Promise<boolean> {
  state.observationsRemaining -= 1;
  const now = clock.now();
  if (!Number.isFinite(now)) {
    throw new SharedTemplateProviderCleanupError("Injected cleanup clock returned a non-finite time.");
  }
  if (state.observationsRemaining <= 0 || now >= state.deadline) {
    return false;
  }
  await clock.sleep(Math.min(state.intervalMs, state.deadline - now));
  return true;
}

function resolveClock(
  deps: Pick<SharedTemplateProviderCleanupDeps, "now" | "sleep">,
): PollClock {
  return {
    now: deps.now ?? DEFAULT_CLOCK.now,
    sleep: deps.sleep ?? DEFAULT_CLOCK.sleep,
  };
}

function validateWindow(
  value: SharedTemplateProviderPollWindow,
  label: string,
): SharedTemplateProviderPollWindow {
  if (!value || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 0) {
    throw new SharedTemplateProviderCleanupError(`${label}.timeoutMs must be a non-negative safe integer.`);
  }
  if (!Number.isSafeInteger(value.intervalMs) || value.intervalMs <= 0) {
    throw new SharedTemplateProviderCleanupError(`${label}.intervalMs must be a positive safe integer.`);
  }
  return value;
}

function validateSandboxInventory(value: unknown, templateId: string): SharedTemplateSandboxInventory {
  const row = requireRecord(value, "sandbox inventory");
  if (!Number.isSafeInteger(row.count) || (row.count as number) < 0 || !Array.isArray(row.matches)) {
    throw new SharedTemplateProviderCleanupError("Sandbox inventory has malformed count/matches fields.");
  }
  if (row.count !== row.matches.length) {
    throw new SharedTemplateProviderCleanupError("Sandbox inventory count does not match its exhaustive list.");
  }
  const seen = new Set<string>();
  const matches = row.matches.map((candidate, index) => {
    const match = requireRecord(candidate, `sandbox inventory match ${index}`);
    const providerSandboxId = requireProviderId(match.providerSandboxId, `sandbox match ${index} id`);
    const observedTemplateId = requireProviderId(match.templateId, `sandbox match ${index} templateId`);
    if (observedTemplateId !== templateId) {
      throw new SharedTemplateProviderCleanupError(
        `Sandbox ${providerSandboxId} is ambiguously attributed to ${observedTemplateId}, not ${templateId}.`,
      );
    }
    if (match.state !== "running" && match.state !== "paused") {
      throw new SharedTemplateProviderCleanupError(`Sandbox ${providerSandboxId} has an unknown live state.`);
    }
    const state: "running" | "paused" = match.state;
    if (seen.has(providerSandboxId)) {
      throw new SharedTemplateProviderCleanupError(
        `Sandbox inventory contains duplicate provider id ${providerSandboxId}.`,
      );
    }
    seen.add(providerSandboxId);
    return { providerSandboxId, state, templateId: observedTemplateId };
  });
  return { count: row.count as number, matches };
}

function validateTemplateInventory(value: unknown): SharedTemplateInventoryRow[] {
  if (!Array.isArray(value)) {
    throw new SharedTemplateProviderCleanupError("Authoritative template inventory is not an array.");
  }
  const seen = new Set<string>();
  return value.map((candidate, index) => {
    const row = requireRecord(candidate, `template inventory row ${index}`);
    const templateId = requireProviderId(row.templateId, `template inventory row ${index} id`);
    if (seen.has(templateId)) {
      throw new SharedTemplateProviderCleanupError(
        `Authoritative template inventory contains duplicate immutable id ${templateId}.`,
      );
    }
    seen.add(templateId);
    return {
      templateId,
      aliases: validateNames(row.aliases, `template inventory row ${index} aliases`),
      names: validateNames(row.names, `template inventory row ${index} names`),
    };
  });
}

function validateNames(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new SharedTemplateProviderCleanupError(`${label} is not an array.`);
  }
  return value.map((name, index) => requireInventoryName(name, `${label}[${index}]`));
}

function assertKilled(value: unknown, sandboxId: string): void {
  const row = requireRecord(value, `kill result for ${sandboxId}`);
  if (row.killed !== true) {
    throw new SharedTemplateProviderCleanupError(
      `Provider did not affirm that sandbox ${sandboxId} was killed.`,
    );
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SharedTemplateProviderCleanupError(`${label} is not an object.`);
  }
  return value as Record<string, unknown>;
}

function requireProviderId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)) {
    throw new SharedTemplateProviderCleanupError(`${label} is not a safe non-empty provider id.`);
  }
  return value;
}

function requireInventoryName(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new SharedTemplateProviderCleanupError(`${label} is not a bounded non-empty inventory name.`);
  }
  return value;
}

function cloneTemplateRow(row: SharedTemplateInventoryRow): SharedTemplateInventoryRow {
  return { templateId: row.templateId, aliases: [...row.aliases], names: [...row.names] };
}
