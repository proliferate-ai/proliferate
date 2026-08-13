import type { PropsWithChildren, ReactElement } from "react";
import { render as testingRender, type RenderResult } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { toolCallItem } from "#product/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";

export function WebProductHostWrapper({ children }: PropsWithChildren) {
  return <ProductHostProvider host={{ desktop: null } as ProductHost}>{children}</ProductHostProvider>;
}

export function renderWithProductHost(ui: ReactElement): RenderResult {
  return testingRender(ui, { wrapper: WebProductHostWrapper });
}

export function renderWithProductHostToStaticMarkup(ui: ReactElement) {
  return renderToStaticMarkup(<WebProductHostWrapper>{ui}</WebProductHostWrapper>);
}

export class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

export function buildDirectoryState(
  entriesById: Record<string, unknown>,
  promotedRootSessionIds: Set<string>,
  promotedRootWorkspaceIdBySessionId: Record<string, string | null>,
  relationshipHintsBySessionId: Record<string, unknown>,
) {
  return {
    entriesById,
    clientSessionIdByMaterializedSessionId: Object.fromEntries(
      Object.entries(entriesById).flatMap(([sessionId, entry]) => {
        const materializedSessionId = (entry as { materializedSessionId?: string })
          .materializedSessionId;
        return materializedSessionId ? [[materializedSessionId, sessionId]] : [];
      }),
    ),
    promotedRootSessionIds,
    promotedRootWorkspaceIdBySessionId,
    relationshipHintsBySessionId,
  };
}

export function workspaceTool(
  action: string,
  overrides: Parameters<typeof toolCallItem>[0] = {},
) {
  const rawInput = action === "create_agent"
    ? { workspaceId: "workspace-1", kind: "subagent", task: "Schema audit" }
    : { agentId: "agent-session-1" };
  return toolCallItem({
    nativeToolName: `mcp__workspace__${action}`,
    rawInput,
    rawOutput: agentView(),
    ...overrides,
  });
}

export function agentView(overrides: Record<string, unknown> = {}) {
  return {
    identity: { runtimeId: "runtime-1", sessionId: "agent-session-1" },
    workspace: { runtimeId: "runtime-1", workspaceId: "workspace-1" },
    role: "subagent",
    parent: { runtimeId: "runtime-1", sessionId: "parent-session" },
    title: "Schema audit",
    status: { presentation: "available", execution: "idle", hasLiveActor: true },
    configuration: { agentKind: "codex", modelId: null, modeId: null },
    capabilities: ["get_agent", "send_message"],
    createdAt: "2026-04-04T00:00:00Z",
    updatedAt: "2026-04-04T00:00:01Z",
    ...overrides,
  };
}
