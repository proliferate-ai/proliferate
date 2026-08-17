import { isWorkflowsV2Enabled } from "#product/lib/domain/capabilities/workflows-v2";
import {
  parseViewerTargetKey,
  viewerTargetKey,
  type ViewerTarget,
  type ViewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";

export type RightPanelTool = "scratch" | "git" | "agents" | "background" | "workflow";
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
/**
 * Fallback drag ceiling for contexts where the shell geometry cannot be
 * measured (no rendered rail, tests). It is not the policy maximum: the panel
 * may take everything the window affords — an arbitrary window width, minus
 * the sidebar at its current width (zero when folded), minus the chat pane's
 * `MAIN_PANE_MIN_WIDTH` floor. The drag measures that ceiling from the rail's
 * row at mousedown, and the rail's rendered width enforces the same bound in
 * CSS when the window shrinks afterwards.
 */
export const RIGHT_PANEL_FALLBACK_MAX_WIDTH = 700;
/**
 * Floor the main (chat) pane keeps against the right rail. The rail's
 * rendered width is clamped so the pane never drops below this, whatever the
 * persisted panel width, sidebar width, and window size add up to — without
 * it, a wide panel on a small window squeezes the pane toward zero and the
 * composer controls paint over each other. 440 = the composer's compact
 * control tier (see `chat-layout.ts`) at its natural width — every pill at
 * content size, the model name untruncated, the inter-pill rhythm intact —
 * plus the chat column gutter, so minimizing the pane never compresses the
 * control row's spacing. The same floor bounds how far a resize drag can
 * widen the panel. The persisted width is deliberately not clamped: the
 * user's chosen panel width comes back as soon as the window affords it.
 */
export const MAIN_PANE_MIN_WIDTH = 440;
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

/**
 * The always-available tools, in their default header order. The gen-2
 * workflow tool is deliberately absent: it is launch-gated, and
 * `availableRightPanelTools` is the one place that decides whether it exists.
 */
export const DEFAULT_RIGHT_PANEL_TOOL_ORDER: RightPanelTool[] = [
  "scratch",
  "git",
  "agents",
  "background",
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

/**
 * Every tool key that is a *legal* key, availability aside. Parsing has to
 * recognise `tool:workflow` even where the tool is not offered — a header
 * order persisted by a gate-on build is read back by a gate-off build, and a
 * key that fails to parse is indistinguishable from corruption. Availability
 * (below) is what drops it from the order; parsing only decides what the
 * string means.
 */
const ALL_RIGHT_PANEL_TOOLS: RightPanelTool[] = [
  ...DEFAULT_RIGHT_PANEL_TOOL_ORDER,
  "workflow",
];

const RIGHT_PANEL_TOOLS = new Set<RightPanelTool>(ALL_RIGHT_PANEL_TOOLS);

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

/**
 * Which tools this workspace's header may carry.
 *
 * The gen-2 workflow tool rides the launch gate, which is a build-time
 * constant rather than a per-workspace fact — so it belongs here, where every
 * reader of the header order (normalization, migration, the header strip)
 * agrees about it at once. The *run-scoped* half of the workflow tool's
 * visibility (does this workspace actually have a run?) is not here: it
 * changes while the panel is open, and stripping a persisted key on every poll
 * would churn the stored order. That half filters the rendered header entry
 * instead — see `useRightPanelHeaderEntries`.
 *
 * The gate is a defaulted argument rather than a call inside the body so this
 * stays a pure function of its inputs for tests that pass it explicitly.
 */
export function availableRightPanelTools(
  _isCloudWorkspaceSelected: boolean,
  workflowsV2Enabled: boolean = isWorkflowsV2Enabled(),
): RightPanelTool[] {
  // The execution tab leads the strip: a workspace that carries a workflow
  // run reads run-first, the same order the workflows design settles on. An
  // already-persisted header order keeps its stored positions — normalization
  // only appends tools it finds missing — so this order is what a fresh
  // workspace starts from, not a migration.
  return workflowsV2Enabled
    ? ["workflow", ...DEFAULT_RIGHT_PANEL_TOOL_ORDER]
    : DEFAULT_RIGHT_PANEL_TOOL_ORDER;
}

/** What a runs list's current state says about the workflow tool. */
export interface WorkflowToolAvailability {
  /** Whether the header renders the workflow tool entry. */
  showTab: boolean;
  /**
   * What normalization reconciles an active `tool:workflow` entry against.
   * `undefined` means "not known yet — leave the active entry alone".
   */
  activeEntryAvailability: boolean | undefined;
}

/**
 * The run-scoped half of the gen-2 workflow tool's visibility, read off the
 * runs list's own loading state (`availableRightPanelTools` above owns the
 * build-gate half).
 *
 * Two answers, deliberately different, because a list that has not settled is
 * not evidence of anything:
 * - `showTab` — a settled empty list hides the tool, but an unsettled one keeps
 *   it while the user is standing on it, so the loading tick during boot never
 *   strips the tab out from under a pane that is rendering.
 * - `activeEntryAvailability` — `undefined` while unsettled leaves the active
 *   entry exactly where it is; `false` once a settled list (success *or* error)
 *   shows no run retires an active workflow entry through the same fallback the
 *   launch gate uses. Never touches the persisted header order: a run appearing
 *   or finishing must not rewrite the user's stored header.
 */
export function resolveWorkflowToolAvailability(input: {
  runsSettled: boolean;
  hasRun: boolean;
  isActiveTool: boolean;
}): WorkflowToolAvailability {
  if (!input.runsSettled) {
    return {
      showTab: input.hasRun || input.isActiveTool,
      activeEntryAvailability: undefined,
    };
  }
  return { showTab: input.hasRun, activeEntryAvailability: input.hasRun };
}

/**
 * Clamps to the panel's floor and an optional ceiling. The default ceiling is
 * unbounded: persistence and restore keep a width chosen on a larger window,
 * and the rail's rendered width bounds what actually paints per window. Only
 * a live drag passes its measured ceiling here.
 */
export function clampRightPanelWidth(
  width: number,
  maxWidth: number = Number.POSITIVE_INFINITY,
): number {
  if (!Number.isFinite(width)) {
    return RIGHT_PANEL_DEFAULT_WIDTH;
  }
  // A ceiling below the floor (a degenerately small window) pins to the floor.
  const effectiveMax = Math.max(RIGHT_PANEL_MIN_WIDTH, maxWidth);
  return Math.min(effectiveMax, Math.max(RIGHT_PANEL_MIN_WIDTH, width));
}

/**
 * Decides what a raw (unclamped) drag width means for the right panel.
 *
 * Resize and collapse are two different gestures expressed through one drag, so
 * the decision has to see the width the pointer actually asked for. Above the
 * collapse threshold the width is clamped as usual — including sticking at
 * `RIGHT_PANEL_MIN_WIDTH` and at the caller-measured `maxWidth` ceiling — and
 * below it the panel closes, but only while the gesture is actually shrinking:
 * the floor clamp can render the rail below the threshold, and a drag seeded
 * from that rendered width must not close the panel the user is trying to
 * widen, so a sub-threshold raw width that sits at or above `startWidth` is a
 * resize.
 */
export function resolveRightPanelDragOutcome(
  rawWidth: number,
  maxWidth: number = Number.POSITIVE_INFINITY,
  startWidth: number = Number.POSITIVE_INFINITY,
): RightPanelDragOutcome {
  if (
    Number.isFinite(rawWidth)
    && rawWidth < RIGHT_PANEL_COLLAPSE_DRAG_THRESHOLD
    && rawWidth < startWidth
  ) {
    return { kind: "collapse" };
  }
  return { kind: "resize", width: clampRightPanelWidth(rawWidth, maxWidth) };
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
