import type { CSSProperties } from "react";
import type { WorkflowNodeV2 } from "@proliferate/cloud-sdk";

import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import type { WorkflowBuilderHarnessOption } from "#product/lib/domain/workflows/workflow-builder-authoring";
import type { WorkflowBuilderIssue } from "#product/lib/domain/workflows/workflow-builder-validation";
import { WorkflowBuilderPromptField } from "#product/components/workflows/builder-v2/WorkflowBuilderPromptField";
import { ArrowDown, ArrowUp } from "#product/primitives/icons/core";
import { Switch } from "#product/primitives/Switch";

/**
 * The design's inspector field chrome, shared by the node and doc inspectors:
 * mono uppercase eyebrows over compact bordered fields on the elevated
 * surface. Inline values are the design's own (10px eyebrows, radius-7
 * fields, 12–13px field text).
 */
export const INSPECTOR_EYEBROW_CLASS = "text-ui-sm font-mono uppercase text-faint";
export const INSPECTOR_EYEBROW_STYLE: CSSProperties = { letterSpacing: "0.07em" };
export const INSPECTOR_FIELD_STYLE: CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: 7,
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-elevated)",
  color: "var(--color-foreground)",
  font: "inherit",
  outline: "none",
};
/** Ramp class every inspector field wears with the style above. */
export const INSPECTOR_FIELD_CLASS = "text-ui-sm";
export const INSPECTOR_TEXTAREA_STYLE: CSSProperties = {
  ...INSPECTOR_FIELD_STYLE,
  padding: "7px 8px",
  lineHeight: "17px",
  resize: "vertical",
};
export const INSPECTOR_DESTRUCTIVE_BUTTON_STYLE: CSSProperties = {
  alignSelf: "flex-start",
  padding: "5px 10px",
  borderRadius: 7,
  border: "1px solid var(--color-border)",
  background: "transparent",
  color: "var(--color-destructive)",
  font: "inherit",
  cursor: "pointer",
};

/** The design's kind vocabulary for the inspector header. */
const KIND = {
  agent: { label: "Agent", accent: "var(--color-info)" },
  human_in_loop: {
    label: "Human in the loop",
    accent: "var(--color-compute-target-amber)",
  },
} as const;

