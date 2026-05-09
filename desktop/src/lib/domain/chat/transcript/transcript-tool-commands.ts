import type { TranscriptItem } from "@anyharness/sdk";

export type ParsedToolCommandKind =
  | "read"
  | "listing"
  | "search"
  | "fetch"
  | "command"
  | "action";

export interface ParsedToolCommand {
  kind: ParsedToolCommandKind;
  command: string | null;
  path: string | null;
  name: string | null;
  query: string | null;
}

export function getToolCallShellCommand(
  item: Extract<TranscriptItem, { kind: "tool_call" }>,
): string | null {
  const rawInput = asRecord(item.rawInput);
  if (!rawInput) {
    return null;
  }
  const command = rawInput.command ?? rawInput.cmd;
  if (typeof command === "string") {
    return command.trim().length > 0 ? command : null;
  }
  if (Array.isArray(command)) {
    return normalizeShellCommandArray(command);
  }
  return null;
}

export function getToolCallShellCommandName(
  item: Extract<TranscriptItem, { kind: "tool_call" }>,
): string | null {
  const command = getToolCallShellCommand(item);
  if (!command) {
    return null;
  }

  const withoutDirectoryPrefix = command
    .trim()
    .replace(/^(?:cd\s+[^&;|]+&&\s*)+/, "");
  const match = withoutDirectoryPrefix.match(/^["']?([^\s"';&|]+)/);
  if (!match) {
    return null;
  }
  return match[1].split(/[\\/]/).pop()?.toLowerCase() ?? null;
}

export function getToolCallParsedCommands(
  item: Extract<TranscriptItem, { kind: "tool_call" }>,
): ParsedToolCommand[] {
  const rawInput = asRecord(item.rawInput);
  const parsedCommands = rawInput?.parsed_cmd;
  if (Array.isArray(parsedCommands)) {
    const commands = parsedCommands.flatMap((value): ParsedToolCommand[] => {
      const record = asRecord(value);
      if (!record) {
        return [];
      }

      const command = readString(record.cmd) ?? readString(record.command);
      const expandedCommands = expandShellOperationList(command);
      if (expandedCommands.length > 0) {
        return expandedCommands.map(commandToParsedToolCommand);
      }

      return [{
        kind: normalizeParsedCommandKind(readString(record.type), command),
        command,
        path: readString(record.path),
        name: readString(record.name),
        query: readString(record.query) ?? readString(record.pattern),
      }];
    });
    if (commands.length > 0) {
      return commands;
    }
  }

  const shellCommand = getToolCallShellCommand(item);
  const expandedCommands = expandShellOperationList(shellCommand)
    .map(commandToParsedToolCommand);
  if (expandedCommands.length > 0) {
    return expandedCommands;
  }

  const shellKind = inferShellCommandKind(shellCommand);
  return shellCommand && isExplorationParsedCommand(shellKind)
    ? [commandToParsedToolCommand(shellCommand)]
    : [];
}

export function isExplorationParsedCommand(kind: ParsedToolCommandKind): boolean {
  return kind === "read"
    || kind === "listing"
    || kind === "search"
    || kind === "fetch";
}

function normalizeParsedCommandKind(
  type: string | null,
  command: string | null = null,
): ParsedToolCommandKind {
  switch (type?.toLowerCase()) {
    case "read":
      return "read";
    case "list":
    case "listing":
    case "ls":
      return "listing";
    case "search":
    case "grep":
    case "find":
      return "search";
    case "fetch":
      return "fetch";
    case "command":
    case "run":
    case "shell":
      return "command";
    default:
      return inferShellCommandKind(command);
  }
}

function normalizeShellCommandArray(command: unknown[]): string | null {
  if (!command.every((part): part is string => typeof part === "string")) {
    return null;
  }

  const parts = command.map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  const executable = parts[0]?.split(/[\\/]/).pop()?.toLowerCase();
  if (
    parts.length >= 3
    && (executable === "sh" || executable === "bash" || executable === "zsh")
    && (parts[1] === "-c" || parts[1] === "-lc")
  ) {
    return parts.slice(2).join(" ");
  }

  return parts.join(" ");
}

function expandShellOperationList(command: string | null): string[] {
  if (!command || !command.includes("ops=(")) {
    return [];
  }

  const operations: string[] = [];
  const singleQuotedStringPattern = /'((?:\\'|[^'])*)'/g;
  for (const match of command.matchAll(singleQuotedStringPattern)) {
    const operation = match[1]?.replace(/\\'/g, "'").trim();
    if (operation && isLikelyShellOperation(operation)) {
      operations.push(operation);
    }
  }
  return operations;
}

function commandToParsedToolCommand(command: string): ParsedToolCommand {
  const words = splitShellWords(command);
  const kind = inferShellCommandKind(command);
  const path = inferShellCommandPath(words, kind);
  return {
    kind,
    command,
    path,
    name: path ? basename(path) : null,
    query: kind === "search" ? inferShellSearchQuery(words) : null,
  };
}

function inferShellCommandKind(command: string | null): ParsedToolCommandKind {
  const commandName = getShellCommandName(command);
  switch (commandName) {
    case "cat":
    case "head":
    case "nl":
    case "sed":
    case "tail":
      return "read";
    case "ls":
    case "tree":
      return "listing";
    case "ag":
    case "fd":
    case "find":
    case "grep":
    case "rg":
      return "search";
    case "curl":
    case "wget":
      return "fetch";
    case null:
      return "action";
    default:
      return "command";
  }
}

function getShellCommandName(command: string | null): string | null {
  if (!command) {
    return null;
  }
  const words = splitShellWords(command.trim().replace(/^(?:cd\s+[^&;|]+&&\s*)+/, ""));
  return words[0]?.split(/[\\/]/).pop()?.toLowerCase() ?? null;
}

function isLikelyShellOperation(command: string): boolean {
  const commandName = splitShellWords(command)[0]?.split(/[\\/]/).pop() ?? null;
  return !!commandName && /^[a-z][A-Za-z0-9_.-]*$/.test(commandName);
}

function inferShellCommandPath(
  words: readonly string[],
  kind: ParsedToolCommandKind,
): string | null {
  if (words.length <= 1) {
    return null;
  }

  if (kind === "read") {
    return [...words]
      .reverse()
      .find((word) => looksLikePathArgument(word)) ?? null;
  }

  if (kind === "listing") {
    return words.slice(1).find((word) => looksLikePathArgument(word)) ?? null;
  }

  if (kind === "search") {
    const args = words.slice(1).filter((word) => !word.startsWith("-"));
    return args.find((word, index) => index > 0 && looksLikePathArgument(word)) ?? null;
  }

  return null;
}

function inferShellSearchQuery(words: readonly string[]): string | null {
  return words.slice(1).find((word) => !word.startsWith("-")) ?? null;
}

function looksLikePathArgument(value: string): boolean {
  return value.includes("/")
    || value.startsWith(".")
    || /\.[A-Za-z0-9]+$/.test(value);
}

function splitShellWords(command: string): string[] {
  const words: string[] = [];
  const wordPattern = /"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|(\S+)/g;
  for (const match of command.matchAll(wordPattern)) {
    const word = match[1] ?? match[2] ?? match[3];
    if (word) {
      words.push(word.replace(/\\"/g, "\"").replace(/\\'/g, "'"));
    }
  }
  return words;
}

function basename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
