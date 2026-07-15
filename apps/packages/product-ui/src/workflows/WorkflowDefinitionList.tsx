import { Plus, RotateCcw, Workflow } from "lucide-react";
import type { WorkflowDefinition } from "@proliferate/product-domain/workflows/definition";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { Button } from "@proliferate/ui/primitives/Button";
import { ProductPageShell } from "../layout/ProductPageShell";

export interface WorkflowDefinitionListProps {
  definitions: readonly WorkflowDefinition[];
  loading?: boolean;
  error?: string | null;
  onNew: () => void;
  onSelect: (workflowId: string) => void;
  onRetry?: () => void;
}

export function WorkflowDefinitionList({
  definitions,
  loading = false,
  error = null,
  onNew,
  onSelect,
  onRetry,
}: WorkflowDefinitionListProps) {
  return (
    <ProductPageShell
      title="Workflows"
      description="Define reusable, sequential agent workflows. Execution is added in the next step."
      actions={(
        <Button type="button" onClick={onNew}>
          <Plus className="size-4" aria-hidden />
          New workflow
        </Button>
      )}
      maxWidthClassName="max-w-5xl"
      telemetryBlocked
    >
      {loading ? (
        <p className="py-6 text-sm text-muted-foreground" role="status">
          Loading workflows
        </p>
      ) : error ? (
        <EmptyState
          title="Could not load workflows"
          description={error}
          action={onRetry ? (
            <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
              <RotateCcw className="size-3.5" aria-hidden />
              Retry
            </Button>
          ) : null}
        />
      ) : definitions.length === 0 ? (
        <EmptyState
          title="No workflows yet"
          description="Create a definition with inputs, stages, and prompts."
          action={(
            <Button type="button" variant="secondary" size="sm" onClick={onNew}>
              <Plus className="size-3.5" aria-hidden />
              New workflow
            </Button>
          )}
        />
      ) : (
        <div className="overflow-clip rounded-lg border border-border bg-card">
          {definitions.map((definition, index) => (
            <Button
              key={definition.id}
              type="button"
              variant="unstyled"
              size="unstyled"
              onClick={() => onSelect(definition.id)}
              className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-list-hover ${
                index > 0 ? "border-t border-border" : ""
              }`}
            >
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-muted-foreground">
                <Workflow className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {definition.title}
                </span>
                <span className="mt-0.5 block line-clamp-2 text-xs leading-4 text-muted-foreground">
                  {definition.description || workflowSummary(definition)}
                </span>
              </span>
              <span className="shrink-0 pt-1 text-xs text-muted-foreground">
                {formatUpdatedAt(definition.updatedAt)}
              </span>
            </Button>
          ))}
        </div>
      )}
    </ProductPageShell>
  );
}

function workflowSummary(definition: WorkflowDefinition): string {
  const stageLabel = definition.stages.length === 1 ? "stage" : "stages";
  const inputLabel = definition.inputs.length === 1 ? "input" : "inputs";
  return `${definition.stages.length} ${stageLabel} · ${definition.inputs.length} ${inputLabel}`;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}
