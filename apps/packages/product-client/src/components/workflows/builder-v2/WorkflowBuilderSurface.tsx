import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import { useRepoRootsQuery } from "@anyharness/sdk-react";
import type { WorkflowNodeV2 } from "@proliferate/cloud-sdk";
import type { WorkflowStarterTemplateV2 } from "#product/config/workflows/starter-templates";
import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import { WORKFLOW_MAIN_COPY } from "#product/copy/workflows/workflow-main-copy";
import { useCloudLaunchModelRegistries } from "#product/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useWorkflowDefinitionV2MutationsAccess } from "#product/hooks/access/cloud/workflows/use-workflow-definitions-v2-access";
import { useWorkflowBuilder, type WorkflowBuilderDraft } from "#product/hooks/workflows/facade/use-workflow-builder";
import { workflowBuilderHarnessOptions } from "#product/lib/domain/workflows/workflow-builder-authoring";
import { workflowRepoRootOptions } from "#product/lib/domain/workflows/workflow-repo-root-options";
import { WorkflowBuilderChainCanvas } from "#product/components/workflows/builder-v2/WorkflowBuilderChainCanvas";
import { WorkflowBuilderDetailsCard } from "#product/components/workflows/builder-v2/WorkflowBuilderDetailsCard";
import { WorkflowBuilderDocInspector } from "#product/components/workflows/builder-v2/WorkflowBuilderDocInspector";
import { WorkflowBuilderInputsPanel } from "#product/components/workflows/builder-v2/WorkflowBuilderInputsPanel";
import { WorkflowBuilderNodeInspector } from "#product/components/workflows/builder-v2/WorkflowBuilderNodeInspector";
import { WorkflowBuilderRail } from "#product/components/workflows/builder-v2/WorkflowBuilderRail";
import { WorkflowMainDeleteDialog } from "#product/components/workflows/main/WorkflowMainDeleteDialog";
import { WorkflowResourceState } from "#product/components/workflows/WorkflowResourceState";
import { WorkspaceResizeSeparator } from "#product/components/workspace/shell/screen/WorkspaceResizeSeparator";
import { useResize } from "#product/hooks/ui/layout/use-resize";
import { Check, ChevronRight } from "#product/primitives/icons/core";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";

const BUILDER_RAIL_DEFAULT_WIDTH = 184;
const BUILDER_RAIL_COLLAPSED_WIDTH = 52;
const BUILDER_RAIL_SNAP_WIDTH = 100;
const BUILDER_RAIL_MIN_WIDE_WIDTH = 100;
const BUILDER_RAIL_MAX_WIDTH = 340;
const BUILDER_INSPECTOR_DEFAULT_WIDTH = 312;
const BUILDER_INSPECTOR_MIN_WIDTH = 232;
const BUILDER_INSPECTOR_MAX_WIDTH = 520;
/** Keep the graph viewport useful while either adjacent pane is widened. */
const BUILDER_CANVAS_MIN_WIDTH = 280;

export interface WorkflowBuilderSurfaceProps {
  /** `null` = a new workflow, blank or seeded from `template`. */
  definitionId: string | null;
  template?: WorkflowStarterTemplateV2 | null;
  /** Per-account cache scope every workflows surface threads from the page. */
  authCacheScope: string;
  onSaved?: (definitionId: string) => void;
  onBack?: () => void;
}

/**
 * What the inspector edits: one chain step, one context doc, or — through the
 * structural input card that heads the chain — the workflow itself
 * (description, default repository, declared inputs).
 */
type BuilderSelection =
  | { kind: "node"; id: string }
  | { kind: "doc"; index: number }
  | { kind: "input" };

interface DeletedNodeSnapshot {
  node: WorkflowNodeV2;
  index: number;
}

/**
 * A stale selection (removed step or document) closes the inspector. The
 * supplied builder keeps the graph full-width until the author selects a card.
 */
function resolveSelection(
  selection: BuilderSelection | null,
  draft: WorkflowBuilderDraft,
): BuilderSelection | null {
  if (selection?.kind === "node" && draft.nodes.some((node) => node.id === selection.id)) {
    return selection;
  }
  if (selection?.kind === "doc" && selection.index < draft.docTemplates.length) {
    return selection;
  }
  if (selection?.kind === "input") {
    return selection;
  }
  return null;
}

