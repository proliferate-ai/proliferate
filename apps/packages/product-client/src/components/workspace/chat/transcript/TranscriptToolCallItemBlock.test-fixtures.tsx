import { toolCallItem } from "#product/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";

export function workspaceTool(
  action: string,
  overrides: Parameters<typeof toolCallItem>[0] = {},
) {
  return toolCallItem({
    nativeToolName: `mcp__workspace__${action}`,
    rawInput: { agentId: "agent-1" },
    rawOutput: agentView(),
    ...overrides,
  });
}

export function agentView(overrides: Record<string, unknown> = {}) {
  return {
    identity: { runtimeId: "runtime-1", sessionId: "agent-session-1" },
    workspace: { runtimeId: "runtime-1", workspaceId: "workspace-1" },
    role: "subagent",
    title: "Schema audit",
    status: { presentation: "available", execution: "idle", hasLiveActor: true },
    ...overrides,
  };
}
