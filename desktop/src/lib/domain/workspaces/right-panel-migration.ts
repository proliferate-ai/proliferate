import {
  DEFAULT_RIGHT_PANEL_TOOL_ORDER,
  availableRightPanelTools,
  isRightPanelTool,
  normalizeRightPanelDurableState,
  normalizeRightPanelMaterializedState,
  parseRightPanelHeaderEntryKey,
  rightPanelBrowserHeaderKey,
  rightPanelTerminalHeaderKey,
  rightPanelToolHeaderKey,
  type RightPanelActiveEntryKey,
  type RightPanelBrowserTabsById,
  type RightPanelDurableState,
  type RightPanelHeaderEntryKey,
  type RightPanelMaterializedState,
  type RightPanelTool,
} from "@/lib/domain/workspaces/right-panel";

export function migrateLegacyRightPanelWorkspaceState(args: {
  state: unknown;
  width: unknown;
  isCloudWorkspaceSelected: boolean;
}): {
  durableState: RightPanelDurableState;
  materializedState: RightPanelMaterializedState;
} {
  const rawState = isRecord(args.state) ? args.state : {};
  const headerOrder = Array.isArray(rawState.headerOrder)
    ? uniqueLegacyHeaderEntries(rawState.headerOrder)
    : [];
  const toolOrder = Array.isArray(rawState.toolOrder)
    ? uniqueRightPanelTools(rawState.toolOrder)
    : [];
  const terminalOrder = Array.isArray(rawState.terminalOrder)
    ? uniqueStringList(rawState.terminalOrder)
    : [];
  const activeTerminalId = typeof rawState.activeTerminalId === "string"
    ? rawState.activeTerminalId
    : null;
  const activeTool = isRightPanelTool(rawState.activeTool) || rawState.activeTool === "terminal"
    ? rawState.activeTool
    : null;
  const legacyToolOrder = headerOrder.length > 0
    ? toolOrder
    : completeAvailableToolOrder(toolOrder, args.isCloudWorkspaceSelected);
  const reconstructedHeaderOrder = [
    ...headerOrder,
    ...legacyToolOrder.map((tool) => rightPanelToolHeaderKey(tool)),
    ...terminalOrder.map((terminalId) => rightPanelTerminalHeaderKey(terminalId)),
  ];
  if (activeTerminalId) {
    reconstructedHeaderOrder.push(rightPanelTerminalHeaderKey(activeTerminalId));
  }

  const activeEntryKey = resolveLegacyActiveEntryKey({
    activeEntryKey: rawState.activeEntryKey,
    activeTool,
    activeTerminalId,
  });
  const durableState = normalizeRightPanelDurableState({
    open: false,
    width: typeof args.width === "number" ? args.width : undefined,
  });
  const materializedState = normalizeRightPanelMaterializedState(
    {
      activeEntryKey,
      headerOrder: reconstructedHeaderOrder,
      browserTabsById: isRecord(rawState.browserTabsById)
        ? rawState.browserTabsById as RightPanelBrowserTabsById
        : {},
    },
    { isCloudWorkspaceSelected: args.isCloudWorkspaceSelected },
  );

  return { durableState, materializedState };
}

function resolveLegacyActiveEntryKey(input: {
  activeEntryKey: unknown;
  activeTool: RightPanelTool | "terminal" | null;
  activeTerminalId: string | null;
}): RightPanelActiveEntryKey | undefined {
  const parsed = parseRightPanelHeaderEntryKey(input.activeEntryKey);
  if (parsed) {
    return input.activeEntryKey as RightPanelActiveEntryKey;
  }
  if (input.activeTool === "terminal" && input.activeTerminalId) {
    return rightPanelTerminalHeaderKey(input.activeTerminalId);
  }
  if (input.activeTool && input.activeTool !== "terminal") {
    return rightPanelToolHeaderKey(input.activeTool);
  }
  return undefined;
}

function uniqueLegacyHeaderEntries(value: readonly unknown[]): RightPanelHeaderEntryKey[] {
  const next: RightPanelHeaderEntryKey[] = [];
  for (const item of value) {
    const entry = parseRightPanelHeaderEntryKey(item);
    if (!entry) {
      continue;
    }
    const key = entry.kind === "tool"
      ? rightPanelToolHeaderKey(entry.tool)
      : entry.kind === "terminal"
        ? rightPanelTerminalHeaderKey(entry.terminalId)
        : rightPanelBrowserHeaderKey(entry.browserId);
    if (!next.includes(key)) {
      next.push(key);
    }
  }
  return next;
}

function uniqueRightPanelTools(value: readonly unknown[]): RightPanelTool[] {
  const next: RightPanelTool[] = [];
  for (const item of value) {
    if (isRightPanelTool(item) && !next.includes(item)) {
      next.push(item);
    }
  }
  return next.length > 0 ? next : DEFAULT_RIGHT_PANEL_TOOL_ORDER;
}

function completeAvailableToolOrder(
  toolOrder: readonly RightPanelTool[],
  isCloudWorkspaceSelected: boolean,
): RightPanelTool[] {
  const availableTools = availableRightPanelTools(isCloudWorkspaceSelected);
  const next: RightPanelTool[] = [];
  for (const tool of toolOrder) {
    if (availableTools.includes(tool) && !next.includes(tool)) {
      next.push(tool);
    }
  }
  for (const tool of availableTools) {
    if (!next.includes(tool)) {
      next.push(tool);
    }
  }
  return next;
}

function uniqueStringList(value: readonly unknown[]): string[] {
  const next: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item && !next.includes(item)) {
      next.push(item);
    }
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
