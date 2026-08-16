import type { WorkflowDocTemplateV2 } from "@proliferate/cloud-sdk";

import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import { Button } from "#product/primitives/Button";
import { IconButton } from "#product/primitives/IconButton";
import { Plus } from "#product/primitives/icons/core";
import { FileCode } from "#product/primitives/icons/workspace";
import { StatusDot } from "#product/primitives/StatusDot";

export interface WorkflowBuilderRailProps {
  docTemplates: readonly WorkflowDocTemplateV2[];
  /** Index of the doc selected in the inspector, or `null`. */
  selectedDocIndex: number | null;
  disabled: boolean;
  /** No chain step yet — a document needs a step to be written by. */
  addDocDisabled: boolean;
  onAddStep(type: "agent" | "human_in_loop"): void;
  onAddDoc(): void;
  onSelectDoc(index: number): void;
}

/**
 * The builder's left rail: the step palette and the context-docs roster. It
 * only ever appends and selects — every edit happens in the inspector on the
 * other side of the canvas, so this stays a launcher, not a form.
 */
export function WorkflowBuilderRail({
  docTemplates,
  selectedDocIndex,
  disabled,
  addDocDisabled,
  onAddStep,
  onAddDoc,
  onSelectDoc,
}: WorkflowBuilderRailProps) {
  return (
    <div className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border/70 px-3 py-3">
      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-ui-sm uppercase tracking-wide text-muted-foreground">
          {WORKFLOW_BUILDER_COPY.addStepHeading}
        </h2>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="justify-start"
          disabled={disabled}
          onClick={() => onAddStep("agent")}
        >
          <StatusDot tone="info" />
          {WORKFLOW_BUILDER_COPY.addAgentStepLabel}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="justify-start"
          disabled={disabled}
          onClick={() => onAddStep("human_in_loop")}
        >
          <StatusDot tone="warning" />
          {WORKFLOW_BUILDER_COPY.addHumanStepLabel}
        </Button>
        <p className="text-ui-sm text-muted-foreground">
          {WORKFLOW_BUILDER_COPY.railHelp}
        </p>
      </section>

      <section className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 truncate font-mono text-ui-sm uppercase tracking-wide text-muted-foreground">
            {WORKFLOW_BUILDER_COPY.contextDocsHeading}
            {docTemplates.length > 0 ? (
              <span className="ml-1.5 normal-case tracking-normal">
                {WORKFLOW_BUILDER_COPY.contextDocsCount(docTemplates.length)}
              </span>
            ) : null}
          </h2>
          <IconButton
            size="sm"
            aria-label={WORKFLOW_BUILDER_COPY.addDocLabel}
            title={addDocDisabled ? WORKFLOW_BUILDER_COPY.docsNeedStep : WORKFLOW_BUILDER_COPY.addDocLabel}
            disabled={disabled || addDocDisabled}
            onClick={onAddDoc}
          >
            <Plus className="icon-compact" aria-hidden />
          </IconButton>
        </div>
        {docTemplates.length === 0 ? (
          <p className="text-ui-sm text-muted-foreground">
            {WORKFLOW_BUILDER_COPY.contextDocsEmpty}
          </p>
        ) : (
          docTemplates.map((doc, index) => (
            <button
              key={index}
              type="button"
              aria-pressed={index === selectedDocIndex}
              className={`flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition-colors ${
                index === selectedDocIndex
                  ? "border-info ring-2 ring-info/30"
                  : "border-transparent hover:bg-hover"
              }`}
              onClick={() => onSelectDoc(index)}
            >
              <FileCode className="icon-compact shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate font-mono text-ui-sm text-foreground">
                {doc.slug.trim() || WORKFLOW_BUILDER_COPY.docUntitledRow}
              </span>
            </button>
          ))
        )}
      </section>
    </div>
  );
}
