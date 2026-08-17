import type { CSSProperties } from "react";
import type { WorkflowDocTemplateV2 } from "@proliferate/cloud-sdk";

import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import { Plus } from "#product/primitives/icons/core";
import { FileCode } from "#product/primitives/icons/workspace";

/** The design's rail eyebrow: mono, 0.07em tracking, uppercase, faint. */
const EYEBROW_STYLE: CSSProperties = { letterSpacing: "0.07em" };
const EYEBROW_CLASS = "text-ui-sm font-mono uppercase text-faint";

const RAIL_BUTTON_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  justifyContent: "flex-start",
  padding: "8px 9px",
  borderRadius: 9,
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-elevated)",
  font: "inherit",
  cursor: "pointer",
  textAlign: "left",
};

export interface WorkflowBuilderRailProps {
  width: number;
  compact: boolean;
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
 * The builder's left rail, ported from the design: the step palette (kind
 * dot + label buttons), the numbering hint, and the context-docs roster with
 * its + affordance. It only ever appends and selects — every edit happens in
 * the inspector on the other side of the canvas.
 */
export function WorkflowBuilderRail({
  width,
  compact,
  docTemplates,
  selectedDocIndex,
  disabled,
  addDocDisabled,
  onAddStep,
  onAddDoc,
  onSelectDoc,
}: WorkflowBuilderRailProps) {
  return (
    <div
      id="workflow-builder-rail"
      className="flex shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-border bg-sidebar-background"
      style={{
        width,
        gap: 14,
        padding: compact ? "14px 8px" : "14px 12px",
        alignItems: compact ? "center" : "stretch",
      }}
    >
      <div className="flex flex-col" style={{ gap: 6 }}>
        {!compact ? (
          <span className={EYEBROW_CLASS} style={EYEBROW_STYLE}>
            {WORKFLOW_BUILDER_COPY.addStepHeading}
          </span>
        ) : null}
        <button
          type="button"
          title={WORKFLOW_BUILDER_COPY.addAgentStepTitle}
          aria-label={WORKFLOW_BUILDER_COPY.addAgentStepTitle}
          disabled={disabled}
          className="text-ui-sm text-foreground hover:border-border-heavy hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            ...RAIL_BUTTON_STYLE,
            gap: compact ? 0 : 8,
            justifyContent: compact ? "center" : "flex-start",
            width: compact ? 34 : "100%",
            height: compact ? 34 : "auto",
            padding: compact ? 0 : "8px 9px",
          }}
          onClick={() => onAddStep("agent")}
        >
          <span
            aria-hidden
            style={{ width: 7, height: 7, borderRadius: 999, flex: "none", background: "var(--color-info)" }}
          />
          {!compact ? <span>{WORKFLOW_BUILDER_COPY.addAgentStepLabel}</span> : null}
        </button>
        <button
          type="button"
          title={WORKFLOW_BUILDER_COPY.addHumanStepTitle}
          aria-label={WORKFLOW_BUILDER_COPY.addHumanStepTitle}
          disabled={disabled}
          className="text-ui-sm text-foreground hover:border-border-heavy hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            ...RAIL_BUTTON_STYLE,
            gap: compact ? 0 : 8,
            justifyContent: compact ? "center" : "flex-start",
            width: compact ? 34 : "100%",
            height: compact ? 34 : "auto",
            padding: compact ? 0 : "8px 9px",
          }}
          onClick={() => onAddStep("human_in_loop")}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              flex: "none",
              background: "var(--color-compute-target-amber)",
            }}
          />
          {!compact ? <span>{WORKFLOW_BUILDER_COPY.addHumanStepLabel}</span> : null}
        </button>
      </div>

      <div className="flex w-full flex-col border-t border-border" style={{ gap: 6, paddingTop: 12 }}>
        <div
          className="flex w-full items-center"
          style={{ gap: compact ? 0 : 6, justifyContent: compact ? "center" : "flex-start" }}
        >
          {!compact ? (
            <span className={EYEBROW_CLASS} style={EYEBROW_STYLE}>
              {WORKFLOW_BUILDER_COPY.contextDocsHeading}
            </span>
          ) : null}
          {!compact && docTemplates.length > 0 ? (
            <span className="text-ui-sm font-mono text-faint">
              {WORKFLOW_BUILDER_COPY.contextDocsCount(docTemplates.length)}
            </span>
          ) : null}
          {!compact ? <span className="flex-1" /> : null}
          <button
            type="button"
            aria-label={WORKFLOW_BUILDER_COPY.addDocLabel}
            title={addDocDisabled ? WORKFLOW_BUILDER_COPY.docsNeedStep : WORKFLOW_BUILDER_COPY.addDocLabel}
            disabled={disabled || addDocDisabled}
            className="grid shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-faint hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            style={{ width: 20, height: 20 }}
            onClick={onAddDoc}
          >
            <Plus className="icon-paired" aria-hidden />
          </button>
        </div>
        {!compact && docTemplates.length === 0 ? (
          <p className="text-ui-sm m-0 text-faint" style={{ textWrap: "pretty" }}>
            {WORKFLOW_BUILDER_COPY.contextDocsEmpty}
          </p>
        ) : (
          <div className="flex flex-col" style={{ gap: 2 }}>
            {docTemplates.map((doc, index) => {
              const selected = index === selectedDocIndex;
              return (
                <button
                  key={index}
                  type="button"
                  aria-pressed={selected}
                  className="text-ui-sm hover:bg-hover hover:text-foreground"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: compact ? 0 : 7,
                    justifyContent: compact ? "center" : "flex-start",
                    padding: compact ? 0 : "5px 7px",
                    width: compact ? 34 : "100%",
                    height: compact ? 34 : "auto",
                    borderRadius: 8,
                    border: `1px solid ${selected ? "var(--color-border-heavy)" : "transparent"}`,
                    background: selected ? "var(--color-surface-elevated)" : "transparent",
                    color: "var(--color-muted-foreground)",
                    font: "inherit",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  onClick={() => onSelectDoc(index)}
                >
                  <span className="flex shrink-0 text-faint">
                    <FileCode className="icon-paired" aria-hidden />
                  </span>
                  {!compact ? (
                    <span className="min-w-0 truncate">
                      {doc.slug.trim() || WORKFLOW_BUILDER_COPY.docUntitledRow}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
