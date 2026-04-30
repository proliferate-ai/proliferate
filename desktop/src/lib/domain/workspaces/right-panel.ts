export type RightPanelTool = "files" | "git" | "settings" | "terminal";

export interface RightPanelWorkspaceState {
  activeTool: RightPanelTool;
  toolOrder: RightPanelTool[];
  terminalOrder: string[];
  activeTerminalId: string | null;
}

export const RIGHT_PANEL_DEFAULT_WIDTH = 420;
export const RIGHT_PANEL_MIN_WIDTH = 260;
export const RIGHT_PANEL_MAX_WIDTH = 700;

export const DEFAULT_RIGHT_PANEL_TOOL_ORDER: RightPanelTool[] = [
  "files",
  "git",
  "settings",
];

export const DEFAULT_RIGHT_PANEL_WORKSPACE_STATE: RightPanelWorkspaceState = {
  activeTool: "git",
  toolOrder: DEFAULT_RIGHT_PANEL_TOOL_ORDER,
  terminalOrder: [],
  activeTerminalId: null,
};

const RIGHT_PANEL_TOOLS = new Set<RightPanelTool>([
  ...DEFAULT_RIGHT_PANEL_TOOL_ORDER,
  "terminal",
]);

export function availableRightPanelTools(isCloudWorkspaceSelected: boolean): RightPanelTool[] {
  return DEFAULT_RIGHT_PANEL_TOOL_ORDER.filter(
    (tool) => tool !== "settings" || isCloudWorkspaceSelected,
  );
}

export function clampRightPanelWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return RIGHT_PANEL_DEFAULT_WIDTH;
  }
  return Math.min(RIGHT_PANEL_MAX_WIDTH, Math.max(RIGHT_PANEL_MIN_WIDTH, width));
}

export function normalizeRightPanelToolOrder(
  toolOrder: readonly RightPanelTool[] | undefined,
  isCloudWorkspaceSelected: boolean,
): RightPanelTool[] {
  const availableTools = availableRightPanelTools(isCloudWorkspaceSelected);
  const availableSet = new Set(availableTools);
  const next: RightPanelTool[] = [];

  for (const tool of toolOrder ?? []) {
    if (availableSet.has(tool) && !next.includes(tool)) {
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

export function resolveRightPanelActiveTool(
  activeTool: RightPanelTool | undefined,
  toolOrder: readonly RightPanelTool[],
  activeTerminalId?: string | null,
): RightPanelTool {
  if (activeTool === "terminal" && activeTerminalId) {
    return "terminal";
  }
  if (activeTool && toolOrder.includes(activeTool)) {
    return activeTool;
  }
  if (toolOrder.includes("git")) {
    return "git";
  }
  return toolOrder[0] ?? "files";
}

export function mergeTerminalOrder(
  terminalOrder: readonly string[] | undefined,
  liveTerminalIds: readonly string[],
): string[] {
  const liveSet = new Set(liveTerminalIds);
  const next: string[] = [];

  for (const terminalId of terminalOrder ?? []) {
    if (liveSet.has(terminalId) && !next.includes(terminalId)) {
      next.push(terminalId);
    }
  }

  for (const terminalId of liveTerminalIds) {
    if (!next.includes(terminalId)) {
      next.push(terminalId);
    }
  }

  return next;
}

export function resolveActiveTerminalId(
  activeTerminalId: string | null | undefined,
  terminalOrder: readonly string[],
): string | null {
  if (activeTerminalId && terminalOrder.includes(activeTerminalId)) {
    return activeTerminalId;
  }
  return terminalOrder[0] ?? null;
}

export function reconcileRightPanelWorkspaceState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  options: {
    isCloudWorkspaceSelected: boolean;
    liveTerminalIds?: readonly string[];
  },
): RightPanelWorkspaceState {
  const toolOrder = normalizeRightPanelToolOrder(
    input?.toolOrder,
    options.isCloudWorkspaceSelected,
  );
  const terminalOrder = options.liveTerminalIds
    ? mergeTerminalOrder(input?.terminalOrder, options.liveTerminalIds)
    : uniqueStringList(input?.terminalOrder);
  const activeTerminalId = resolveActiveTerminalId(input?.activeTerminalId, terminalOrder);

  return {
    activeTool: resolveRightPanelActiveTool(input?.activeTool, toolOrder, activeTerminalId),
    toolOrder,
    terminalOrder,
    activeTerminalId,
  };
}

export function removeTerminalFromRightPanelState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  terminalId: string,
  isCloudWorkspaceSelected: boolean,
): RightPanelWorkspaceState {
  const state = reconcileRightPanelWorkspaceState(input, { isCloudWorkspaceSelected });
  const terminalOrder = state.terminalOrder.filter((id) => id !== terminalId);
  const activeTerminalId = resolveActiveTerminalId(
    state.activeTerminalId === terminalId ? null : state.activeTerminalId,
    terminalOrder,
  );
  return {
    ...state,
    terminalOrder,
    activeTerminalId,
    activeTool: resolveRightPanelActiveTool(state.activeTool, state.toolOrder, activeTerminalId),
  };
}

export function reorderTerminalInRightPanelState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  terminalId: string,
  beforeTerminalId: string | null,
  isCloudWorkspaceSelected: boolean,
): RightPanelWorkspaceState {
  const state = reconcileRightPanelWorkspaceState(input, { isCloudWorkspaceSelected });
  if (!state.terminalOrder.includes(terminalId)) {
    return state;
  }

  const remaining = state.terminalOrder.filter((id) => id !== terminalId);
  if (!beforeTerminalId || !remaining.includes(beforeTerminalId)) {
    return {
      ...state,
      terminalOrder: [...remaining, terminalId],
    };
  }

  const insertIndex = remaining.indexOf(beforeTerminalId);
  return {
    ...state,
    terminalOrder: [
      ...remaining.slice(0, insertIndex),
      terminalId,
      ...remaining.slice(insertIndex),
    ],
  };
}

export function reorderToolInRightPanelState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  tool: RightPanelTool,
  beforeTool: RightPanelTool | null,
  isCloudWorkspaceSelected: boolean,
): RightPanelWorkspaceState {
  const state = reconcileRightPanelWorkspaceState(input, { isCloudWorkspaceSelected });
  if (tool === "terminal" || !state.toolOrder.includes(tool)) {
    return state;
  }

  const remaining = state.toolOrder.filter((item) => item !== tool);
  if (!beforeTool || beforeTool === "terminal" || !remaining.includes(beforeTool)) {
    return {
      ...state,
      toolOrder: [...remaining, tool],
    };
  }

  const insertIndex = remaining.indexOf(beforeTool);
  return {
    ...state,
    toolOrder: [
      ...remaining.slice(0, insertIndex),
      tool,
      ...remaining.slice(insertIndex),
    ],
  };
}

export function isRightPanelTool(value: unknown): value is RightPanelTool {
  return typeof value === "string" && RIGHT_PANEL_TOOLS.has(value as RightPanelTool);
}

function uniqueStringList(value: readonly string[] | undefined): string[] {
  const next: string[] = [];
  for (const item of value ?? []) {
    if (typeof item === "string" && item && !next.includes(item)) {
      next.push(item);
    }
  }
  return next;
}
