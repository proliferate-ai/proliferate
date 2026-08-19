import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import { FileReferenceBadge } from "#product/components/workspace/file-references/FileReferenceBadge";
import { ContentSearchPill } from "#product/components/workspace/search/ContentSearchPill";
import { WorkspaceShellActionsProvider } from "#product/components/workspace/shell/providers/WorkspaceShellActionsContext";
import { WorkspaceShellRightRail } from "#product/components/workspace/shell/screen/WorkspaceShellRightRail";
import type { WorkspaceShellActions } from "#product/hooks/workspaces/workflows/use-workspace-shell-actions";
import {
  DEFAULT_RIGHT_PANEL_HEADER_ORDER,
  DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
  MAIN_PANE_MIN_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  type RightPanelWorkspaceState,
} from "#product/lib/domain/workspaces/shell/right-panel-model";
import {
  parseViewerTargetKey,
  viewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";
import { useSearchParams } from "react-router-dom";

type FileViewerPlaygroundCase =
  | "workspace-file"
  | "desktop-file"
  | "unavailable"
  | "empty"
  | "whitespace";

interface FileReferenceScenario {
  caseName: FileViewerPlaygroundCase;
  rawPath: string;
  workspacePath?: string;
}

const WORKSPACE_FILE_PATH = "src/example.ts";

const INERT_SHELL_ACTIONS_BASE: Omit<WorkspaceShellActions, "ensureRightPanelWidth"> = {
  openTerminalPanel: () => false,
  openRightPanelTool: () => {},
  openPublishDialog: () => {},
  openPullRequest: () => {},
  workspaceWebActions: {
    disabled: true,
    disabledReason: null,
    openCurrentWorkspaceInWeb: () => {},
    title: "Open in web",
    url: null,
  },
  workspaceRemoteAccessActions: {
    disabled: true,
    handleClick: () => {},
    isEnabled: false,
    isPending: false,
    label: "Remote access",
    syncToWeb: () => {},
    syncToWebDisabledReason: null,
    title: "Remote access",
  },
};

/**
 * Deterministic file-reference route used by the browser qualification host.
 *
 * Composes exactly one production `WorkspaceShellRightRail` (its real
 * `RightPanel` owns the single `FileEditorView` -> `FileViewerFrame` ->
 * content chain — see spec "02A - Docked File Tree", "Tests and
 * qualification") inside a production-equivalent flex-row ancestor with a
 * real main-pane sibling holding the 440px `MAIN_PANE_MIN_WIDTH` floor.
 * `WorkspaceShellActionsProvider` supplies the fixture's own functional
 * `ensureRightPanelWidth`, which updates both the rail's `width` prop and the
 * ancestor's `--workspace-right-width` custom property — the outer rail
 * width is CSS-variable-driven, so updating the prop alone would not move
 * the rendered geometry the qualification suite measures.
 */
export function FileViewerPlayground() {
  const [params] = useSearchParams();
  const scenario = resolveScenario(params.get("case"), params.get("path"));
  const activeTargetKey = useWorkspaceViewerTabsStore((state) => state.activeTargetKey);
  const activeTarget = activeTargetKey ? parseViewerTargetKey(activeTargetKey) : null;
  const activeFileTarget = activeTarget?.kind === "file" ? activeTarget : null;

  const workspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const workspaceUiKey = workspaceId;

  const ancestorRef = useRef<HTMLDivElement>(null);
  const initialWidthParam = Number(params.get("railWidth"));
  const [rightPanelWidth, setRightPanelWidthState] = useState(
    Number.isFinite(initialWidthParam) && initialWidthParam > 0
      ? initialWidthParam
      : RIGHT_PANEL_DEFAULT_WIDTH,
  );

  const applyRightPanelWidth = useCallback((width: number) => {
    const clamped = Math.max(RIGHT_PANEL_MIN_WIDTH, width);
    ancestorRef.current?.style.setProperty("--workspace-right-width", `${clamped}px`);
    return clamped;
  }, []);

  useEffect(() => {
    applyRightPanelWidth(rightPanelWidth);
    // Only on mount: subsequent width changes flow through
    // `setRightPanelWidth`/`ensureRightPanelWidth` below, which update the
    // CSS var themselves in the same call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setRightPanelWidth = useCallback<Dispatch<SetStateAction<number>>>(
    (value) => {
      setRightPanelWidthState((current) => {
        const next = typeof value === "function"
          ? (value as (previous: number) => number)(current)
          : value;
        return applyRightPanelWidth(next);
      });
    },
    [applyRightPanelWidth],
  );

  // Mirror the real shell's responsive clamp. The rail element itself is
  // `min(--workspace-right-width, 100% - MAIN_PANE_MIN_WIDTH)`, but the panel
  // inside it is sized by the `width` prop, so without clamping that prop a
  // narrowed window never shrinks the file-viewer body and the dock's
  // responsive auto-collapse can never be observed.
  useEffect(() => {
    const clampToViewport = () => {
      setRightPanelWidth((current) => Math.min(
        current,
        Math.max(RIGHT_PANEL_MIN_WIDTH, window.innerWidth - MAIN_PANE_MIN_WIDTH),
      ));
    };
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, [setRightPanelWidth]);

  const ensureRightPanelWidth = useCallback(
    (minRailWidth: number) => {
      setRightPanelWidth((current) => Math.max(current, minRailWidth));
    },
    [setRightPanelWidth],
  );

  const shellActions: WorkspaceShellActions = useMemo(() => ({
    ...INERT_SHELL_ACTIONS_BASE,
    ensureRightPanelWidth,
  }), [ensureRightPanelWidth]);

  const [rightPanelState, setRightPanelState] = useState<RightPanelWorkspaceState>(
    DEFAULT_RIGHT_PANEL_WORKSPACE_STATE,
  );

  useEffect(() => {
    if (!activeFileTarget) {
      return;
    }
    const key = viewerTargetKey(activeFileTarget);
    setRightPanelState((current) => (
      current.activeEntryKey === key
        ? current
        : { activeEntryKey: key, headerOrder: [key, ...DEFAULT_RIGHT_PANEL_HEADER_ORDER] }
    ));
  }, [activeFileTarget]);

  return (
    <main
      data-telemetry-block
      data-file-reference-routing-fixture
      data-fixture-case={scenario.caseName}
      className="flex h-screen min-h-0 min-w-0 flex-col bg-background text-foreground"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-sidebar px-4 py-3">
        <span className="text-ui-sm text-muted-foreground">File reference</span>
        <FileReferenceBadge
          rawPath={scenario.rawPath}
          workspacePath={scenario.workspacePath}
          variant="chip"
        />
      </div>
      <WorkspaceShellActionsProvider value={shellActions}>
        <div
          ref={ancestorRef}
          data-workspace-shell
          data-file-reference-viewer={activeFileTarget ? "active" : "idle"}
          // `relative`: mirrors `StandardWorkspaceShell`'s own
          // `relative h-screen` root, which is `ContentSearchPill`'s nearest
          // positioned ancestor in production. Without it here, the pill's
          // `position: absolute` falls back to the viewport as its
          // containing block, and this fixture's own "File reference" debug
          // bar above this shell would throw off the 90px/16px placement math.
          className="relative flex min-h-0 min-w-0 flex-1"
          style={{ "--workspace-right-width": `${rightPanelWidth}px` } as CSSProperties}
        >
          <div
            data-main-pane
            className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-sidebar"
            style={{ minWidth: MAIN_PANE_MIN_WIDTH }}
          >
            {!activeFileTarget && (
              <span className="text-ui-sm text-muted-foreground">No file target open</span>
            )}
          </div>
          <WorkspaceShellRightRail
            visible
            open
            width={rightPanelWidth}
            onSeparatorMouseDown={() => {}}
            workspaceId={workspaceId}
            workspaceUiKey={workspaceUiKey}
            isWorkspaceReady
            isCloudWorkspaceSelected={false}
            state={rightPanelState}
            repoSettingsHref="/settings"
            onStateChange={setRightPanelState}
            terminalActivationRequest={null}
            onTerminalActivationRequestHandled={() => {}}
          />
          <ContentSearchPill
            rightPanelOpen
            rightPanelWidth={rightPanelWidth}
          />
        </div>
      </WorkspaceShellActionsProvider>
    </main>
  );
}

function resolveScenario(value: string | null, pathOverride: string | null): FileReferenceScenario {
  switch (value) {
    case "desktop-file":
      return { caseName: value, rawPath: "/outside/reference.txt" };
    case "unavailable":
      return { caseName: value, rawPath: "/outside/reference.txt" };
    case "empty":
      return { caseName: value, rawPath: "" };
    case "whitespace":
      return { caseName: value, rawPath: "   " };
    case "workspace-file":
    default: {
      // `path` lets qualification open a different deterministic workspace
      // file (long-path breadcrumb truncation, markdown rendering, search
      // matches, too-large/binary) through the same production chain without
      // a new fixture case per file.
      const path = pathOverride && pathOverride.length > 0 ? pathOverride : WORKSPACE_FILE_PATH;
      return { caseName: "workspace-file", rawPath: path, workspacePath: path };
    }
  }
}
