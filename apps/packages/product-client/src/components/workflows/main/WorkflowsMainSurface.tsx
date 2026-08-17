import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { WorkflowDefinitionRecordV2 } from "@proliferate/cloud-sdk";
import type { WorkflowStarterTemplateV2 } from "#product/config/workflows/starter-templates";
import { WORKFLOW_STARTER_TEMPLATES_V2 } from "#product/config/workflows/starter-templates";
import { WORKFLOW_MAIN_COPY } from "#product/copy/workflows/workflow-main-copy";
import {
  useWorkflowDefinitionsV2ListAccess,
  useWorkflowDefinitionV2Access,
  useWorkflowDefinitionV2MutationsAccess,
} from "#product/hooks/access/cloud/workflows/use-workflow-definitions-v2-access";
import { useWorkspaceNavigationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import {
  formatWorkflowUpdatedAt,
  selectWorkflowLegacyDefinitionRows,
  selectWorkflowV2DefinitionRows,
  workflowRunDefinitionTitle,
  type WorkflowMainListItem,
} from "#product/domain/workflows/main-view-model";
import { WorkflowMainDeleteDialog } from "#product/components/workflows/main/WorkflowMainDeleteDialog";
import { WorkflowMainExecutionsGroup } from "#product/components/workflows/main/WorkflowMainExecutionsGroup";
import { WorkflowTriggerDialog } from "#product/components/workflows/trigger/WorkflowTriggerDialog";
import { useWorkflowExecutions } from "#product/hooks/workflows/facade/use-workflow-executions";
import type { WorkflowTriggerLaunch } from "#product/hooks/workflows/workflows/use-workflow-trigger-actions";
import { Button } from "#product/primitives/Button";
import { ChevronRight, Play, Plus, RotateCcw, Search, Trash } from "#product/primitives/icons/core";
import { FileCode, StackedFiles } from "#product/primitives/icons/workspace";
import { EmptyState } from "#product/primitives/patterns/EmptyState";
import { Popover, PopoverContent, PopoverTrigger } from "#product/primitives/Popover";
import { ShortcutBadge } from "#product/primitives/ShortcutBadge";

/** The design's 24px icon-button on a row (Play, and the legacy trash). */
export const WORKFLOW_INDEX_ROW_ACTION_STYLE: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 24,
  height: 24,
  flex: "none",
  borderRadius: 7,
  border: 0,
  background: "transparent",
  cursor: "pointer",
};

export interface WorkflowsMainSurfaceProps {
  authCacheScope: string;
  onEdit: (definitionId: string) => void;
  onNew: (template: WorkflowStarterTemplateV2 | null) => void;
}

/**
 * The workflows index, in the design's page anatomy: a borderless filter bar,
 * the "Create workflows" launcher and its attached blank/template menu, then
 * caption-headed groups — Saved Workflows, Executions, Legacy
 * — of 36px hover-washed rows. A definition row opens the builder and carries
 * the Play affordance; an execution row opens its workspace; a legacy row is
 * delete-only by construction.
 */
