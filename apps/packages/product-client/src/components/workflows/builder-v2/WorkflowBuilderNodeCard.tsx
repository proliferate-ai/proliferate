import type { WorkflowNodeV2 } from "@proliferate/cloud-sdk";
import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import {
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
  /** 1-based position in the chain; the chain IS the card order. */
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
 * One step in the chain. Order is edited with the two move affordances and
 * nothing else — there is no canvas and no drag surface, so "what runs next"
 * is always the card below and the saved edge list is derived from that.
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
          <h3 className="text-body-emphasis font-medium text-foreground">
            {WORKFLOW_BUILDER_COPY.stepHeading(position)}
          </h3>
          <Badge
            size="micro"
            tone={nodeIdInvalid ? "destructive" : "neutral"}
            data-invalid={nodeIdInvalid ? "true" : undefined}
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
          {node.type === "human_in_loop" ? (
            <p className="mt-1 text-ui-sm text-muted-foreground">
              {WORKFLOW_BUILDER_COPY.humanStepNote}
            </p>
          ) : null}
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
 * The optional per-step model. Both selects offer a blank default because
 * `WorkflowNodeV2.model` is optional on the wire: leaving them alone saves no
 * model at all, and the run resolves one.
 *
 * `modeId` is deliberately not offered. The catalog's mode vocabulary is
 * resolved per agent AND per model through the launch-controls projection the
 * composer owns, and guessing a mode id here would write a value the run may
 * reject at session creation.
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
            // Clearing the harness clears the whole model: a modelId without
            // the harness that names it is not a resolvable selection.
            onChange({
              model: nextAgentKind.length > 0 ? { agentKind: nextAgentKind } : null,
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
            model: { agentKind, modelId: event.currentTarget.value || null },
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
    </div>
  );
}
