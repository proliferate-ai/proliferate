// ACP tells us which commands an agent knows about, not which native client
// surfaces a command needs. Keep the desktop policy explicit and versioned so
// product changes are reviewed here instead of scattered through the UI.
export const DESKTOP_SESSION_SLASH_COMMAND_POLICY_VERSION = 1;

const DESKTOP_SAFE_NATIVE_COMMAND_NAMES = new Set([
  "compact",
  "init",
  "review",
  "review-branch",
  "review-commit",
]);

const DESKTOP_HIDDEN_NATIVE_COMMAND_NAMES = new Set([
  "add-dir",
  "agents",
  "approvals",
  "auth",
  "bproc",
  "bprocs",
  "background",
  "background-processes",
  "browser",
  "bug",
  "clear",
  "config",
  "context",
  "cost",
  "default",
  "diff",
  "doctor",
  "exit",
  "extra-usage",
  "help",
  "heapdump",
  "history",
  "hooks",
  "ide",
  "keybindings-help",
  "login",
  "logout",
  "mcp",
  "memory",
  "migrate-installer",
  "model",
  "new",
  "output-style",
  "permissions",
  "plan",
  "pr_comments",
  "processes",
  "prompts",
  "quit",
  "release-notes",
  "resume",
  "status",
  "terminal",
  "terminal-setup",
  "terminals",
  "todos",
  "undo",
  "vim",
]);

const DESKTOP_HIDDEN_NATIVE_COMMAND_PREFIXES = [
  "config:",
  "model:",
  "output-style:",
  "permissions:",
  "terminal:",
];

export type SessionSlashCommandGroup = "Commands" | "MCP";

export interface SessionSlashCommandViewModel {
  id: string;
  name: string;
  displayName: string;
  description: string;
  inputHint: string | null;
  group: SessionSlashCommandGroup;
}

export function filterDesktopRunnableSessionSlashCommands(
  commands: readonly unknown[],
): SessionSlashCommandViewModel[] {
  const seenNames = new Set<string>();
  const items: SessionSlashCommandViewModel[] = [];

  for (const command of commands) {
    const normalized = normalizeAvailableSessionSlashCommand(command);
    if (!normalized) {
      continue;
    }

    if (!isDesktopRunnableSessionSlashCommandName(normalized.name)) {
      continue;
    }

    const lookupName = slashCommandLookupName(normalized.name);
    if (seenNames.has(lookupName)) {
      continue;
    }
    seenNames.add(lookupName);
    items.push(normalized);
  }

  return items;
}

export function matchSessionSlashCommandQuery(
  command: SessionSlashCommandViewModel,
  query: string,
): boolean {
  const normalizedQuery = normalizeSlashCommandQuery(query);
  if (!normalizedQuery) {
    return true;
  }

  return [
    command.name,
    command.description,
    command.inputHint ?? "",
  ].some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function normalizeSlashCommandQuery(query: string): string {
  return query.trim().replace(/^\/+/u, "").toLowerCase();
}

export function normalizeSlashCommandName(name: string): string | null {
  const normalized = name.trim().replace(/^\/+/u, "");
  if (!normalized || /\s/u.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeAvailableSessionSlashCommand(
  command: unknown,
): SessionSlashCommandViewModel | null {
  if (!isRecord(command) || typeof command.name !== "string") {
    return null;
  }

  const name = normalizeSlashCommandName(command.name);
  if (!name) {
    return null;
  }

  const description = typeof command.description === "string"
    ? command.description
    : "";
  const inputHint = isRecord(command.input) && typeof command.input.hint === "string"
    ? command.input.hint
    : null;

  return {
    id: slashCommandLookupName(name),
    name,
    displayName: `/${name}`,
    description,
    inputHint,
    group: slashCommandGroup(name),
  };
}

function isDesktopRunnableSessionSlashCommandName(name: string): boolean {
  const lookupName = slashCommandLookupName(name);
  if (isMcpPromptCommand(lookupName)) {
    return true;
  }
  if (DESKTOP_SAFE_NATIVE_COMMAND_NAMES.has(lookupName)) {
    return true;
  }
  if (DESKTOP_HIDDEN_NATIVE_COMMAND_NAMES.has(lookupName)) {
    return false;
  }
  return !DESKTOP_HIDDEN_NATIVE_COMMAND_PREFIXES.some((prefix) => lookupName.startsWith(prefix));
}

function slashCommandGroup(name: string): SessionSlashCommandGroup {
  return isMcpPromptCommand(slashCommandLookupName(name)) ? "MCP" : "Commands";
}

function isMcpPromptCommand(lookupName: string): boolean {
  return lookupName.startsWith("mcp:");
}

function slashCommandLookupName(name: string): string {
  return name.toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
