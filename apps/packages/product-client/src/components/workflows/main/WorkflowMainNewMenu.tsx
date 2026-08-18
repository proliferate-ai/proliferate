import type { WorkflowStarterTemplateV2 } from "#product/config/workflows/starter-templates";
import { WORKFLOW_STARTER_TEMPLATES_V2 } from "#product/config/workflows/starter-templates";
import { WORKFLOW_MAIN_COPY } from "#product/copy/workflows/workflow-main-copy";
import { Button } from "#product/primitives/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#product/primitives/DropdownMenu";
import { Plus } from "#product/primitives/icons/core";

/**
 * The main page's one "New workflow" affordance: a blank chain, or one of the
 * starter templates. A menu rather than a split button — this page has no
 * other split-button precedent to match, and a menu keeps "blank" and "from
 * template" as equal, nameable choices instead of a primary/secondary click
 * split a reader has to learn.
 */
export function WorkflowMainNewMenu({
  onNew,
}: {
  onNew: (template: WorkflowStarterTemplateV2 | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="primary" size="md" aria-label={WORKFLOW_MAIN_COPY.newMenuLabel}>
          <Plus className="icon-paired" aria-hidden />
          {WORKFLOW_MAIN_COPY.newWorkflowLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[240px]">
        {/*
          * No shortcut badge beside this item: ⌘N is already bound app-wide to
          * `workspace.new-default` (open new chat), so a badge here would name
          * a keystroke that does something else.
          */}
        <DropdownMenuItem onSelect={() => onNew(null)}>
          {WORKFLOW_MAIN_COPY.newBlankLabel}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2.5 py-1 text-ui-sm text-muted-foreground">
          {WORKFLOW_MAIN_COPY.newFromTemplateSectionLabel}
        </div>
        {WORKFLOW_STARTER_TEMPLATES_V2.map((template) => (
          <DropdownMenuItem key={template.slug} onSelect={() => onNew(template)}>
            {template.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
