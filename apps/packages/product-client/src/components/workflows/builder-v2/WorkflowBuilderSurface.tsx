import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useAgentLaunchOptionsListQuery, useRepoRootsQuery } from "@anyharness/sdk-react";
import type { WorkflowStarterTemplateV2 } from "#product/config/workflows/starter-templates";
import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import { useWorkflowBuilder } from "#product/hooks/workflows/facade/use-workflow-builder";
import { useWorkflowNodeLayout } from "#product/hooks/workflows/workflows/use-workflow-node-layout";
import { workflowBuilderHarnessOptions } from "#product/lib/domain/workflows/workflow-builder-authoring";
import {
  resolveWorkflowBuilderSelection,
  type WorkflowBuilderSelection,
} from "#product/lib/domain/workflows/workflow-builder-selection";
import { workflowRepoRootOptions } from "#product/lib/domain/workflows/workflow-repo-root-options";
import { WorkflowBuilderChainCanvas } from "#product/components/workflows/builder-v2/WorkflowBuilderChainCanvas";
import { WorkflowBuilderInspector } from "#product/components/workflows/builder-v2/WorkflowBuilderInspector";
import { WorkflowBuilderRail } from "#product/components/workflows/builder-v2/WorkflowBuilderRail";
import { WorkflowJsonEditor } from "#product/components/workflows/builder-v2/WorkflowJsonEditor";
import { WorkflowResourceState } from "#product/components/workflows/WorkflowResourceState";
import { Button } from "#product/primitives/Button";
import { IconButton } from "#product/primitives/IconButton";
import { Input } from "#product/primitives/Input";
import { ArrowLeft } from "#product/primitives/icons/core";
import { StatusDot } from "#product/primitives/StatusDot";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";
import { SegmentedControl } from "#product/primitives/SegmentedControl";

/** The harness vocabulary a gen-2 node's optional `model` picks from, read
 * from the local runtime's per-kind observations. */
const WORKFLOW_BUILDER_HARNESS_KINDS = ["claude", "codex", "opencode", "grok"];

export interface WorkflowBuilderSurfaceProps {
  /** `null` = a new workflow, blank or seeded from `template`. */
  definitionId: string | null;
  template?: WorkflowStarterTemplateV2 | null;
  /** Per-account cache scope every workflows surface threads from the page. */
  authCacheScope: string;
  onSaved?: (definitionId: string) => void;
  onBack?: () => void;
}

