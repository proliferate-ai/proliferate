export type RightPanelTool = "files" | "git" | "terminal" | "settings";
export type RightPanelHeaderTool = RightPanelTool;
export type RightPanelHeaderEntryKey = `tool:${RightPanelTool}`;
export type RightPanelActiveEntryKey = RightPanelHeaderEntryKey;

export interface RightPanelDurableState {
  open: boolean;
  width: number;
  toolOrder: RightPanelTool[];
}

export interface RightPanelMaterializedState {
  activeEntryKey: RightPanelActiveEntryKey;
  headerOrder: RightPanelHeaderEntryKey[];
  terminalOrder: string[];
  activeTerminalId: string | null;
}

export interface RightPanelWorkspaceState {
  activeTool: RightPanelTool;
  toolOrder: RightPanelTool[];
  terminalOrder: string[];
  headerOrder: RightPanelHeaderEntryKey[];
  activeTerminalId: string | null;
}

export const RIGHT_PANEL_DEFAULT_WIDTH = 420;
export const RIGHT_PANEL_MIN_WIDTH = 260;
export const RIGHT_PANEL_MAX_WIDTH = 700;

export const DEFAULT_RIGHT_PANEL_TOOL_ORDER: RightPanelTool[] = [
  "files",
  "git",
  "terminal",
  "settings",
];
export const DEFAULT_RIGHT_PANEL_HEADER_ORDER: RightPanelHeaderEntryKey[] =
  DEFAULT_RIGHT_PANEL_TOOL_ORDER.map((tool) => rightPanelToolHeaderKey(tool));
export const DEFAULT_RIGHT_PANEL_DURABLE_STATE: RightPanelDurableState = {
  open: true,
  width: RIGHT_PANEL_DEFAULT_WIDTH,
  toolOrder: DEFAULT_RIGHT_PANEL_TOOL_ORDER,
};
export const DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE: RightPanelMaterializedState = {
  activeEntryKey: "tool:terminal",
  headerOrder: DEFAULT_RIGHT_PANEL_HEADER_ORDER,
  terminalOrder: [],
  activeTerminalId: null,
};

export const DEFAULT_RIGHT_PANEL_WORKSPACE_STATE: RightPanelWorkspaceState = {
  activeTool: "terminal",
  toolOrder: DEFAULT_RIGHT_PANEL_TOOL_ORDER,
  terminalOrder: [],
  headerOrder: DEFAULT_RIGHT_PANEL_HEADER_ORDER,
  activeTerminalId: null,
};

const RIGHT_PANEL_TOOLS = new Set<RightPanelTool>(DEFAULT_RIGHT_PANEL_TOOL_ORDER);

export function rightPanelToolHeaderKey(tool: RightPanelTool): RightPanelHeaderEntryKey {
  return `tool:${tool}`;
}

export function parseRightPanelHeaderEntryKey(
  value: unknown,
): { kind: "tool"; tool: RightPanelTool } | null {
  if (typeof value !== "string" || !value.startsWith("tool:")) {
    return null;
  }
  const tool = value.slice("tool:".length);
  if (isRightPanelTool(tool)) {
    return { kind: "tool", tool };
  }
  return null;
}

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
  toolOrder: unknown,
  isCloudWorkspaceSelected: boolean,
): RightPanelTool[] {
  const availableTools = availableRightPanelTools(isCloudWorkspaceSelected);
  const availableSet = new Set(availableTools);
  const next: RightPanelTool[] = [];

  for (const tool of arrayValue(toolOrder)) {
    if (isRightPanelTool(tool) && availableSet.has(tool) && !next.includes(tool)) {
      next.push(tool);
    }
  }

  for (const tool of availableTools) {
    if (next.includes(tool)) {
      continue;
    }
    if (tool === "terminal") {
      const settingsIndex = next.indexOf("settings");
      if (settingsIndex >= 0) {
        next.splice(settingsIndex, 0, tool);
        continue;
      }
    }
    next.push(tool);
  }

  return next;
}

export function resolveRightPanelActiveTool(
  activeTool: RightPanelTool | undefined,
  toolOrder: readonly RightPanelTool[],
): RightPanelTool {
  if (activeTool && toolOrder.includes(activeTool)) {
    return activeTool;
  }
  if (toolOrder.includes("terminal")) {
    return "terminal";
  }
  if (toolOrder.includes("git")) {
    return "git";
  }
  return toolOrder[0] ?? "files";
}

