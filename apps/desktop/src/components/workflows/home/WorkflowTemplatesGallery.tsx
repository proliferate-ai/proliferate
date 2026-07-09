import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from "@proliferate/product-domain/workflows/templates";
import { workflowStepStrip } from "@proliferate/product-domain/workflows/presentation";
import { Button } from "@proliferate/ui/primitives/Button";
import { WorkflowStepGlyphStrip } from "@proliferate/product-ui/workflows/WorkflowStepGlyphStrip";
import { Plus, RefreshCw } from "@proliferate/ui/icons";

export interface WorkflowTemplatesGalleryProps {
  busy?: boolean;
  onUseTemplate: (template: WorkflowTemplate) => void;
  onStartFromScratch: () => void;
  /** Flow 1 (workflow-from-poll, mental-model §5) entry point. */
  onStartFromPoll: () => void;
}

/**
 * The templates gallery that IS the empty state (spec 3.6): 5 curated starters
 * plus "start from scratch" and "start from a poll feed".
 */
export function WorkflowTemplatesGallery({
  busy = false,
  onUseTemplate,
  onStartFromScratch,
  onStartFromPoll,
}: WorkflowTemplatesGalleryProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-ui font-medium text-foreground">Start from a template</h2>
          <p className="text-ui-sm text-muted-foreground">
            Curated starters, or build your own from scratch.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onStartFromPoll} disabled={busy}>
            <RefreshCw className="size-3.5" />
            From a poll feed
          </Button>
          <Button variant="secondary" size="sm" onClick={onStartFromScratch} disabled={busy}>
            <Plus className="size-3.5" />
            From scratch
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {WORKFLOW_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            disabled={busy}
            onClick={() => onUseTemplate(template)}
            className="flex flex-col gap-2 rounded-[12px] border border-border bg-background p-4 text-left transition-colors hover:border-foreground/25 disabled:opacity-60"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-ui font-medium text-foreground">{template.name}</span>
              <WorkflowStepGlyphStrip glyphs={workflowStepStrip(template.definition)} />
            </div>
            <span className="text-ui-sm text-muted-foreground">{template.tagline}</span>
            <span className="mt-1 text-xs text-faint">{template.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
