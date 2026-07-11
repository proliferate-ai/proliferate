import type {
  FileChangeContentPart,
  TerminalOutputContentPart,
  ToolCallContentPart,
  ToolCallItem,
  ToolResultTextContentPart,
} from "@anyharness/sdk";
import {
  getToolCallShellCommand,
  type ParsedToolCommand,
} from "../transcript/transcript-tool-commands";
import { normalizeToolResultText } from "./tool-result-text";

export function formatSearchLabel(item: ToolCallItem): string {
  const shellCommand = getToolCallShellCommand(item);
  if (shellCommand) {
    return `Searched files with ${shellCommand}`;
  }

  const rawInput = asRecord(item.rawInput);
  const pattern = readString(rawInput?.pattern)
    ?? readString(rawInput?.query)
    ?? readString(rawInput?.q);
  const path = readString(rawInput?.path)
    ?? readString(rawInput?.glob)
    ?? readString(rawInput?.include);
  if (pattern && path) {
    return `Searched for ${pattern} in ${path}`;
  }
  if (pattern) {
    return `Searched for ${pattern}`;
  }
  return "Searched";
}

export function formatListingLabel(item: ToolCallItem): string {
  const shellCommand = getToolCallShellCommand(item);
  if (shellCommand) {
    return `Listed files with ${shellCommand}`;
  }
  return "Listed files";
}

export function formatFetchLabel(item: ToolCallItem): string {
  const rawInput = asRecord(item.rawInput);
  const url = readString(rawInput?.url) ?? readString(rawInput?.href);
  return url ? `Fetched ${url}` : "Fetched";
}

export function deriveCommand(item: ToolCallItem): string {
  const shellCommand = getToolCallShellCommand(item);
  if (shellCommand) return shellCommand;
  const rawInput = asRecord(item.rawInput);
  const command = readString(rawInput?.command) ?? readString(rawInput?.cmd);
  if (command) return command;
  if (
    item.semanticKind === "terminal"
    || item.toolKind === "execute"
    || item.nativeToolName === "Bash"
  ) {
    return "command";
  }
  const toolCallPart = item.contentParts.find(
    (part): part is ToolCallContentPart => part.type === "tool_call",
  );
  return toolCallPart?.title ?? item.title ?? item.nativeToolName ?? "command";
}

export function deriveCommandOutput(item: ToolCallItem): string {
  const terminalOutput = item.contentParts
    .filter((part): part is TerminalOutputContentPart => part.type === "terminal_output")
    .filter((part) => part.event === "output" && part.data)
    .map((part) => part.data ?? "")
    .join("");
  if (terminalOutput) {
    return terminalOutput;
  }
  const toolResultText = item.contentParts
    .filter((part): part is ToolResultTextContentPart => part.type === "tool_result_text")
    .map((part) => part.text)
    .join("\n\n");
  return normalizeToolResultText(toolResultText || (typeof item.rawOutput === "string" ? item.rawOutput : ""));
}

export function deriveGenericToolOutput(item: ToolCallItem): string {
  const toolResultText = item.contentParts
    .filter((part): part is ToolResultTextContentPart => part.type === "tool_result_text")
    .map((part) => part.text)
    .join("\n\n");
  if (toolResultText.trim()) {
    return normalizeToolResultText(toolResultText);
  }

  if (typeof item.rawOutput === "string") {
    return normalizeToolResultText(item.rawOutput);
  }

  if (item.rawOutput && typeof item.rawOutput === "object") {
    return JSON.stringify(item.rawOutput, null, 2);
  }

  return "";
}

export function deriveReadPath(item: ToolCallItem): string {
  const rawInput = asRecord(item.rawInput);
  const path = readString(rawInput?.file_path)
    ?? readString(rawInput?.path)
    ?? readString(rawInput?.url);
  return basename(path ?? item.title ?? item.nativeToolName ?? "file");
}

export function formatParsedCommandLabel(
  item: ToolCallItem,
  command: ParsedToolCommand,
): string {
  const active = item.status === "in_progress";
  const target = command.name
    ?? (command.path ? basename(command.path) : null)
    ?? command.command;

  switch (command.kind) {
    case "read":
      return `${active ? "Reading" : "Read"} ${target ?? "file"}`;
    case "listing":
      return `${active ? "Listing" : "Listed"} ${target ?? "files"}`;
    case "search": {
      const query = command.query ? ` for ${command.query}` : "";
      const scope = command.path ? ` in ${command.path}` : "";
      if (query || scope) {
        return `${active ? "Searching" : "Searched"}${query}${scope}`;
      }
      return `${active ? "Searching" : "Searched"}${command.command ? ` with ${command.command}` : ""}`;
    }
    case "fetch":
      return `${active ? "Fetching" : "Fetched"} ${target ?? "resource"}`;
    case "command":
      return formatCommandExecutionLabel(command.command ?? "command", item.status);
    case "action":
    default:
      return formatCommandExecutionLabel(command.command ?? target ?? "action", item.status);
  }
}

export function formatCommandExecutionLabel(
  command: string,
  status: ToolCallItem["status"],
): string {
  const normalizedCommand = command.trim();
  const genericCommand = !normalizedCommand
    || normalizedCommand === "command"
    || normalizedCommand === "action";
  if (status === "failed") {
    return genericCommand ? "Command failed" : `Command failed with ${normalizedCommand}`;
  }
  if (status === "in_progress") {
    return genericCommand ? "Running command" : `Running: ${normalizedCommand}`;
  }
  return genericCommand ? "Ran command" : `Ran ${normalizedCommand}`;
}

export function formatEditVerb(operation: FileChangeContentPart["operation"]): string {
  switch (operation) {
    case "create":
      return "Created";
    case "delete":
      return "Deleted";
    case "move":
      return "Moved";
    case "edit":
    default:
      return "Edited";
  }
}

export function basename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