export function mergeTerminalOrder(
  terminalOrder: unknown,
  liveTerminalIds: readonly string[],
): string[] {
  const liveSet = new Set(liveTerminalIds);
  const next: string[] = [];

  for (const terminalId of uniqueStringList(terminalOrder)) {
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

export function normalizeRightPanelDurableState(
  input: Partial<RightPanelDurableState> | undefined,
  isCloudWorkspaceSelected: boolean,
): RightPanelDurableState {
  return {
    open: typeof input?.open === "boolean" ? input.open : DEFAULT_RIGHT_PANEL_DURABLE_STATE.open,
    width: clampRightPanelWidth(input?.width ?? DEFAULT_RIGHT_PANEL_DURABLE_STATE.width),
    toolOrder: normalizeRightPanelToolOrder(input?.toolOrder, isCloudWorkspaceSelected),
  };
}

export function resolveFallbackRightPanelActiveEntryKey(
  toolOrder: readonly RightPanelTool[],
): RightPanelActiveEntryKey {
  if (toolOrder.includes("terminal")) {
    return "tool:terminal";
  }
  if (toolOrder.includes("git")) {
    return "tool:git";
  }
  return toolOrder[0] ? rightPanelToolHeaderKey(toolOrder[0]) : "tool:files";
}

export function normalizeRightPanelMaterializedState(
  input: Partial<RightPanelMaterializedState> | undefined,
  durableState: RightPanelDurableState,
  options?: {
    liveTerminalIds?: readonly string[];
  },
): RightPanelMaterializedState {
  const terminalOrderHints = [
    ...terminalIdsFromLegacyHeaderOrder(input?.headerOrder),
    ...(input?.terminalOrder ?? []),
  ];
  const terminalOrder = options?.liveTerminalIds
    ? mergeTerminalOrder(terminalOrderHints, options.liveTerminalIds)
    : uniqueStringList(terminalOrderHints);
  const activeEntryTerminalId = legacyTerminalIdFromHeaderKey(input?.activeEntryKey);
  const activeTerminalId = resolveActiveTerminalId(
    input?.activeTerminalId ?? activeEntryTerminalId,
    terminalOrder,
  );
  const activeEntryKey = resolveRightPanelActiveEntryKey(
    input?.activeEntryKey,
    durableState.toolOrder,
    terminalOrder,
  );

  return {
    activeEntryKey,
    headerOrder: deriveRightPanelHeaderOrder(durableState.toolOrder),
    terminalOrder,
    activeTerminalId,
  };
}

export function mergeRightPanelState(args: {
  durableState: Partial<RightPanelDurableState> | undefined;
  materializedState: Partial<RightPanelMaterializedState> | undefined;
  isCloudWorkspaceSelected: boolean;
  liveTerminalIds?: readonly string[];
}): RightPanelWorkspaceState {
  const durableState = normalizeRightPanelDurableState(
    args.durableState,
    args.isCloudWorkspaceSelected,
  );
  const materializedState = normalizeRightPanelMaterializedState(
    args.materializedState,
    durableState,
    { liveTerminalIds: args.liveTerminalIds },
  );
  const activeEntry = parseRightPanelHeaderEntryKey(materializedState.activeEntryKey);

  return {
    activeTool: activeEntry?.tool ?? resolveRightPanelActiveTool(undefined, durableState.toolOrder),
    toolOrder: durableState.toolOrder,
    terminalOrder: materializedState.terminalOrder,
    headerOrder: materializedState.headerOrder,
    activeTerminalId: materializedState.activeTerminalId,
  };
}

export function splitLegacyRightPanelWorkspaceState(args: {
  state: Partial<RightPanelWorkspaceState> | undefined;
  width: number | undefined;
  isCloudWorkspaceSelected: boolean;
}): {
  durableState: RightPanelDurableState;
  materializedState: RightPanelMaterializedState;
} {
  const legacyHeaderOrder = args.state?.headerOrder;
  const toolOrderHints = [
    ...toolsFromHeaderOrder(legacyHeaderOrder),
    ...toolsFromToolOrder(args.state?.toolOrder),
  ];
  const durableState = normalizeRightPanelDurableState(
    {
      open: false,
      width: args.width ?? RIGHT_PANEL_DEFAULT_WIDTH,
      toolOrder: normalizeLegacyToolOrderWithTerminalPosition(
        legacyHeaderOrder,
        toolOrderHints,
        args.isCloudWorkspaceSelected,
      ),
    },
    args.isCloudWorkspaceSelected,
  );
  const terminalOrderHints = [
    ...terminalIdsFromLegacyHeaderOrder(legacyHeaderOrder),
    ...uniqueStringList(args.state?.terminalOrder),
  ];
  const terminalOrder = uniqueStringList(terminalOrderHints);
  const activeTerminalId = resolveActiveTerminalId(
    args.state?.activeTerminalId
      ?? legacyTerminalIdFromHeaderKey((args.state as { activeEntryKey?: unknown } | undefined)?.activeEntryKey),
    terminalOrder,
  );
  const activeTool = resolveRightPanelActiveTool(args.state?.activeTool, durableState.toolOrder);
  const activeEntryKey = activeTool === "terminal"
    ? "tool:terminal"
    : rightPanelToolHeaderKey(activeTool);
  const materializedState = normalizeRightPanelMaterializedState(
    {
      activeEntryKey,
      headerOrder: legacyHeaderOrder,
      terminalOrder,
      activeTerminalId,
    },
    durableState,
  );

  return { durableState, materializedState };
}

export function reconcileRightPanelWorkspaceState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  options: {
    isCloudWorkspaceSelected: boolean;
    liveTerminalIds?: readonly string[];
  },
): RightPanelWorkspaceState {
  const toolOrderHints = [
    ...toolsFromHeaderOrder(input?.headerOrder),
    ...toolsFromToolOrder(input?.toolOrder),
  ];
  const toolOrder = normalizeRightPanelToolOrder(
    toolOrderHints,
    options.isCloudWorkspaceSelected,
  );
  const terminalOrderHints = [
    ...terminalIdsFromLegacyHeaderOrder(input?.headerOrder),
    ...uniqueStringList(input?.terminalOrder),
  ];
  const terminalOrder = options.liveTerminalIds
    ? mergeTerminalOrder(terminalOrderHints, options.liveTerminalIds)
    : uniqueStringList(terminalOrderHints);
  const activeTerminalId = resolveActiveTerminalId(
    input?.activeTerminalId,
    terminalOrder,
  );
  const activeTool = resolveRightPanelActiveTool(input?.activeTool, toolOrder);

  return {
    activeTool,
    toolOrder,
    terminalOrder,
    headerOrder: deriveRightPanelHeaderOrder(toolOrder),
    activeTerminalId,
  };
}

function resolveRightPanelActiveEntryKey(
  input: unknown,
  toolOrder: readonly RightPanelTool[],
  terminalOrder: readonly string[],
): RightPanelActiveEntryKey {
  const parsed = parseRightPanelHeaderEntryKey(input);
  if (parsed?.kind === "tool" && toolOrder.includes(parsed.tool)) {
    return rightPanelToolHeaderKey(parsed.tool);
  }
  const legacyTerminalId = legacyTerminalIdFromHeaderKey(input);
  if (legacyTerminalId && terminalOrder.includes(legacyTerminalId) && toolOrder.includes("terminal")) {
    return "tool:terminal";
  }
  return resolveFallbackRightPanelActiveEntryKey(toolOrder);
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
    activeTool: resolveRightPanelActiveTool(state.activeTool, state.toolOrder),
  };
}

