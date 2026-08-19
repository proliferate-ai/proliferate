import type { WorkflowNodeV2 } from "@proliferate/cloud-sdk";
import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import {
  workflowBuilderControlOptions,
  workflowBuilderModelOptions,
  type WorkflowBuilderHarnessOption,
} from "#product/lib/domain/workflows/workflow-builder-authoring";
import type { WorkflowBuilderIssue } from "#product/lib/domain/workflows/workflow-builder-validation";
import { WorkflowBuilderPromptField } from "#product/components/workflows/builder-v2/WorkflowBuilderPromptField";
import { Badge } from "#product/primitives/Badge";
import { Button } from "#product/primitives/Button";
import { ArrowDown, ArrowUp, Trash } from "#product/primitives/icons/core";
import { Input } from "#product/primitives/Input";
import { Label } from "#product/primitives/Label";
import { Card } from "#product/primitives/patterns/Card";
import { Select } from "#product/primitives/Select";
import { Switch } from "#product/primitives/Switch";

export interface WorkflowBuilderNodeCardProps {
  node: WorkflowNodeV2;
  /** 1-based display position; authored edges are unchanged by moving it. */
  position: number;
  nodeCount: number;
  harnesses: readonly WorkflowBuilderHarnessOption[];
  /** Validator issues already narrowed to this node. */
  issues: readonly WorkflowBuilderIssue[];
  inputNames: ReadonlySet<string>;
  docSlugs: ReadonlySet<string>;
  disabled: boolean;
  onChange: (patch: Partial<Omit<WorkflowNodeV2, "id">>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

/**
 * One step in the graph. The move affordances change deterministic display
 * order only; connection ports on the canvas own execution edges.
 */
export function WorkflowBuilderNodeCard({
  node,
  position,
  nodeCount,
  harnesses,
  issues,
  inputNames,
  docSlugs,
  disabled,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: WorkflowBuilderNodeCardProps) {
  const fieldPrefix = `workflow-builder-node-${node.id}`;
  const promptInvalid = issues.some((issue) =>
    issue.code === "unknown_input_ref"
    || issue.code === "unknown_doc_ref"
    || issue.code === "malformed_reference");
  // Ids are minted, never typed, so the only way to reach an id error is to
  // open a definition authored elsewhere. The badge IS the id's field, so the
  // error is marked on it rather than only in the card's issue list.
  const nodeIdInvalid = issues.some((issue) =>
    issue.code === "invalid_node_id" || issue.code === "duplicate_node_id");

  return (
    <Card as="section" surface="opaque" className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="shrink-0 whitespace-nowrap text-body-emphasis font-medium text-foreground">
            {WORKFLOW_BUILDER_COPY.stepHeading(position)}
          </h3>
          <Badge
            size="micro"
            tone={nodeIdInvalid ? "destructive" : "neutral"}
            data-invalid={nodeIdInvalid ? "true" : undefined}
            className="min-w-0 truncate"
          >
            {node.id}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={WORKFLOW_BUILDER_COPY.moveStepUpLabel(position)}
            disabled={disabled || position === 1}
            onClick={onMoveUp}
          >
            <ArrowUp className="icon-paired" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={WORKFLOW_BUILDER_COPY.moveStepDownLabel(position)}
            disabled={disabled || position === nodeCount}
            onClick={onMoveDown}
          >
            <ArrowDown className="icon-paired" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={WORKFLOW_BUILDER_COPY.removeStepLabel(position)}
            disabled={disabled || nodeCount === 1}
            onClick={onRemove}
          >
            <Trash className="icon-paired" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <Label htmlFor={`${fieldPrefix}-title`}>
            {WORKFLOW_BUILDER_COPY.stepTitleLabel}
          </Label>
          <Input
            id={`${fieldPrefix}-title`}
            value={node.title}
            disabled={disabled}
            placeholder={WORKFLOW_BUILDER_COPY.stepTitlePlaceholder}
            onChange={(event) => onChange({ title: event.currentTarget.value })}
          />
        </div>
        <div>
          <Label htmlFor={`${fieldPrefix}-approval`}>
            {WORKFLOW_BUILDER_COPY.requiresApprovalLabel}
          </Label>
          {/* Approval does not narrow configuration: a gated step runs the
              same agent session (the engine's launch path is shared and every
              schema allows `model` on both kinds) and then parks for the
              approval — so the model pick survives the toggle and the fields
              below stay. */}
          <div className="flex h-9 items-center">
            <Switch
              id={`${fieldPrefix}-approval`}
              checked={node.type === "human_in_loop"}
              disabled={disabled}
              onChange={(requiresApproval) => onChange({
                type: requiresApproval ? "human_in_loop" : "agent",
              })}
            />
          </div>
        </div>
      </div>

      <WorkflowBuilderNodeModelFields
        fieldPrefix={fieldPrefix}
        node={node}
        harnesses={harnesses}
        disabled={disabled}
        onChange={onChange}
      />

      <div className="mt-3">
        <WorkflowBuilderPromptField
          fieldId={`${fieldPrefix}-prompt`}
          value={node.prompt}
          disabled={disabled}
          inputNames={inputNames}
          docSlugs={docSlugs}
          invalid={promptInvalid}
          onChange={(prompt) => onChange({ prompt })}
        />
      </div>

      {issues.length > 0 ? (
        <div className="mt-3 space-y-1" role="alert">
          {issues.map((issue, index) => (
            <p key={`${issue.code}:${issue.ref ?? ""}:${index}`} className="text-ui text-destructive">
              {issue.message}
            </p>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * The optional per-step launch selection. Every executable row and default is
 * copied from this target's observed launch options; saved raw IDs are
 * revalidated by session creation when the workflow executes.
 */
function WorkflowBuilderNodeModelFields({
  fieldPrefix,
  node,
  harnesses,
  disabled,
  onChange,
}: {
  fieldPrefix: string;
  node: WorkflowNodeV2;
  harnesses: readonly WorkflowBuilderHarnessOption[];
  disabled: boolean;
  onChange: (patch: Partial<Omit<WorkflowNodeV2, "id">>) => void;
}) {
  const agentKind = node.model?.agentKind ?? "";
  const modelId = node.model?.modelId ?? "";
  const modelOptions = workflowBuilderModelOptions(harnesses, agentKind);
  const controlOptions = workflowBuilderControlOptions(harnesses, agentKind);
  const harnessUnavailable = agentKind.length > 0
    && !harnesses.some((harness) => harness.agentKind === agentKind);
  const modelUnavailable = modelId.length > 0
    && !modelOptions.some((option) => option.id === modelId);

  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor={`${fieldPrefix}-harness`}>
          {WORKFLOW_BUILDER_COPY.harnessLabel}
        </Label>
        <Select
          id={`${fieldPrefix}-harness`}
          value={agentKind}
          disabled={disabled}
          onChange={(event) => {
            const nextAgentKind = event.currentTarget.value;
            const nextHarness = harnesses.find(
              (harness) => harness.agentKind === nextAgentKind,
            );
            // Clearing the harness clears the whole model: a modelId without
            // the harness that names it is not a resolvable selection.
            onChange({
              model: nextAgentKind.length > 0 ? {
                agentKind: nextAgentKind,
                modelId: null,
                controlValues: Object.fromEntries(
                  (nextHarness?.controls ?? [])
                    .filter((control) => control.defaultValue !== null)
                    .map((control) => [control.key, control.defaultValue as string]),
                ),
              } : null,
            });
          }}
        >
          <option value="">{WORKFLOW_BUILDER_COPY.harnessDefaultOption}</option>
          {harnessUnavailable ? (
            <option value={agentKind}>
              {WORKFLOW_BUILDER_COPY.harnessUnavailableOption(agentKind)}
            </option>
          ) : null}
          {harnesses.map((harness) => (
            <option key={harness.agentKind} value={harness.agentKind}>{harness.label}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`${fieldPrefix}-model`}>{WORKFLOW_BUILDER_COPY.modelLabel}</Label>
        <Select
          id={`${fieldPrefix}-model`}
          value={modelId}
          disabled={disabled || agentKind.length === 0}
          onChange={(event) => onChange({
            model: {
              agentKind,
              modelId: event.currentTarget.value || null,
              controlValues: node.model?.controlValues ?? {},
            },
          })}
        >
          <option value="">{WORKFLOW_BUILDER_COPY.modelDefaultOption}</option>
          {modelUnavailable ? (
            <option value={modelId}>
              {WORKFLOW_BUILDER_COPY.modelUnavailableOption(modelId)}
            </option>
          ) : null}
          {modelOptions.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </Select>
      </div>
      {controlOptions.map((control) => {
        const selectedValue = node.model?.controlValues?.[control.key]
          ?? control.defaultValue
          ?? "";
        const unavailable = selectedValue.length > 0
          && !control.values.some((value) => value.value === selectedValue);
        return (
          <div key={control.key}>
            <Label htmlFor={`${fieldPrefix}-control-${control.key}`}>{control.label}</Label>
            <Select
              id={`${fieldPrefix}-control-${control.key}`}
              value={selectedValue}
              disabled={disabled || agentKind.length === 0}
              onChange={(event) => {
                const nextValue = event.currentTarget.value;
                const nextControlValues = { ...(node.model?.controlValues ?? {}) };
                if (nextValue) nextControlValues[control.key] = nextValue;
                else delete nextControlValues[control.key];
                onChange({
                  model: {
                    agentKind,
                    modelId: node.model?.modelId ?? null,
                    controlValues: nextControlValues,
                  },
                });
              }}
            >
              <option value="">Harness default</option>
              {unavailable ? <option value={selectedValue}>{selectedValue} (unavailable)</option> : null}
              {control.values.map((value) => (
                <option key={value.value} value={value.value}>{value.label}</option>
              ))}
            </Select>
          </div>
        );
      })}
    </div>
  );
}
