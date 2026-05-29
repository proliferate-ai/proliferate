import type {
  DesktopLaunchModelRegistry as ModelRegistry,
  RuntimeAgentLaunchOptions,
} from "@/lib/domain/agents/cloud-launch-catalog";
import {
  mergeRuntimeLaunchOptionsIntoDesktopLaunchModelRegistries,
} from "@/lib/domain/agents/cloud-launch-catalog";
import type { SettingsAgentDefaultRow } from "@/lib/domain/settings/agent-defaults";

const AGENT_DEFAULT_SECTION_ORDER: readonly string[] = [
  "claude",
  "codex",
  "gemini",
  "cursor",
  "opencode",
];

export function orderSettingsAgentDefaultRows(
  rows: SettingsAgentDefaultRow[],
): SettingsAgentDefaultRow[] {
  const rank = new Map(
    AGENT_DEFAULT_SECTION_ORDER.map((kind, index) => [kind, index]),
  );
  return [...rows].sort((a, b) => {
    const leftRank = rank.get(a.kind) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(b.kind) ?? Number.MAX_SAFE_INTEGER;
    return leftRank === rightRank
      ? a.displayName.localeCompare(b.displayName)
      : leftRank - rightRank;
  });
}

export function mergeRuntimeLaunchOptionsIntoModelRegistries(
  cloudRegistries: ModelRegistry[],
  runtimeAgents: RuntimeAgentLaunchOptions[] | null,
): ModelRegistry[] {
  return mergeRuntimeLaunchOptionsIntoDesktopLaunchModelRegistries(
    cloudRegistries,
    runtimeAgents,
    { includeCloudOnlyAgents: true },
  );
}