export function reorderHeaderEntryInRightPanelState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  entryKey: RightPanelHeaderEntryKey,
  beforeEntryKey: RightPanelHeaderEntryKey | null,
  isCloudWorkspaceSelected: boolean,
): RightPanelWorkspaceState {
  const entry = parseRightPanelHeaderEntryKey(entryKey);
  const beforeEntry = beforeEntryKey ? parseRightPanelHeaderEntryKey(beforeEntryKey) : null;
  if (!entry || (beforeEntryKey && !beforeEntry)) {
    return reconcileRightPanelWorkspaceState(input, { isCloudWorkspaceSelected });
  }
  return reorderToolInRightPanelState(
    input,
    entry.tool,
    beforeEntry?.tool ?? null,
    isCloudWorkspaceSelected,
  );
}

export function reorderTerminalInRightPanelState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  terminalId: string,
  beforeTerminalId: string | null,
  isCloudWorkspaceSelected: boolean,
): RightPanelWorkspaceState {
  const state = reconcileRightPanelWorkspaceState(input, { isCloudWorkspaceSelected });
  if (!state.terminalOrder.includes(terminalId) || beforeTerminalId === terminalId) {
    return state;
  }

  const remaining = state.terminalOrder.filter((id) => id !== terminalId);
  const insertIndex = beforeTerminalId ? remaining.indexOf(beforeTerminalId) : -1;
  const terminalOrder = insertIndex >= 0
    ? [
        ...remaining.slice(0, insertIndex),
        terminalId,
        ...remaining.slice(insertIndex),
      ]
    : [...remaining, terminalId];

  return {
    ...state,
    terminalOrder,
  };
}

