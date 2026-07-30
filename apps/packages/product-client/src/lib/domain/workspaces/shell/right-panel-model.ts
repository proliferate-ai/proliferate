import {
  parseViewerTargetKey,
  viewerTargetKey,
  type ViewerTarget,
  type ViewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";

export type RightPanelTool = "scratch" | "git";
export type RightPanelHeaderEntryKey =
  | `tool:${RightPanelTool}`
  | `terminal:${string}`
  | ViewerTargetKey;
export type RightPanelActiveEntryKey = RightPanelHeaderEntryKey;

export interface RightPanelDurableState {
  open: boolean;
  width: number;
}

export interface RightPanelMaterializedState {
  activeEntryKey: RightPanelActiveEntryKey;
  headerOrder: RightPanelHeaderEntryKey[];
}

export type RightPanelWorkspaceState = RightPanelMaterializedState;

export interface RightPanelTerminalRecord {
  id: string;
  purpose?: string | null;
}

export const RIGHT_PANEL_DEFAULT_WIDTH = 420;
/**
 * Narrowest width at which the panel is still itself. The floor is the header
 * chrome, not the body: the tab row must be able to show three real tabs before
 * it starts scrolling, and a right panel with a scrolling one-tab header is not
 * a panel the user can navigate. Measured against the tab metrics in
 * `product.css` (`.right-panel-tab-system`) plus the per-tab minimum observed in
 * comparable panel systems (90px before a tab truncates past recognition):
 * 3 × 90 tabs + 2 × 3px `--tab-gap` + 2 × 8px bar padding + 32px sticky
 * new-tab trigger (28px square + 4px pad) + 50px trailing action cluster
 * (6px pad + two 20px icon buttons + 4px gap) = 374px. 380 is the next clean
 * step above that floor, and still well under the ~470px a comparable right
 * panel habitually occupies, so it constrains nothing a real user wants.
 */
export const RIGHT_PANEL_MIN_WIDTH = 380;
export const RIGHT_PANEL_MAX_WIDTH = 700;
/**
 * Raw drag width below which a resize gesture stops resizing and collapses the
 * panel instead. This cannot live in `clampRightPanelWidth`: clamping's whole
 * job is to refuse widths under the minimum, so a clamped value can never
 * report the gesture that should close the panel. The 80px of travel between
 * this threshold and `RIGHT_PANEL_MIN_WIDTH` is deliberate resistance — the
 * panel sticks at its minimum first, and only a clearly intentional shove past
 * that closes it, so a user trimming the panel narrow never loses it by
 * accident.
 */
export const RIGHT_PANEL_COLLAPSE_DRAG_THRESHOLD = 300;

export type RightPanelDragOutcome =
  | { kind: "resize"; width: number }
  | { kind: "collapse" };

export const DEFAULT_RIGHT_PANEL_TOOL_ORDER: RightPanelTool[] = [
  "scratch",
  "git",
];
export const DEFAULT_RIGHT_PANEL_HEADER_ORDER: RightPanelHeaderEntryKey[] =
  DEFAULT_RIGHT_PANEL_TOOL_ORDER.map((tool) => rightPanelToolHeaderKey(tool));
export const DEFAULT_RIGHT_PANEL_DURABLE_STATE: RightPanelDurableState = {
  open: false,
  width: RIGHT_PANEL_DEFAULT_WIDTH,
};
export const DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE: RightPanelMaterializedState = {
  activeEntryKey: "tool:scratch",
  headerOrder: DEFAULT_RIGHT_PANEL_HEADER_ORDER,
};
export const DEFAULT_RIGHT_PANEL_WORKSPACE_STATE: RightPanelWorkspaceState =
  DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE;

const RIGHT_PANEL_TOOLS = new Set<RightPanelTool>(DEFAULT_RIGHT_PANEL_TOOL_ORDER);

export function rightPanelToolHeaderKey(tool: RightPanelTool): RightPanelHeaderEntryKey {
  return `tool:${tool}`;
}

export function rightPanelTerminalHeaderKey(terminalId: string): RightPanelHeaderEntryKey {
  return `terminal:${terminalId}`;
}

export function rightPanelViewerHeaderKey(target: ViewerTarget): ViewerTargetKey {
  return viewerTargetKey(target);
}

export function parseRightPanelHeaderEntryKey(
  value: unknown,
):
  | { kind: "tool"; tool: RightPanelTool }
  | { kind: "terminal"; terminalId: string }
  | { kind: "viewer"; target: ViewerTarget; targetKey: ViewerTargetKey }
  | null {
  if (typeof value !== "string") {
    return null;
  }
  if (value.startsWith("tool:")) {
    const tool = value.slice("tool:".length);
    if (isRightPanelTool(tool)) {
      return { kind: "tool", tool };
    }
    return null;
  }
  if (value.startsWith("terminal:")) {
    const terminalId = value.slice("terminal:".length);
    if (terminalId) {
      return { kind: "terminal", terminalId };
    }
    return null;
  }
  const viewerTarget = parseViewerTargetKey(value);
  if (viewerTarget) {
    return { kind: "viewer", target: viewerTarget, targetKey: viewerTargetKey(viewerTarget) };
  }
  return null;
}

export function availableRightPanelTools(_isCloudWorkspaceSelected: boolean): RightPanelTool[] {
  return DEFAULT_RIGHT_PANEL_TOOL_ORDER;
}

export function clampRightPanelWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return RIGHT_PANEL_DEFAULT_WIDTH;
  }
  return Math.min(RIGHT_PANEL_MAX_WIDTH, Math.max(RIGHT_PANEL_MIN_WIDTH, width));
}

