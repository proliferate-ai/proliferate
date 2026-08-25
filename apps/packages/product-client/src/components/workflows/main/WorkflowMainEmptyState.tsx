import type { WorkflowStarterTemplateV2 } from "#product/config/workflows/starter-templates";
import { WORKFLOW_STARTER_TEMPLATES_V2 } from "#product/config/workflows/starter-templates";
import { WORKFLOW_MAIN_COPY } from "#product/copy/workflows/workflow-main-copy";
import { Button } from "#product/primitives/Button";
import { IconTile } from "#product/primitives/IconTile";
import { Workflow } from "#product/primitives/icons/product";
import { Card } from "#product/primitives/patterns/Card";
import { EmptyState } from "#product/primitives/patterns/EmptyState";

function WorkflowStarterTemplateCard({
  template,
  onUse,
}: {
  template: WorkflowStarterTemplateV2;
  onUse: () => void;
}) {
  return (
    <Card surface="opaque" className="flex flex-col gap-2 p-4 text-left">
      <div className="flex items-center gap-2">
        <IconTile tone="elevated">
          <Workflow className="icon-paired" aria-hidden />
        </IconTile>
        <span className="text-body font-medium text-foreground">{template.title}</span>
      </div>
      <p className="line-clamp-3 text-ui-sm text-muted-foreground">{template.description}</p>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-auto self-start"
        onClick={onUse}
      >
        {WORKFLOW_MAIN_COPY.useTemplateLabel}
      </Button>
    </Card>
  );
}

/**
 * The no-workflows-yet state: the starter templates presented as cards (the
 * empty state's real entry point) with a plain "start blank" path beneath
 * them for anyone who wants to skip the templates entirely.
 */
export function WorkflowMainEmptyState({
  onNew,
}: {
  onNew: (template: WorkflowStarterTemplateV2 | null) => void;
}) {
  return (
    <EmptyState
      title={WORKFLOW_MAIN_COPY.emptyTitle}
      description={WORKFLOW_MAIN_COPY.emptyDescription}
      action={(
        <div className="flex w-full max-w-2xl flex-col items-center gap-4">
          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
            {WORKFLOW_STARTER_TEMPLATES_V2.map((template) => (
              <WorkflowStarterTemplateCard
                key={template.slug}
                template={template}
                onUse={() => onNew(template)}
              />
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onNew(null)}>
            {WORKFLOW_MAIN_COPY.startBlankLabel}
          </Button>
        </div>
      )}
    />
  );
}