export function reorderToolInRightPanelState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  tool: RightPanelTool,
  beforeTool: RightPanelTool | null,
  isCloudWorkspaceSelected: boolean,
): RightPanelWorkspaceState {
  const state = reconcileRightPanelWorkspaceState(input, { isCloudWorkspaceSelected });
  if (!state.toolOrder.includes(tool) || beforeTool === tool) {
    return state;
  }

  const remaining = state.toolOrder.filter((entry) => entry !== tool);
  const insertIndex = beforeTool ? remaining.indexOf(beforeTool) : -1;
  const toolOrder = normalizeRightPanelToolOrder(
    insertIndex >= 0
      ? [
          ...remaining.slice(0, insertIndex),
          tool,
          ...remaining.slice(insertIndex),
        ]
      : [...remaining, tool],
    isCloudWorkspaceSelected,
  );

  return {
    ...state,
    toolOrder,
    headerOrder: deriveRightPanelHeaderOrder(toolOrder),
    activeTool: resolveRightPanelActiveTool(state.activeTool, toolOrder),
  };
}

export function isRightPanelTool(value: unknown): value is RightPanelTool {
  return typeof value === "string" && RIGHT_PANEL_TOOLS.has(value as RightPanelTool);
}

function uniqueStringList(value: unknown): string[] {
  const next: string[] = [];
  for (const item of arrayValue(value)) {
    if (typeof item === "string" && item && !next.includes(item)) {
      next.push(item);
    }
  }
  return next;
}

function deriveRightPanelHeaderOrder(
  toolOrder: readonly RightPanelTool[],
): RightPanelHeaderEntryKey[] {
  return toolOrder.map((tool) => rightPanelToolHeaderKey(tool));
}

function normalizeLegacyToolOrderWithTerminalPosition(
  headerOrder: unknown,
  toolOrderHints: readonly RightPanelTool[],
  isCloudWorkspaceSelected: boolean,
): RightPanelTool[] {
  const normalizedWithoutTerminal = normalizeRightPanelToolOrder(
    toolOrderHints.filter((tool) => tool !== "terminal"),
    isCloudWorkspaceSelected,
  ).filter((tool) => tool !== "terminal") as RightPanelTool[];
  const firstTerminalIndex = findFirstLegacyTerminalHeaderIndex(headerOrder);
  if (firstTerminalIndex < 0) {
    return normalizeRightPanelToolOrder(toolOrderHints, isCloudWorkspaceSelected);
  }

  const toolsBeforeTerminal = toolsFromHeaderOrder(
    arrayValue(headerOrder).slice(0, firstTerminalIndex),
  );
  let insertIndex = 0;
  for (const tool of toolsBeforeTerminal) {
    if (tool === "terminal") {
      continue;
    }
    const toolIndex = normalizedWithoutTerminal.indexOf(tool);
    if (toolIndex >= 0) {
      insertIndex = Math.max(insertIndex, toolIndex + 1);
    }
  }
  const next = [...normalizedWithoutTerminal];
  next.splice(insertIndex, 0, "terminal");
  return normalizeRightPanelToolOrder(next, isCloudWorkspaceSelected);
}

function findFirstLegacyTerminalHeaderIndex(headerOrder: unknown): number {
  return arrayValue(headerOrder)
    .findIndex((key) => legacyTerminalIdFromHeaderKey(key) !== null);
}

function toolsFromHeaderOrder(
  headerOrder: unknown,
): RightPanelTool[] {
  const tools: RightPanelTool[] = [];
  for (const key of arrayValue(headerOrder)) {
    const entry = parseRightPanelHeaderEntryKey(key);
    if (entry?.kind === "tool" && !tools.includes(entry.tool)) {
      tools.push(entry.tool);
    }
  }
  return tools;
}

function toolsFromToolOrder(toolOrder: unknown): RightPanelTool[] {
  const tools: RightPanelTool[] = [];
  for (const tool of arrayValue(toolOrder)) {
    if (isRightPanelTool(tool) && !tools.includes(tool)) {
      tools.push(tool);
    }
  }
  return tools;
}

function terminalIdsFromLegacyHeaderOrder(
  headerOrder: unknown,
): string[] {
  const terminalIds: string[] = [];
  for (const key of arrayValue(headerOrder)) {
    const terminalId = legacyTerminalIdFromHeaderKey(key);
    if (terminalId && !terminalIds.includes(terminalId)) {
      terminalIds.push(terminalId);
    }
  }
  return terminalIds;
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function legacyTerminalIdFromHeaderKey(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("terminal:")) {
    return null;
  }
  const terminalId = value.slice("terminal:".length);
  return terminalId || null;
}
