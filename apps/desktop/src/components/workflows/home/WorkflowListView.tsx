import type { WorkflowDefinition } from "@proliferate/product-domain/workflows/definition";
import { Input } from "@proliferate/ui/primitives/Input";
import { SegmentedControl } from "@proliferate/ui/primitives/SegmentedControl";
import { Search } from "@proliferate/ui/icons";
import type { WorkflowResponse, WorkflowRunResponse } from "@/hooks/access/cloud/workflows/types";
import { relativeTime, type TargetFilter } from "@/hooks/workflows/derived/workflow-run-row-view";
import { WorkflowListRowContainer } from "./WorkflowListRowContainer";

export interface WorkflowListViewProps {
  workflows: readonly WorkflowResponse[];
  canCreate: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  targetFilter: TargetFilter;
  onTargetFilterChange: (filter: TargetFilter) => void;
  lastRunByWorkflow: ReadonlyMap<string, WorkflowRunResponse>;
  onOpen: (workflowId: string) => void;
  onRun: (workflow: WorkflowResponse, definition: WorkflowDefinition) => void;
  onEdit: (workflowId: string) => void;
  onArchive: (workflowId: string) => void;
}

/** The org's workflows list: search + target filter, then one row per
 * (already-filtered) workflow. */
export function WorkflowListView({
  workflows,
  canCreate,
  query,
  onQueryChange,
  targetFilter,
  onTargetFilterChange,
  lastRunByWorkflow,
  onOpen,
  onRun,
  onEdit,
  onArchive,
}: WorkflowListViewProps) {
  return (
    <div className="flex flex-col gap-2">
      {!canCreate ? (
        <p className="text-ui-sm text-faint">Free plan: one workflow. Archive yours to create another.</p>
      ) : null}
      <div className="flex items-center gap-2 pb-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search workflows…"
            className="h-8 pl-8"
          />
        </div>
        <SegmentedControl
          ariaLabel="Filter workflows by run target"
          value={targetFilter}
          onChange={onTargetFilterChange}
          items={[
            { id: "all", label: "All" },
            { id: "cloud", label: "Cloud" },
            { id: "local", label: "Local" },
          ]}
        />
      </div>
      {workflows.map((workflow) => {
        const last = lastRunByWorkflow.get(workflow.id) ?? null;
        return (
          <WorkflowListRowContainer
            key={workflow.id}
            workflow={workflow}
            lastRun={last}
            lastRunAgoLabel={last ? relativeTime(last.startedAt ?? last.createdAt) || "recently" : null}
            onOpen={onOpen}
            onRun={onRun}
            onEdit={onEdit}
            onArchive={onArchive}
          />
        );
      })}
      {workflows.length === 0 ? <span className="px-1 py-4 text-xs text-faint">No workflows match.</span> : null}
    </div>
  );
}