/**
 * The gen-2 builder as the design's three-pane graph page: the 46px top bar
 * (back, the mono workflow-name field, Saved/Delete/Save Workflow), the step
 * palette and context-docs roster in the left rail, the chain drawn
 * full-bleed on the canvas, and the 312px inspector editing exactly the
 * selected object. There is still no edge editing — the chain is the card
 * order, and `useWorkflowBuilder` renders it as the linear edge list a save
 * sends. Every rule the surface enforces comes from `validateDefinitionV2`
 * through that hook; this component only decides where each issue is shown.
 */
export function WorkflowBuilderSurface({
  definitionId,
  template = null,
  authCacheScope,
  onSaved,
  onBack,
}: WorkflowBuilderSurfaceProps) {
  // Runtime repo roots, the same source `WorkflowTriggerDialog` picks a run's
  // repository from. No `enabled` gate: unlike the dialog's `open`, this surface
  // is only mounted while a workflow is being edited, and the query already
  // disables itself when no runtime is connected.
  const repoRootsQuery = useRepoRootsQuery();
  const repositories = useMemo(
    () => workflowRepoRootOptions(repoRootsQuery.data ?? []),
    [repoRootsQuery.data],
  );
  // `null` while the list is unknown: an id cannot be confirmed against a list
  // that has not arrived, and confirming it is what the save gate needs.
  const availableRepoRootIds = repoRootsQuery.data
    ? repoRootsQuery.data.map((repoRoot) => repoRoot.id)
    : null;
  const builder = useWorkflowBuilder({
    definitionId,
    template,
    authCacheScope,
    availableRepoRootIds,
  });
  const registriesQuery = useCloudLaunchModelRegistries();
  const harnesses = useMemo(
    () => workflowBuilderHarnessOptions(registriesQuery.data),
    [registriesQuery.data],
  );
  const { deleteWorkflowDefinitionV2, deletingWorkflowDefinitionV2 } =
    useWorkflowDefinitionV2MutationsAccess(authCacheScope);

  const { draft, issues, actions } = builder;
  const [selection, setSelection] = useState<BuilderSelection | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [railWidth, setRailWidth] = useState(BUILDER_RAIL_DEFAULT_WIDTH);
  const [inspectorWidth, setInspectorWidth] = useState(BUILDER_INSPECTOR_DEFAULT_WIDTH);
  const [paneRowWidth, setPaneRowWidth] = useState(0);
  const [confirmedTitle, setConfirmedTitle] = useState(draft.title);
  const deletedNodesRef = useRef<DeletedNodeSnapshot[]>([]);
  const paneRowRef = useRef<HTMLDivElement>(null);
  const railDragMaxRef = useRef(BUILDER_RAIL_MAX_WIDTH);
  const inspectorDragMaxRef = useRef(BUILDER_INSPECTOR_MAX_WIDTH);

  const resizeRail = useCallback((rawWidth: number) => {
    const clamped = Math.min(
      railDragMaxRef.current,
      Math.max(BUILDER_RAIL_COLLAPSED_WIDTH, rawWidth),
    );
    setRailWidth(clamped < BUILDER_RAIL_SNAP_WIDTH
      ? BUILDER_RAIL_COLLAPSED_WIDTH
      : clamped);
  }, []);
  const resizeInspector = useCallback((rawWidth: number) => {
    setInspectorWidth(Math.min(
      inspectorDragMaxRef.current,
      Math.max(BUILDER_INSPECTOR_MIN_WIDTH, rawWidth),
    ));
  }, []);
  const beginRailResize = useResize({
    direction: "horizontal",
    size: railWidth,
    resolveSize: () => {
      const renderedWidth = paneRowRef.current
        ?.querySelector<HTMLElement>("#workflow-builder-rail")
        ?.getBoundingClientRect().width ?? 0;
      return renderedWidth > 0 ? renderedWidth : railWidth;
    },
    onResize: resizeRail,
  });
  const beginInspectorResize = useResize({
    direction: "horizontal",
    size: inspectorWidth,
    onResize: resizeInspector,
    reverse: true,
  });
  const onRailSeparatorDown = useCallback((event: MouseEvent) => {
    const rowWidth = paneRowRef.current?.getBoundingClientRect().width ?? 0;
    const openInspectorWidth = selection === null ? 0 : inspectorWidth;
    railDragMaxRef.current = rowWidth > 0
      ? Math.max(
          BUILDER_RAIL_MIN_WIDE_WIDTH,
          Math.min(
            BUILDER_RAIL_MAX_WIDTH,
            rowWidth - openInspectorWidth - BUILDER_CANVAS_MIN_WIDTH,
          ),
        )
      : BUILDER_RAIL_MAX_WIDTH;
    beginRailResize(event);
  }, [beginRailResize, inspectorWidth, selection]);
  const onInspectorSeparatorDown = useCallback((event: MouseEvent) => {
    const rowWidth = paneRowRef.current?.getBoundingClientRect().width ?? 0;
    const renderedRailWidth = paneRowRef.current
      ?.querySelector<HTMLElement>("#workflow-builder-rail")
      ?.getBoundingClientRect().width ?? railWidth;
    inspectorDragMaxRef.current = rowWidth > 0
      ? Math.max(
          BUILDER_INSPECTOR_MIN_WIDTH,
          Math.min(
            BUILDER_INSPECTOR_MAX_WIDTH,
            rowWidth - renderedRailWidth - BUILDER_CANVAS_MIN_WIDTH,
          ),
        )
      : BUILDER_INSPECTOR_MAX_WIDTH;
    beginInspectorResize(event);
  }, [beginInspectorResize, railWidth]);
  useEffect(() => {
    const row = paneRowRef.current;
    if (!row || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setPaneRowWidth(entry?.contentRect.width ?? row.clientWidth);
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!builder.dirty) {
      setConfirmedTitle(draft.title);
    }
  }, [builder.dirty, draft.title]);
  // A just-added step selects itself so the palette lands the user in the
  // fields they came for. Docs do the same, but synchronously in the add
  // handler (the new doc's index is known there).
  const previousNodeCountRef = useRef(draft.nodes.length);
  useEffect(() => {
    if (draft.nodes.length > previousNodeCountRef.current) {
      setSelection({ kind: "node", id: draft.nodes[draft.nodes.length - 1].id });
    }
    previousNodeCountRef.current = draft.nodes.length;
  }, [draft.nodes]);
  const active = resolveSelection(selection, draft);
  const selectedNode = active?.kind === "node"
    ? draft.nodes.find((node) => node.id === active.id) ?? null
    : null;
  const selectedDoc = active?.kind === "doc" ? draft.docTemplates[active.index] : null;
  const inspectorOpen = active !== null;
  const autoCompactRail = inspectorOpen
    && paneRowWidth > 0
    && paneRowWidth < railWidth + BUILDER_CANVAS_MIN_WIDTH + inspectorWidth;
  const compactRail = autoCompactRail || railWidth < BUILDER_RAIL_MIN_WIDE_WIDTH;
  const renderedRailWidth = autoCompactRail ? BUILDER_RAIL_COLLAPSED_WIDTH : railWidth;
  const titleDirty = draft.title !== confirmedTitle;

  const confirmTitle = () => setConfirmedTitle(draft.title);
  const onTitleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmTitle();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  const removeNode = useCallback((node: WorkflowNodeV2) => {
    const index = draft.nodes.findIndex((candidate) => candidate.id === node.id);
    if (index < 0) {
      return;
    }
    deletedNodesRef.current.push({ node, index });
    actions.removeNode(node.id);
    setSelection(null);
  }, [actions, draft.nodes]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      const element = target instanceof HTMLElement ? target : null;
      const tag = element?.tagName.toLowerCase();
      const typing = tag === "input"
        || tag === "textarea"
        || tag === "select"
        || element?.isContentEditable === true;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        if (typing || builder.saving) {
          return;
        }
        const snapshot = deletedNodesRef.current.pop();
        if (!snapshot) {
          return;
        }
        event.preventDefault();
        actions.restoreNode(snapshot.node, snapshot.index);
        setSelection({ kind: "node", id: snapshot.node.id });
        return;
      }

      if (typing || event.metaKey || event.ctrlKey || builder.saving) {
        return;
      }
      if (event.key !== "Enter" && event.key !== "Backspace" && event.key !== "Delete") {
        return;
      }
      const focusedNode = element?.closest<HTMLElement>("[data-workflow-node-id]");
      if (!selectedNode || focusedNode?.dataset.workflowNodeId !== selectedNode.id) {
        return;
      }
      event.preventDefault();
      removeNode(selectedNode);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [actions, builder.saving, removeNode, selectedNode]);

  if (builder.status !== "ready") {
    return (
      <WorkflowResourceState
        loading={builder.status === "loading"}
        title={resourceStateTitle(builder.status)}
        description={resourceStateDescription(builder.status)}
        onBack={() => onBack?.()}
        onRetry={builder.status === "missing" ? builder.reload : undefined}
      />
    );
  }

  const submit = () => {
    void builder.save().then((saved) => {
      if (saved) {
        onSaved?.(saved.id);
      }
    });
  };

  const confirmDelete = () => {
    if (definitionId === null || builder.record === null) {
      return;
    }
    setDeleteError(null);
    void deleteWorkflowDefinitionV2({
      workflowDefinitionId: definitionId,
      expectedRevision: builder.record.revision,
    })
      .then(() => {
        setDeleteOpen(false);
        onBack?.();
      })
      .catch(() => setDeleteError(WORKFLOW_MAIN_COPY.deleteErrorMessage));
  };

  const banners = [
    builder.error
      ? <NoticeBanner key="error" tone="destructive">{builder.error}</NoticeBanner>
      : null,
    registriesQuery.isError
      ? <NoticeBanner key="catalog" tone="warning">{WORKFLOW_BUILDER_COPY.catalogUnavailable}</NoticeBanner>
      : null,
    repoRootsQuery.isError
      ? <NoticeBanner key="repos" tone="warning">{WORKFLOW_BUILDER_COPY.repositoriesLoadFailed}</NoticeBanner>
      : null,
  ].filter((banner) => banner !== null);

  const saveDisabled = !builder.canSave;
  const saveStyle: CSSProperties = {
    flex: "none",
    padding: "4px 11px",
    borderRadius: 7,
    border: `1px solid ${saveDisabled ? "var(--color-border)" : "var(--color-border-heavy)"}`,
    background: saveDisabled ? "var(--color-surface-elevated)" : "var(--color-surface-elevated-secondary)",
    color: saveDisabled ? "var(--color-faint)" : "var(--color-foreground)",
    font: "inherit",
    fontWeight: 500,
    cursor: saveDisabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background" data-telemetry-block>
      <header
        className="relative z-popover flex shrink-0 items-center border-b border-border bg-background"
        style={{ gap: 12, height: 46, padding: "0 12px" }}
        data-tauri-drag-region="true"
      >
        <button
          type="button"
          title={WORKFLOW_BUILDER_COPY.backLabel}
          aria-label={WORKFLOW_BUILDER_COPY.backLabel}
          disabled={builder.saving}
          className="grid shrink-0 cursor-pointer place-items-center border-0 bg-transparent text-faint hover:bg-hover hover:text-foreground"
          style={{ width: 24, height: 24, borderRadius: 7, transform: "rotate(180deg)" }}
          onClick={() => onBack?.()}
        >
          <ChevronRight className="icon-paired" aria-hidden />
        </button>
        <input
          type="text"
          value={draft.title}
          aria-label={WORKFLOW_BUILDER_COPY.titleLabel}
          placeholder={WORKFLOW_BUILDER_COPY.titlePlaceholder}
          spellCheck={false}
          disabled={builder.saving}
          className="text-ui font-mono outline-none transition-colors hover:bg-hover focus:border-border-heavy focus:bg-surface-elevated"
          style={{
            flex: "0 1 210px",
            minWidth: 96,
            padding: "3px 8px",
            marginLeft: -8,
            borderRadius: 7,
            border: "1px solid transparent",
            background: "transparent",
            color: "var(--color-foreground)",
          }}
          onChange={(event) => actions.setTitle(event.currentTarget.value)}
          onKeyDown={onTitleKeyDown}
        />
        {titleDirty ? (
          <button
            type="button"
            title={WORKFLOW_BUILDER_COPY.confirmTitleLabel}
            aria-label={WORKFLOW_BUILDER_COPY.confirmTitleLabel}
            className="grid shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-success hover:bg-hover"
            style={{ width: 22, height: 22 }}
            onClick={confirmTitle}
          >
            <Check className="icon-paired" aria-hidden />
          </button>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center justify-end" style={{ gap: 10 }}>
          {builder.saved ? (
            <span className="text-ui-sm min-w-0 truncate text-muted-foreground">
              {WORKFLOW_BUILDER_COPY.savedLabel}
            </span>
          ) : null}
          {definitionId !== null ? (
            <button
              type="button"
              title={WORKFLOW_BUILDER_COPY.deleteDefinitionTitle}
              disabled={builder.saving || deletingWorkflowDefinitionV2}
              className="text-ui-sm hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                flex: "none",
                padding: "4px 9px",
                borderRadius: 7,
                border: "1px solid var(--color-border)",
                background: "transparent",
                color: "var(--color-destructive)",
                font: "inherit",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              onClick={() => {
                setDeleteError(null);
                setDeleteOpen(true);
              }}
            >
              {WORKFLOW_BUILDER_COPY.deleteDefinitionLabel}
            </button>
          ) : null}
          <button
            type="button"
            disabled={saveDisabled || builder.saving}
            className="text-ui-sm"
            style={saveStyle}
            onClick={submit}
          >
            {builder.saving ? WORKFLOW_BUILDER_COPY.savingLabel : WORKFLOW_BUILDER_COPY.saveLabel}
          </button>
        </div>
      </header>

      {banners.length > 0 ? (
        <div className="flex shrink-0 flex-col gap-2 px-3 pt-3">{banners}</div>
      ) : null}

      <div ref={paneRowRef} className="relative flex min-h-0 flex-1" data-workflow-builder-pane-row>
        <WorkflowBuilderRail
          width={renderedRailWidth}
          compact={compactRail}
          docTemplates={draft.docTemplates}
          selectedDocIndex={active?.kind === "doc" ? active.index : null}
          disabled={builder.saving}
          addDocDisabled={draft.nodes.length === 0}
          onAddStep={(type) => actions.addNode(type)}
          onAddDoc={() => {
            actions.addDocTemplate();
            setSelection({ kind: "doc", index: draft.docTemplates.length });
          }}
          onSelectDoc={(index) => setSelection({ kind: "doc", index })}
        />

        <WorkspaceResizeSeparator
          edge="left"
          ariaControls="workflow-builder-rail"
          ariaLabel="Resize step rail"
          title="Drag to resize · double-click to reset"
          onMouseDown={onRailSeparatorDown}
          onDoubleClick={() => setRailWidth(BUILDER_RAIL_DEFAULT_WIDTH)}
        />

        <WorkflowBuilderChainCanvas
          className="min-w-[280px] flex-1"
          nodes={draft.nodes}
          harnesses={harnesses}
          selectedNodeId={selectedNode?.id ?? null}
          inputSelected={active?.kind === "input"}
          statusSlot={(
            <>
              <span className="text-ui-sm whitespace-nowrap text-faint">
                {WORKFLOW_BUILDER_COPY.statusSummary(draft.nodes.length, draft.nodes.length + 1)}
              </span>
              {issues.length === 0 ? (
                <span className="flex flex-none items-center" style={{ gap: 6 }}>
                  <span
                    aria-hidden
                    style={{ width: 6, height: 6, borderRadius: 999, background: "var(--color-success)", flex: "none" }}
                  />
                  <span className="text-ui-sm whitespace-nowrap text-muted-foreground">
                    {WORKFLOW_BUILDER_COPY.statusValid}
                  </span>
                </span>
              ) : (
                <span className="flex w-full items-start" style={{ gap: 6 }}>
                  <span
                    aria-hidden
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: "var(--color-compute-target-amber)",
                      flex: "none",
                      marginTop: 5,
                    }}
                  />
                  <span className="text-ui-sm flex-1 text-muted-foreground" style={{ textWrap: "pretty" }}>
                    {issues[0].message}{" "}
                    {issues.length > 1 ? (
                      <span className="text-faint">
                        {WORKFLOW_BUILDER_COPY.statusMoreIssues(issues.length - 1)}
                      </span>
                    ) : null}
                  </span>
                </span>
              )}
            </>
          )}
          onSelectNode={(id) => setSelection({ kind: "node", id })}
          onSelectInput={() => setSelection({ kind: "input" })}
          onClearSelection={() => setSelection(null)}
        />

        {inspectorOpen ? (
          <WorkspaceResizeSeparator
            edge="right"
            ariaControls="workflow-builder-inspector"
            ariaLabel="Resize inspector"
            title="Drag to resize · double-click to reset"
            onMouseDown={onInspectorSeparatorDown}
            onDoubleClick={() => setInspectorWidth(BUILDER_INSPECTOR_DEFAULT_WIDTH)}
          />
        ) : null}

        {inspectorOpen ? (
          <aside
            id="workflow-builder-inspector"
            className="flex shrink-0 flex-col overflow-y-auto border-l border-border bg-sidebar-background"
            style={{ width: inspectorWidth, gap: 14, padding: 14 }}
          >
            {active?.kind === "input" ? (
              <>
                <WorkflowBuilderDetailsCard
                  description={draft.description}
                  defaultRepoConfigId={draft.defaultRepoConfigId}
                  repositories={repositories}
                  repositoriesLoading={repoRootsQuery.isLoading}
                  repoDefaultUnavailable={builder.repoDefaultUnavailable}
                  disabled={builder.saving}
                  onDescriptionChange={actions.setDescription}
                  onDefaultRepoConfigIdChange={actions.setDefaultRepoConfigId}
                />
                <WorkflowBuilderInputsPanel
                  inputs={draft.inputs}
                  issues={issues}
                  disabled={builder.saving}
                  onAdd={actions.addInput}
                  onRemove={actions.removeInput}
                  onChange={actions.updateInput}
                />
              </>
            ) : null}

            {selectedNode ? (
              <WorkflowBuilderNodeInspector
                key={selectedNode.id}
                node={selectedNode}
                index={draft.nodes.findIndex((node) => node.id === selectedNode.id)}
                nodeCount={draft.nodes.length}
                harnesses={harnesses}
                issues={issues.filter((issue) => issue.nodeId === selectedNode.id)}
                disabled={builder.saving}
                onChange={(patch) => actions.updateNode(selectedNode.id, patch)}
                onRemove={() => removeNode(selectedNode)}
                onMoveUp={() => actions.moveNodeUp(selectedNode.id)}
                onMoveDown={() => actions.moveNodeDown(selectedNode.id)}
              />
            ) : null}

            {selectedDoc && active?.kind === "doc" ? (
              <WorkflowBuilderDocInspector
                key={active.index}
                doc={selectedDoc}
                index={active.index}
                nodes={draft.nodes}
                issues={issues}
                disabled={builder.saving}
                onClose={() => setSelection(null)}
                onRemove={() => actions.removeDocTemplate(active.index)}
                onChange={(patch) => actions.updateDocTemplate(active.index, patch)}
              />
            ) : null}
          </aside>
        ) : null}
      </div>

      <WorkflowMainDeleteDialog
        open={deleteOpen}
        title={draft.title}
        deleting={deletingWorkflowDefinitionV2}
        error={deleteError}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function resourceStateTitle(status: "loading" | "missing" | "unsupported"): string {
  if (status === "loading") {
    return WORKFLOW_BUILDER_COPY.loadingTitle;
  }
  return status === "unsupported"
    ? WORKFLOW_BUILDER_COPY.unsupportedTitle
    : WORKFLOW_BUILDER_COPY.missingTitle;
}

function resourceStateDescription(status: "loading" | "missing" | "unsupported"): string {
  if (status === "loading") {
    return WORKFLOW_BUILDER_COPY.loadingDescription;
  }
  return status === "unsupported"
    ? WORKFLOW_BUILDER_COPY.unsupportedDescription
    : WORKFLOW_BUILDER_COPY.missingDescription;
}