/**
 * Decides what a raw (unclamped) drag width means for the right panel.
 *
 * Resize and collapse are two different gestures expressed through one drag, so
 * the decision has to see the width the pointer actually asked for. Above the
 * collapse threshold the width is clamped as usual — including sticking at
 * `RIGHT_PANEL_MIN_WIDTH` — and below it the panel closes.
 */
export function resolveRightPanelDragOutcome(rawWidth: number): RightPanelDragOutcome {
  if (Number.isFinite(rawWidth) && rawWidth < RIGHT_PANEL_COLLAPSE_DRAG_THRESHOLD) {
    return { kind: "collapse" };
  }
  return { kind: "resize", width: clampRightPanelWidth(rawWidth) };
}

export function normalizeRightPanelDurableState(
  input: Partial<RightPanelDurableState> | undefined,
): RightPanelDurableState {
  return {
    open: typeof input?.open === "boolean" ? input.open : DEFAULT_RIGHT_PANEL_DURABLE_STATE.open,
    width: clampRightPanelWidth(input?.width ?? DEFAULT_RIGHT_PANEL_DURABLE_STATE.width),
  };
}

export function isRightPanelTool(value: unknown): value is RightPanelTool {
  return typeof value === "string" && RIGHT_PANEL_TOOLS.has(value as RightPanelTool);
}

export function isTerminalEntryKey(entryKey: RightPanelHeaderEntryKey): boolean {
  return parseRightPanelHeaderEntryKey(entryKey)?.kind === "terminal";
}

export function terminalIdsFromHeaderOrder(
  headerOrder: readonly RightPanelHeaderEntryKey[] | undefined,
): string[] {
  const terminalIds: string[] = [];
  for (const key of headerOrder ?? []) {
    const entry = parseRightPanelHeaderEntryKey(key);
    if (entry?.kind === "terminal" && !terminalIds.includes(entry.terminalId)) {
      terminalIds.push(entry.terminalId);
    }
  }
  return terminalIds;
}

export function viewerTargetKeysFromHeaderOrder(
  headerOrder: readonly RightPanelHeaderEntryKey[] | undefined,
): ViewerTargetKey[] {
  const targetKeys: ViewerTargetKey[] = [];
  for (const key of headerOrder ?? []) {
    const entry = parseRightPanelHeaderEntryKey(key);
    if (entry?.kind === "viewer" && !targetKeys.includes(entry.targetKey)) {
      targetKeys.push(entry.targetKey);
    }
  }
  return targetKeys;
}