export interface WorkflowBuilderNodeInspectorProps {
  node: WorkflowNodeV2;
  /** Zero-based index outward from the structural input node. */
  index: number;
  nodeCount: number;
  harnesses: readonly WorkflowBuilderHarnessOption[];
  /** Validator issues already narrowed to this node. */
  issues: readonly WorkflowBuilderIssue[];
  disabled: boolean;
  onChange: (patch: Partial<Omit<WorkflowNodeV2, "id">>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

/**
 * One chain step in the right pane, in the design's inspector anatomy: the
 * kind header (accent dot, kind label, index right-aligned), the step name,
 * then eyebrowed sections. The fields stay the contract's — name, the
 * approval gate, harness/model, prompt — presented in the design's chrome;
 * reordering and removal live at the inspector's foot because the canvas
 * draws the chain and offers no edge editing.
 */
export function WorkflowBuilderNodeInspector({
  node,
  index,
  nodeCount,
  harnesses,
  issues,
  disabled,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: WorkflowBuilderNodeInspectorProps) {
  const kind = node.type === "human_in_loop" ? KIND.human_in_loop : KIND.agent;
  const position = index + 1;
  const fieldPrefix = `workflow-builder-node-${node.id}`;
  const promptInvalid = issues.some((issue) =>
    issue.code === "malformed_reference"
    || issue.code === "unknown_input_ref"
    || issue.code === "unknown_doc_ref");
  const agentKind = node.model?.agentKind ?? "";
  const modelId = node.model?.modelId ?? "";
  const selectedModelValue = agentKind.length > 0
    ? modelSelectValue(agentKind, modelId)
    : "";
  const selectedModelAvailable = agentKind.length === 0 || harnesses.some((harness) =>
    harness.agentKind === agentKind
    && (modelId.length === 0 || harness.models.some((model) => model.id === modelId)));

  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      <div className="flex flex-col" style={{ gap: 7 }}>
        <div className="flex items-center" style={{ gap: 7 }}>
          <span
            aria-hidden
            style={{ width: 7, height: 7, borderRadius: 999, flex: "none", background: kind.accent }}
          />
          <span
            className={`min-w-0 truncate ${INSPECTOR_EYEBROW_CLASS}`}
            style={{ ...INSPECTOR_EYEBROW_STYLE, letterSpacing: "0.06em" }}
          >
            {kind.label}
          </span>
          <span className="text-ui-sm ml-auto flex-none font-mono text-faint">
            {String(index).padStart(2, "0")}
          </span>
        </div>
        <input
          type="text"
          value={node.title}
          aria-label={WORKFLOW_BUILDER_COPY.stepTitleLabel}
          placeholder={WORKFLOW_BUILDER_COPY.stepTitlePlaceholder}
          disabled={disabled}
          className="text-ui"
          style={INSPECTOR_FIELD_STYLE}
          onChange={(event) => onChange({ title: event.currentTarget.value })}
        />
      </div>

      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        <label
          htmlFor={`${fieldPrefix}-approval`}
          className={INSPECTOR_EYEBROW_CLASS}
          style={INSPECTOR_EYEBROW_STYLE}
        >
          {WORKFLOW_BUILDER_COPY.requiresApprovalLabel}
        </label>
        {/* Approval does not narrow configuration: a gated step runs the same
            agent session and then parks for the approval — so the model pick
            survives the toggle and the fields below stay. */}
        <Switch
          id={`${fieldPrefix}-approval`}
          checked={node.type === "human_in_loop"}
          disabled={disabled}
          onChange={(requiresApproval) => onChange({
            type: requiresApproval ? "human_in_loop" : "agent",
          })}
        />
      </div>
      <div className="flex flex-col" style={{ gap: 7 }}>
        <span className={INSPECTOR_EYEBROW_CLASS} style={INSPECTOR_EYEBROW_STYLE}>
          {WORKFLOW_BUILDER_COPY.modelSectionHeading}
        </span>
        <select
          value={selectedModelValue}
          aria-label={WORKFLOW_BUILDER_COPY.modelLabel}
          disabled={disabled}
          className={INSPECTOR_FIELD_CLASS}
          style={INSPECTOR_FIELD_STYLE}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value.length === 0) {
              onChange({ model: null });
              return;
            }
            const [nextAgentKind, nextModelId] = JSON.parse(value) as [string, string];
            onChange({
              model: {
                agentKind: nextAgentKind,
                modelId: nextModelId || null,
                modeId: node.model?.modeId ?? null,
              },
            });
          }}
        >
          <option value="">{WORKFLOW_BUILDER_COPY.harnessDefaultOption}</option>
          {!selectedModelAvailable ? (
            <option value={selectedModelValue}>
              {WORKFLOW_BUILDER_COPY.modelUnavailableOption(
                modelId.length > 0 ? `${agentKind} · ${modelId}` : agentKind,
              )}
            </option>
          ) : null}
          {harnesses.map((harness) => (
            <optgroup key={harness.agentKind} label={harness.label}>
              <option value={modelSelectValue(harness.agentKind, "")}>
                {WORKFLOW_BUILDER_COPY.modelHarnessDefaultOption(harness.label)}
              </option>
              {harness.models.map((model) => (
                <option
                  key={model.id}
                  value={modelSelectValue(harness.agentKind, model.id)}
                >
                  {model.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <WorkflowBuilderPromptField
        fieldId={`${fieldPrefix}-prompt`}
        value={node.prompt}
        disabled={disabled}
        invalid={promptInvalid}
        onChange={(prompt) => onChange({ prompt })}
      />

      {issues.length > 0 ? (
        <div className="space-y-1" role="alert">
          {issues.map((issue, index) => (
            <p key={`${issue.code}:${issue.ref ?? ""}:${index}`} className="text-ui m-0 text-destructive">
              {issue.message}
            </p>
          ))}
        </div>
      ) : null}

      <div className="flex items-center" style={{ gap: 6 }}>
        <button
          type="button"
          disabled={disabled}
          className="text-ui-sm hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
          style={INSPECTOR_DESTRUCTIVE_BUTTON_STYLE}
          onClick={onRemove}
        >
          {WORKFLOW_BUILDER_COPY.deleteNodeLabel}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          aria-label={WORKFLOW_BUILDER_COPY.moveStepUpLabel(position)}
          title={WORKFLOW_BUILDER_COPY.moveStepUpLabel(position)}
          disabled={disabled || position <= 1}
          className="grid cursor-pointer place-items-center rounded-md border-0 bg-transparent text-faint hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          style={{ width: 22, height: 22 }}
          onClick={onMoveUp}
        >
          <ArrowUp className="icon-compact" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={WORKFLOW_BUILDER_COPY.moveStepDownLabel(position)}
          title={WORKFLOW_BUILDER_COPY.moveStepDownLabel(position)}
          disabled={disabled || position >= nodeCount}
          className="grid cursor-pointer place-items-center rounded-md border-0 bg-transparent text-faint hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          style={{ width: 22, height: 22 }}
          onClick={onMoveDown}
        >
          <ArrowDown className="icon-compact" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function modelSelectValue(agentKind: string, modelId: string): string {
  return JSON.stringify([agentKind, modelId]);
}
