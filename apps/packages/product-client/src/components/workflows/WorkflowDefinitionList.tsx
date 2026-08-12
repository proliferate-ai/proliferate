import { Plus, RotateCcw } from "#product/primitives/icons/core";
import { Workflow } from "#product/primitives/icons/product";
import type { WorkflowDefinition } from "#product/domain/workflows/definition";
import { EmptyState } from "#product/primitives/patterns/EmptyState";
import { Button } from "#product/primitives/Button";
import { IconTile } from "#product/primitives/IconTile";
import { Card } from "#product/primitives/patterns/Card";
import { ProductPageShell } from "#product/primitives/patterns/ProductPageShell";
import { RosterRow } from "#product/primitives/patterns/RosterRow";

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
      description="Define reusable agent workflows and inspect their managed Cloud runs."
      actions={(
        <Button type="button" onClick={onNew}>
          <Plus className="icon-paired" aria-hidden />
          New workflow
        </Button>
      )}
      maxWidthClassName="max-w-5xl"
      telemetryBlocked
    >
      {loading ? (
        <p className="py-6 text-body text-muted-foreground" role="status">
          Loading workflows
        </p>
      ) : error ? (
        <EmptyState
          title="Could not load workflows"
          description={error}
          action={onRetry ? (
            <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
              <RotateCcw className="icon-paired" aria-hidden />
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
              <Plus className="icon-paired" aria-hidden />
              New workflow
            </Button>
          )}
        />
      ) : (
        <Card surface="opaque" className="flex flex-col gap-0.5 p-2">
          {definitions.map((definition) => (
            <RosterRow
              key={definition.id}
              density="comfortable"
              leading={(
                <IconTile tone="elevated">
                  <Workflow className="icon-paired" aria-hidden />
                </IconTile>
              )}
              title={definition.title}
              secondary={definition.description || workflowSummary(definition)}
              trailing={formatUpdatedAt(definition.updatedAt)}
              onSelect={() => onSelect(definition.id)}
            />
          ))}
        </Card>
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
