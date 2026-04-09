import type { WorkspaceSessionLaunchAgent } from "@anyharness/sdk";

const CHAT_LAUNCH_PROVIDER_ORDER = [
  "claude",
  "codex",
  "cursor",
  "gemini",
  "opencode",
  "amp",
] as const;

const PROVIDER_ORDER_INDEX = new Map<string, number>(
  CHAT_LAUNCH_PROVIDER_ORDER.map((kind, index) => [kind, index]),
);

export function compareChatLaunchKinds(
  leftKind: string,
  rightKind: string,
  leftDisplayName: string,
  rightDisplayName: string,
) {
  const leftIndex = PROVIDER_ORDER_INDEX.get(leftKind) ?? Number.MAX_SAFE_INTEGER;
  const rightIndex = PROVIDER_ORDER_INDEX.get(rightKind) ?? Number.MAX_SAFE_INTEGER;
  if (leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }

  return leftDisplayName.localeCompare(rightDisplayName);
}

export function shouldExposeChatLaunchAgent(agent: WorkspaceSessionLaunchAgent): boolean {
  return agent.models.length > 0;
}

export function orderChatLaunchAgents(
  agents: WorkspaceSessionLaunchAgent[],
): WorkspaceSessionLaunchAgent[] {
  return [...agents].sort((left, right) => {
    return compareChatLaunchKinds(
      left.kind,
      right.kind,
      left.displayName,
      right.displayName,
    );
  });
}
