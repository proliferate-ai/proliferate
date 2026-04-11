import type { ToolCallItem } from "@anyharness/sdk";
import {
  formatMcpActionLabel,
  formatMcpServerHint,
  parseMcpToolName,
} from "@/lib/domain/chat/mcp-tool-presentation";

export type ToolDisplayIconKey =
  | "terminal"
  | "folder-list"
  | "file-text"
  | "file-plus"
  | "file-pen"
  | "clipboard-list"
  | "proliferate"
  | "settings";

export interface ToolCallDisplay {
  label: string;
  hint?: string;
  iconKey: ToolDisplayIconKey;
}

export function describeToolCallDisplay(
  item: ToolCallItem,
  toolName: string,
): ToolCallDisplay {
  const cleanedToolName = toolName.trim();
  const nativeName = item.nativeToolName?.trim() ?? "";
  const normalizedToolName = cleanedToolName.toLowerCase();
  const raw = isRecord(item.rawInput);
  const parsedMcp = parseMcpToolName(nativeName || cleanedToolName);

  switch (item.semanticKind) {
    case "subagent": {
      const description = readString(raw?.description) ?? undefined;
      return {
        label: "Agent task",
        hint: description
          ?? (cleanedToolName && normalizedToolName !== "agent" ? cleanedToolName : undefined),
        iconKey: "clipboard-list",
      };
    }
    case "search": {
      const pattern = readString(raw?.pattern) ?? undefined;
      return {
        label: "Search",
        hint: pattern
          ?? (cleanedToolName && normalizedToolName !== "search" ? cleanedToolName : undefined),
        iconKey: "folder-list",
      };
    }
    case "fetch":
      return {
        label: "Fetch",
        hint: cleanedToolName && normalizedToolName !== "fetch" ? cleanedToolName : undefined,
        iconKey: "settings",
      };
    case "mode_switch":
      return {
        label: "Mode change",
        hint: cleanedToolName || nativeName || undefined,
        iconKey: "settings",
      };
    case "terminal": {
      const description = readString(raw?.description) ?? undefined;
      return {
        label: description ?? "Command",
        hint: cleanedToolName || nativeName || undefined,
        iconKey: "terminal",
      };
    }
    case "file_read":
      return {
        label: "Read",
        hint: cleanedToolName && normalizedToolName !== "read" ? cleanedToolName : undefined,
        iconKey: "file-text",
      };
    case "file_change":
      return {
        label: "Changed file",
        hint: cleanedToolName && normalizedToolName !== "edit" ? cleanedToolName : undefined,
        iconKey: "file-pen",
      };
    case "cowork_artifact_create":
      return {
        label: "Create artifact",
        hint: "Cowork",
        iconKey: "proliferate",
      };
    case "cowork_artifact_update":
      return {
        label: "Update artifact",
        hint: "Cowork",
        iconKey: "proliferate",
      };
    default:
      if (parsedMcp) {
        return {
          label: formatMcpActionLabel(parsedMcp.action),
          hint: formatMcpServerHint(parsedMcp.server),
          iconKey: parsedMcp.server === "cowork" ? "proliferate" : "settings",
        };
      }
      if (nativeName && nativeName !== cleanedToolName) {
        return {
          label: nativeName,
          hint: cleanedToolName || undefined,
          iconKey: "settings",
        };
      }
      if (cleanedToolName) {
        return {
          label: cleanedToolName,
          hint: item.toolKind !== "other" ? item.toolKind : undefined,
          iconKey: "settings",
        };
      }
      return {
        label: "Tool call",
        hint: item.toolKind !== "other" ? item.toolKind : undefined,
        iconKey: "settings",
      };
  }
}

function isRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
