import type { ToolCallItem } from "@anyharness/sdk";
import { parseMcpToolName } from "@/lib/domain/chat/tools/mcp-tool-presentation";

export type SkillsToolResultPresentation =
  | SkillsListResultPresentation
  | SkillActivationResultPresentation
  | SkillResourceResultPresentation;

export interface SkillsListResultPresentation {
  kind: "list";
  skills: SkillsListEntryPresentation[];
}

export interface SkillsListEntryPresentation {
  skillId: string;
  displayName: string;
  description: string;
  requiredMcpServers: string[];
  resourceCount: number | null;
}

export interface SkillActivationResultPresentation {
  kind: "activate";
  skillId: string;
  displayName: string;
  description: string;
  instructions: string;
  requiredMcpServers: string[];
  credentialBindingIds: string[];
  resources: SkillResourceSummaryPresentation[];
}

export interface SkillResourceSummaryPresentation {
  resourceId: string;
  displayName: string | null;
  contentType: string | null;
}

export interface SkillResourceResultPresentation {
  kind: "resource";
  skillId: string;
  resourceId: string;
  displayName: string | null;
  contentType: string;
  content: string;
}

export function deriveSkillsToolResultPresentation(
  item: ToolCallItem,
  normalizedResultText: string,
): SkillsToolResultPresentation | null {
  const parsedMcp = parseMcpToolName(item.nativeToolName ?? item.title ?? "");
  if (parsedMcp?.server !== "proliferate_skills") {
    return null;
  }

  const output = coerceRecord(item.rawOutput) ?? parseJsonRecord(normalizedResultText);
  if (!output) {
    return null;
  }

  switch (parsedMcp.action) {
    case "list_available_skills":
      return deriveSkillsList(output);
    case "activate_skill":
      return deriveSkillActivation(output);
    case "get_skill_resource":
      return deriveSkillResource(output);
    default:
      return null;
  }
}

function deriveSkillsList(output: Record<string, unknown>): SkillsListResultPresentation | null {
  const skills = Array.isArray(output.skills)
    ? output.skills.flatMap((entry) => {
      const record = coerceRecord(entry);
      if (!record) return [];
      const skillId = readString(record.skillId);
      const displayName = readString(record.displayName);
      const description = readString(record.description);
      if (!skillId || !displayName || !description) return [];
      return [{
        skillId,
        displayName,
        description,
        requiredMcpServers: readStringArray(record.requiredMcpServers),
        resourceCount: readNumber(record.resourceCount),
      }];
    })
    : [];

  return { kind: "list", skills };
}

function deriveSkillActivation(
  output: Record<string, unknown>,
): SkillActivationResultPresentation | null {
  const skillId = readString(output.skillId);
  const displayName = readString(output.displayName);
  const description = readString(output.description);
  const instructions = readString(output.instructions);
  if (!skillId || !displayName || !description || !instructions) {
    return null;
  }

  const resources = Array.isArray(output.resources)
    ? output.resources.flatMap((entry) => {
      const record = coerceRecord(entry);
      if (!record) return [];
      const resourceId = readString(record.resourceId);
      if (!resourceId) return [];
      return [{
        resourceId,
        displayName: readString(record.displayName),
        contentType: readString(record.contentType),
      }];
    })
    : [];

  return {
    kind: "activate",
    skillId,
    displayName,
    description,
    instructions,
    requiredMcpServers: readStringArray(output.requiredMcpServers),
    credentialBindingIds: readStringArray(output.credentialBindingIds),
    resources,
  };
}

function deriveSkillResource(
  output: Record<string, unknown>,
): SkillResourceResultPresentation | null {
  const skillId = readString(output.skillId);
  const resourceId = readString(output.resourceId);
  const contentType = readString(output.contentType);
  const content = readString(output.content);
  if (!skillId || !resourceId || !contentType || !content) {
    return null;
  }

  return {
    kind: "resource",
    skillId,
    resourceId,
    displayName: readString(output.displayName),
    contentType,
    content,
  };
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return coerceRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function coerceRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && !!entry.trim())
    : [];
}