export function WorkflowsMainSurface({
  authCacheScope,
  onEdit,
  onNew,
}: WorkflowsMainSurfaceProps) {
  const listQuery = useWorkflowDefinitionsV2ListAccess(authCacheScope);
  const { deleteWorkflowDefinitionV2, deletingWorkflowDefinitionV2 } =
    useWorkflowDefinitionV2MutationsAccess(authCacheScope);
  const { selectWorkspaceFromSurface } = useWorkspaceNavigationWorkflow();
  const executions = useWorkflowExecutions();

  const [filterText, setFilterText] = useState("");
  const [startOpen, setStartOpen] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const runQuery = useWorkflowDefinitionV2Access(runningId, authCacheScope, runningId !== null);

  const [deleteTarget, setDeleteTarget] = useState<WorkflowMainListItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && startOpen) {
        event.preventDefault();
        setStartOpen(false);
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "n") {
        return;
      }
      const target = event.target;
      const element = target instanceof HTMLElement ? target : null;
      const tag = element?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || element?.isContentEditable) {
        return;
      }
      event.preventDefault();
      setStartOpen(true);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [startOpen]);

  const handleRun = (id: string) => {
    if (id === runningId) {
      if (runQuery.isError) {
        void runQuery.refetch();
      }
      return;
    }
    setRunningId(id);
  };

  const handleLaunched = (launch: WorkflowTriggerLaunch) => {
    setRunningId(null);
    selectWorkspaceFromSurface(launch.workspaceId, "workflows-main-surface");
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) {
      return;
    }
    setDeleteError(null);
    void deleteWorkflowDefinitionV2({
      workflowDefinitionId: deleteTarget.id,
      expectedRevision: deleteTarget.revision,
    })
      .then(() => setDeleteTarget(null))
      .catch(() => setDeleteError(WORKFLOW_MAIN_COPY.deleteErrorMessage));
  };

  if (listQuery.isLoading) {
    return (
      <WorkflowIndexFrame>
        <p className="text-body py-6 text-muted-foreground" role="status">
          {WORKFLOW_MAIN_COPY.loadingTitle}
        </p>
      </WorkflowIndexFrame>
    );
  }

  if (listQuery.isError) {
    return (
      <WorkflowIndexFrame>
        <EmptyState
          title={WORKFLOW_MAIN_COPY.errorTitle}
          description={WORKFLOW_MAIN_COPY.errorDescription}
          action={(
            <Button type="button" variant="secondary" size="sm" onClick={() => void listQuery.refetch()}>
              <RotateCcw className="icon-paired" aria-hidden />
              {WORKFLOW_MAIN_COPY.retryLabel}
            </Button>
          )}
        />
      </WorkflowIndexFrame>
    );
  }

  const rows = listQuery.data?.workflows ?? [];
  const items = selectWorkflowV2DefinitionRows(rows);
  const legacyItems = selectWorkflowLegacyDefinitionRows(rows);
  const runningRecord: WorkflowDefinitionRecordV2 | undefined =
    runningId !== null && runQuery.data?.id === runningId ? runQuery.data : undefined;

  // One filter over every group, the way the design's index reads: substring
  // matching on what the rows visibly say, never on hidden identifiers.
  const needle = filterText.trim().toLowerCase();
  const matches = (...haystacks: (string | null)[]) =>
    needle.length === 0
    || haystacks.some((value) => value !== null && value.toLowerCase().includes(needle));
  const visibleItems = items.filter((item) => matches(item.title, item.description));
  const visibleLegacy = legacyItems.filter((item) => matches(item.title, item.description));
  const visibleRuns = executions.runs.filter((run) => matches(
    workflowRunDefinitionTitle(run.definitionJson) ?? WORKFLOW_MAIN_COPY.executionFallbackTitle,
  ));

  return (
    <WorkflowIndexFrame>
      <div
        className="flex items-center border-b border-border"
        style={{ gap: 10, padding: "8px 10px 12px" }}
      >
        <span className="flex text-faint">
          <Search className="icon-paired" aria-hidden />
        </span>
        <input
          type="text"
          value={filterText}
          placeholder={WORKFLOW_MAIN_COPY.filterPlaceholder}
          aria-label={WORKFLOW_MAIN_COPY.filterLabel}
          className="text-body min-w-0 flex-1 border-0 bg-transparent text-foreground outline-none"
          style={{ font: "inherit" }}
          onChange={(event) => setFilterText(event.target.value)}
        />
      </div>

      <div style={{ position: "relative", paddingTop: 10 }}>
        <GroupCaption label={WORKFLOW_MAIN_COPY.createGroupTitle} />
        <Popover open={startOpen} onOpenChange={setStartOpen} modal>
          <PopoverTrigger asChild>
            <button type="button" className="hover:bg-hover" style={indexRowStyle}>
              <span className="flex flex-none items-center justify-center text-faint" style={{ width: 16, height: 16 }}>
                <Plus className="icon-paired" aria-hidden />
              </span>
              <span className="text-ui flex-none font-medium">{WORKFLOW_MAIN_COPY.createBlankTitle}</span>
              <span className="text-ui-sm min-w-0 truncate text-faint">
                {WORKFLOW_MAIN_COPY.createBlankSubtitle}
              </span>
              <span className="flex-1" />
              <ShortcutBadge label="⌘N" className="text-faint" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={4}
            aria-label={WORKFLOW_MAIN_COPY.createDialogLabel}
            className="flex max-w-[calc(100vw-48px)] flex-col gap-3 overflow-y-auto rounded-xl border-border bg-surface-elevated shadow-popover"
            style={{ width: 392, maxHeight: "calc(100vh - 168px)", padding: 14 }}
          >
              <p className="text-ui-sm m-0 text-muted-foreground" style={{ textWrap: "pretty" }}>
                {WORKFLOW_MAIN_COPY.createDialogDescription}
              </p>
              <button
                type="button"
                className="flex cursor-pointer items-center text-left hover:bg-hover"
                style={{
                  gap: 10,
                  padding: "10px 11px",
                  borderRadius: 9,
                  border: "1px solid var(--color-border-heavy)",
                  background: "var(--color-surface-elevated-secondary)",
                  color: "var(--color-foreground)",
                  font: "inherit",
                }}
                onClick={() => {
                  setStartOpen(false);
                  onNew(null);
                }}
              >
                <span className="flex flex-none text-faint">
                  <Plus className="icon-paired" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-ui font-medium">{WORKFLOW_MAIN_COPY.blankWorkflowTitle}</span>
                  <span className="text-ui-sm text-faint">{WORKFLOW_MAIN_COPY.blankWorkflowDescription}</span>
                </span>
              </button>
              <div className="flex flex-col" style={{ gap: 6 }}>
                <span
                  className="text-ui-sm font-mono uppercase text-faint"
                  style={{ letterSpacing: "0.07em" }}
                >
                  {WORKFLOW_MAIN_COPY.templateGroupTitle}
                </span>
                {WORKFLOW_STARTER_TEMPLATES_V2.map((template) => (
                  <button
                    key={template.slug}
                    type="button"
                    className="flex cursor-pointer items-center bg-transparent text-left hover:border-border-heavy hover:bg-hover"
                    style={{
                      gap: 10,
                      padding: "8px 11px",
                      borderRadius: 9,
                      border: "1px solid var(--color-border)",
                      color: "var(--color-foreground)",
                      font: "inherit",
                    }}
                    onClick={() => {
                      setStartOpen(false);
                      onNew(template);
                    }}
                  >
                    <span className="flex flex-none text-faint">
                      <StackedFiles className="icon-paired" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-ui truncate font-medium">{template.title}</span>
                      <span className="text-ui-sm truncate text-faint">{template.description}</span>
                    </span>
                    <span className="text-ui-sm flex-none whitespace-nowrap font-mono text-faint">
                      {WORKFLOW_MAIN_COPY.templateMeta(template.definition.nodes.length)}
                    </span>
                  </button>
                ))}
              </div>
          </PopoverContent>
        </Popover>
      </div>

      <div style={{ paddingTop: 18 }}>
        <GroupCaption
          label={WORKFLOW_MAIN_COPY.savedGroupTitle}
          count={visibleItems.length}
        />
        {visibleItems.map((item) => (
          <div key={item.id} className="flex items-center hover:bg-hover" style={indexRowStyle}>
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer items-center border-0 bg-transparent p-0 text-left"
              style={{ gap: 12, font: "inherit" }}
              onClick={() => onEdit(item.id)}
            >
              <span className="flex flex-none items-center justify-center text-faint" style={{ width: 16, height: 16 }}>
                <FileCode className="icon-paired" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 items-center" style={{ gap: 8 }}>
              <span className="text-ui truncate font-medium text-foreground" style={{ flex: "0 1 200px", minWidth: 96 }}>
                {item.title}
              </span>
              <span className="flex flex-none text-faint">
                <ChevronRight className="icon-paired" aria-hidden />
              </span>
              <span
                className="text-ui-sm truncate font-mono text-muted-foreground"
                style={{ flex: "0 1 auto", minWidth: 64, maxWidth: 260 }}
              >
                {workflowDefinitionFilename(item.title)}
              </span>
              <span
                className="text-ui-sm truncate text-faint"
                style={{ flex: "0 1 auto", minWidth: 88 }}
              >
                {item.description}
              </span>
              </span>
              <span className="text-ui-sm flex-none text-faint">
                {formatWorkflowUpdatedAt(item.updatedAt)}
              </span>
            </button>
            <button
              type="button"
              title={WORKFLOW_MAIN_COPY.runRowTitle}
              aria-label={WORKFLOW_MAIN_COPY.runLabel(item.title)}
              className="text-faint hover:bg-hover hover:text-foreground"
              style={WORKFLOW_INDEX_ROW_ACTION_STYLE}
              onClick={(event) => {
                event.stopPropagation();
                handleRun(item.id);
              }}
            >
              <Play className="icon-paired" aria-hidden />
            </button>
          </div>
        ))}
      </div>

      {visibleRuns.length > 0 ? (
        <div style={{ paddingTop: 18 }}>
          <GroupCaption
            label={WORKFLOW_MAIN_COPY.executionsGroupTitle}
            count={visibleRuns.length}
          />
          <WorkflowMainExecutionsGroup
            runs={visibleRuns}
            onOpen={(run) => selectWorkspaceFromSurface(run.workspaceId, "workflows-main-surface")}
          />
        </div>
      ) : null}

      {visibleLegacy.length > 0 ? (
        <div style={{ paddingTop: 18 }}>
          <GroupCaption
            label={WORKFLOW_MAIN_COPY.legacyGroupTitle}
            count={visibleLegacy.length}
          />
          <p className="text-ui-sm m-0 text-faint" style={{ padding: "0 10px 6px" }}>
            {WORKFLOW_MAIN_COPY.legacyGroupDescription}
          </p>
          {visibleLegacy.map((item) => (
            <div key={item.id} style={indexRowStyle}>
              <span className="flex flex-none items-center justify-center text-faint" style={{ width: 16, height: 16 }}>
                <FileCode className="icon-paired" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 items-center" style={{ gap: 8 }}>
                <span className="text-ui truncate font-medium text-foreground" style={{ flex: "0 1 200px", minWidth: 96 }}>
                  {item.title}
                </span>
                <span className="text-ui-sm font-mono text-muted-foreground">
                  {WORKFLOW_MAIN_COPY.legacyBadgeLabel}
                </span>
              </span>
              <span className="text-ui-sm flex-none text-faint">
                {formatWorkflowUpdatedAt(item.updatedAt)}
              </span>
              <button
                type="button"
                aria-label={WORKFLOW_MAIN_COPY.legacyDeleteLabel(item.title)}
                title={WORKFLOW_MAIN_COPY.legacyDeleteLabel(item.title)}
                className="text-faint hover:bg-hover hover:text-destructive"
                style={WORKFLOW_INDEX_ROW_ACTION_STYLE}
                onClick={() => {
                  setDeleteError(null);
                  setDeleteTarget(item);
                }}
              >
                <Trash className="icon-paired" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {runningRecord ? (
        <WorkflowTriggerDialog
          definitionRecord={runningRecord}
          open
          onOpenChange={(open) => {
            if (!open) {
              setRunningId(null);
            }
          }}
          onLaunched={handleLaunched}
          authCacheScope={authCacheScope}
        />
      ) : null}

      <WorkflowMainDeleteDialog
        open={deleteTarget !== null}
        title={deleteTarget?.title ?? ""}
        deleting={deletingWorkflowDefinitionV2}
        error={deleteError}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />
    </WorkflowIndexFrame>
  );
}

/** The design's 36px hover-washed index row. */
const indexRowStyle: CSSProperties = {
  display: "flex",
  width: "100%",
  alignItems: "center",
  gap: 12,
  minHeight: 36,
  padding: "5px 10px",
  borderRadius: 8,
  border: 0,
  background: "transparent",
  cursor: "pointer",
  textAlign: "left",
  font: "inherit",
};

function GroupCaption({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center" style={{ gap: 8, padding: "6px 10px" }}>
      <span className="text-ui-sm text-faint">{label}</span>
      {count !== undefined ? (
        <span className="text-ui-sm" style={{ color: "var(--color-border-heavy)" }}>{count}</span>
      ) : null}
    </div>
  );
}

function workflowDefinitionFilename(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return `${slug || "untitled"}.workflow.json`;
}

/** The design's index frame: a centered 1120px column inside its own scroller. */
function WorkflowIndexFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-background" data-telemetry-block>
      <div
        className="flex w-full flex-col"
        style={{ maxWidth: 1120, margin: "0 auto", padding: "20px 24px 72px" }}
      >
        {children}
      </div>
    </div>
  );
}