/** Three-pane authoring surface with explicit graph edges and schema-backed validation. */
export function WorkflowBuilderSurface({
  definitionId,
  template = null,
  authCacheScope,
  onSaved,
  onBack,
}: WorkflowBuilderSurfaceProps) {
  const repoRootsQuery = useRepoRootsQuery();
  const repositories = useMemo(
    () => workflowRepoRootOptions(repoRootsQuery.data ?? []),
    [repoRootsQuery.data],
  );
  const availableRepoRootIds = repoRootsQuery.data
    ? repoRootsQuery.data.map((repoRoot) => repoRoot.id)
    : null;
  const launchOptionsEntries = useAgentLaunchOptionsListQuery({
    harnessKinds: WORKFLOW_BUILDER_HARNESS_KINDS,
    enabled: true,
  });
  const registriesQuery = {
    isError: launchOptionsEntries.every((entry) => !entry.data)
      && launchOptionsEntries.some((entry) => entry.isError),
  };
  const harnesses = useMemo(
    () => workflowBuilderHarnessOptions(launchOptionsEntries.map((entry) => entry.data)),
    [launchOptionsEntries],
  );
  const availableModelSelections = useMemo(() => harnesses.map((harness) => ({
    agentKind: harness.agentKind,
    modelIds: harness.models.map((model) => model.id),
  })), [harnesses]);
  const layout = useWorkflowNodeLayout(definitionId);
  const builder = useWorkflowBuilder({
    definitionId,
    template,
    authCacheScope,
    availableRepoRootIds,
    availableModelSelections,
  });

  const { draft, issues, actions } = builder;

  const [selection, setSelection] = useState<WorkflowBuilderSelection | null>(null);
  const [authoringMode, setAuthoringMode] = useState<"graph" | "json">("graph");
  const [jsonValid, setJsonValid] = useState(true);
  const previousNodeCountRef = useRef(draft.nodes.length);
  useEffect(() => {
    if (draft.nodes.length > previousNodeCountRef.current) {
      setSelection({ kind: "node", id: draft.nodes[draft.nodes.length - 1].id });
    }
    previousNodeCountRef.current = draft.nodes.length;
  }, [draft.nodes]);
  const active = resolveWorkflowBuilderSelection(selection, draft);
  const issueNodeIds = useMemo(
    () => new Set(issues.flatMap((issue) => (issue.nodeId ? [issue.nodeId] : []))),
    [issues],
  );

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

  const banners = [
    builder.error
      ? <NoticeBanner key="error" tone="destructive">{builder.error}</NoticeBanner>
      : null,
    issues.length > 0
      ? (
          <NoticeBanner key="issues" tone="destructive">
            {WORKFLOW_BUILDER_COPY.issuesBanner(issues.length, issues[0].message)}
          </NoticeBanner>
        )
      : null,
    // Every gate that holds Save down says so. The title is not a definition
    // rule (it lives on the record envelope) and invalid JSON is not visible
    // from the graph view at all, so neither reaches the issues banner above.
    draft.title.trim().length === 0
      ? <NoticeBanner key="title" tone="warning">{WORKFLOW_BUILDER_COPY.titleRequired}</NoticeBanner>
      : null,
    !jsonValid
      ? <NoticeBanner key="json" tone="warning">{WORKFLOW_BUILDER_COPY.jsonInvalid}</NoticeBanner>
      : null,
    registriesQuery.isError
      ? <NoticeBanner key="catalog" tone="warning">{WORKFLOW_BUILDER_COPY.catalogUnavailable}</NoticeBanner>
      : null,
    builder.modelSelectionUnavailable
      ? <NoticeBanner key="model" tone="warning">{WORKFLOW_BUILDER_COPY.modelUnavailable}</NoticeBanner>
      : null,
    repoRootsQuery.isError
      ? <NoticeBanner key="repos" tone="warning">{WORKFLOW_BUILDER_COPY.repositoriesLoadFailed}</NoticeBanner>
      : null,
  ].filter((banner) => banner !== null);

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background"
      data-telemetry-block
      onKeyDown={(event) => handleBuilderKeyDown(event, {
        disabled: builder.saving,
        active,
        removeNode: actions.removeNode,
        removeDoc: actions.removeDocTemplate,
        undo: builder.undo,
        redo: builder.redo,
      })}
    >
      {/* Reserve the same native drag-strip clearance as ProductPageShell. */}
      <div className="shrink-0" style={{ height: 46 }} data-tauri-drag-region="true" />
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <IconButton
          size="md"
          aria-label={WORKFLOW_BUILDER_COPY.backLabel}
          title={WORKFLOW_BUILDER_COPY.backLabel}
          disabled={builder.saving}
          onClick={() => onBack?.()}
        >
          <ArrowLeft className="icon-compact" aria-hidden />
        </IconButton>
        <Input
          aria-label={WORKFLOW_BUILDER_COPY.titleLabel}
          value={draft.title}
          disabled={builder.saving}
          placeholder={WORKFLOW_BUILDER_COPY.titlePlaceholder}
          className="h-8 w-72 max-w-full px-2"
          onChange={(event) => actions.setTitle(event.currentTarget.value)}
        />
        <div className="ml-auto flex items-center gap-2">
          <SegmentedControl
            ariaLabel="Workflow authoring view"
            variant="plain"
            value={authoringMode}
            items={[{ id: "graph", label: "Graph" }, { id: "json", label: "JSON" }]}
            onChange={setAuthoringMode}
          />
          <Button
            type="button"
            variant="primary"
            size="md"
            loading={builder.saving}
            disabled={!builder.canSave || !jsonValid}
            onClick={submit}
          >
            {saveLabel(builder.saving, builder.saved)}
          </Button>
        </div>
      </header>

      {banners.length > 0 ? (
        <div className="flex shrink-0 flex-col gap-2 px-3 pt-3">{banners}</div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <WorkflowBuilderRail
          docTemplates={draft.docTemplates}
          selectedDocIndex={active.kind === "doc" ? active.index : null}
          disabled={builder.saving}
          addDocDisabled={draft.nodes.length === 0}
          onAddStep={(type) => actions.addNode(type)}
          onAddDoc={() => {
            actions.addDocTemplate();
            setSelection({ kind: "doc", index: draft.docTemplates.length });
          }}
          onSelectDoc={(index) => setSelection({ kind: "doc", index })}
        />

        <div className="min-w-0 flex-1 p-3">
          <div className={authoringMode === "graph" ? "h-full" : "hidden"}>
            <WorkflowBuilderChainCanvas
              className="h-full"
              nodes={draft.nodes}
              edges={draft.edges}
              inputConnectedTo={draft.inputConnectedTo}
              harnesses={harnesses}
              selectedNodeId={active.kind === "node" ? active.id : null}
              inputSelected={active.kind === "input"}
              issueNodeIds={issueNodeIds}
              nodePlacements={layout.placements}
              statusSlot={(
                <div className="flex flex-col gap-1">
                  <span className="text-ui-sm text-muted-foreground">
                    {WORKFLOW_BUILDER_COPY.statusSummary(draft.nodes.length, draft.nodes.length + 1)}
                  </span>
                  <span className="flex items-center gap-1.5 text-ui-sm text-foreground">
                    <StatusDot tone={issues.length > 0 ? "warning" : "success"} />
                    {issues.length > 0
                      ? WORKFLOW_BUILDER_COPY.statusIssues(issues.length)
                      : WORKFLOW_BUILDER_COPY.statusValid}
                  </span>
                </div>
              )}
              disabled={builder.saving}
              onSelectNode={(id) => setSelection({ kind: "node", id })}
              onSelectInput={() => setSelection({ kind: "input" })}
              onConnectNodes={actions.connectNodes}
              onConnectInput={actions.connectInput}
              onRemoveEdge={actions.removeEdge}
              onDisconnectInput={actions.disconnectInput}
              onMoveNode={layout.moveNode}
            />
          </div>
          <div className={authoringMode === "json" ? "h-full" : "hidden"}>
            <WorkflowJsonEditor
              key={definitionId ?? template?.slug ?? "blank"}
              definition={builder.definition}
              active={authoringMode === "json"}
              disabled={builder.saving}
              onApply={actions.replaceDefinition}
              onValidityChange={setJsonValid}
            />
          </div>
        </div>

        <WorkflowBuilderInspector
          selection={active}
          draft={draft}
          issues={issues}
          actions={actions}
          harnesses={harnesses}
          repositories={repositories}
          repositoriesLoading={repoRootsQuery.isLoading}
          repoDefaultUnavailable={builder.repoDefaultUnavailable}
          disabled={builder.saving}
        />
      </div>
    </div>
  );
}

function handleBuilderKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  actions: {
    disabled: boolean;
    active: WorkflowBuilderSelection;
    removeNode: (id: string) => void;
    removeDoc: (index: number) => void;
    undo: () => void;
    redo: () => void;
  },
) {
  if (actions.disabled) return;
  const target = event.target;
  if (target instanceof Element && target.closest("input, textarea, select, [contenteditable=true]")) {
    return;
  }
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) actions.redo();
    else actions.undo();
    return;
  }
  if (event.key !== "Backspace" && event.key !== "Delete") return;
  if (actions.active.kind === "node") actions.removeNode(actions.active.id);
  else if (actions.active.kind === "doc") actions.removeDoc(actions.active.index);
  else return;
  event.preventDefault();
}

function saveLabel(saving: boolean, saved: boolean): string {
  if (saving) return WORKFLOW_BUILDER_COPY.savingLabel;
  return saved ? WORKFLOW_BUILDER_COPY.savedLabel : WORKFLOW_BUILDER_COPY.saveLabel;
}

function resourceStateTitle(status: "loading" | "missing" | "unsupported"): string {
  if (status === "loading") return WORKFLOW_BUILDER_COPY.loadingTitle;
  return status === "unsupported"
    ? WORKFLOW_BUILDER_COPY.unsupportedTitle
    : WORKFLOW_BUILDER_COPY.missingTitle;
}

function resourceStateDescription(status: "loading" | "missing" | "unsupported"): string {
  if (status === "loading") return WORKFLOW_BUILDER_COPY.loadingDescription;
  return status === "unsupported"
    ? WORKFLOW_BUILDER_COPY.unsupportedDescription
    : WORKFLOW_BUILDER_COPY.missingDescription;
}
