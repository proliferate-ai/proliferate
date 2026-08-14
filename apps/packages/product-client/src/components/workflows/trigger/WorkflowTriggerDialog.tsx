import { useMemo, useState } from "react";
import type {
  WorkflowArgumentsV2,
  WorkflowDefinitionRecordV2,
  WorkflowInputV2,
  WorkflowPlacementModeV2,
} from "@proliferate/cloud-sdk";
import { WORKFLOW_TRIGGER_COPY } from "#product/copy/workflows/workflow-trigger-copy";
import {
  useWorkflowTriggerActions,
  type WorkflowTriggerLaunch,
} from "#product/hooks/workflows/workflows/use-workflow-trigger-actions";
import { useWorkflowTriggerRepositoriesAccess } from "#product/hooks/access/cloud/workflows/use-workflow-trigger-access";
import { workflowRepositoryOptions } from "#product/lib/domain/workflows/workflow-definition-authoring";
import { Button } from "#product/primitives/Button";
import { Input } from "#product/primitives/Input";
import { Label } from "#product/primitives/Label";
import { ModalShell } from "#product/primitives/patterns/ModalShell";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";
import { SegmentedControl } from "#product/primitives/SegmentedControl";
import { Select } from "#product/primitives/Select";

export interface WorkflowTriggerDialogProps {
  definitionRecord: WorkflowDefinitionRecordV2;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLaunched: (launch: WorkflowTriggerLaunch) => void;
  /**
   * Same per-account cache scope every other workflows surface threads from
   * `WorkflowsPage` (the signed-in user id). Not defaulted here: a shared
   * default would pool one account's repo configs and invocations with
   * another's.
   */
  authCacheScope: string;
}

interface TriggerFormState {
  key: string;
  values: Record<string, string>;
  repoConfigId: string;
  mode: WorkflowPlacementModeV2;
}

/**
 * The gen-2 "run this workflow" dialog: one field per declared input, where
 * the run should be placed, and a Confirm that hands the whole thing to the
 * trigger courier. It composes existing primitives only — the modal frame,
 * the field controls, and the placement segment all belong to the library.
 */
export function WorkflowTriggerDialog({
  definitionRecord,
  open,
  onOpenChange,
  onLaunched,
  authCacheScope,
}: WorkflowTriggerDialogProps) {
  const inputs = definitionRecord.definitionJson.inputs;
  const { triggerRun, triggering, error } = useWorkflowTriggerActions({
    authCacheScope,
    onLaunched,
  });
  const repositoriesQuery = useWorkflowTriggerRepositoriesAccess(authCacheScope, open);
  const repositories = useMemo(
    () => workflowRepositoryOptions(repositoriesQuery.data?.repositories ?? []),
    [repositoriesQuery.data?.repositories],
  );

  // Re-seeding on the derived key (rather than an effect) is gen-1's
  // argument-draft idiom: reopening the dialog, or opening it on another
  // definition, starts from the definition's own defaults.
  const formKey = `${definitionRecord.id}:${definitionRecord.revision}:${open}`;
  const [formState, setFormState] = useState<TriggerFormState>(
    () => freshTriggerForm(formKey, definitionRecord),
  );
  const form = formState.key === formKey
    ? formState
    : freshTriggerForm(formKey, definitionRecord);

  const savedRepositoryUnavailable = form.repoConfigId.length > 0
    && !repositories.some((repository) => repository.id === form.repoConfigId);
  const requiredInputsSupplied = inputs.every(
    (input) => !input.required || form.values[input.name]?.trim(),
  );
  const confirmDisabled = triggering
    || !requiredInputsSupplied
    || form.repoConfigId.trim().length === 0;

  const submit = () => {
    void triggerRun({
      workflowDefinitionId: definitionRecord.id,
      arguments: collectArguments(inputs, form.values),
      placement: { repoConfigId: form.repoConfigId, mode: form.mode },
    });
  };

  return (
    <ModalShell
      open={open}
      onClose={() => onOpenChange(false)}
      disableClose={triggering}
      title={definitionRecord.title}
      description={WORKFLOW_TRIGGER_COPY.description}
      sizeClassName="max-w-lg"
      footer={(
        <>
          <Button
            type="button"
            variant="ghost"
            size="md"
            disabled={triggering}
            onClick={() => onOpenChange(false)}
          >
            {WORKFLOW_TRIGGER_COPY.cancelLabel}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            loading={triggering}
            disabled={confirmDisabled}
            onClick={submit}
          >
            {WORKFLOW_TRIGGER_COPY.confirmLabel}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        {error ? <NoticeBanner tone="destructive">{error}</NoticeBanner> : null}
        {repositoriesQuery.isError ? (
          <NoticeBanner tone="warning">
            {WORKFLOW_TRIGGER_COPY.repositoriesLoadFailed}
          </NoticeBanner>
        ) : null}

        {inputs.length === 0 ? (
          <p className="text-ui text-muted-foreground">
            {WORKFLOW_TRIGGER_COPY.inputsEmpty}
          </p>
        ) : (
          <div className="space-y-3">
            {inputs.map((input) => {
              const fieldId = `workflow-trigger-input-${input.name}`;
              const help = inputHelpText(input);
              return (
                <div key={input.name}>
                  <Label htmlFor={fieldId}>{input.name}</Label>
                  <Input
                    id={fieldId}
                    value={form.values[input.name] ?? ""}
                    required={input.required}
                    disabled={triggering}
                    onChange={(event) => setFormState({
                      ...form,
                      values: {
                        ...form.values,
                        [input.name]: event.currentTarget.value,
                      },
                    })}
                  />
                  {help ? (
                    <p className="mt-1 text-ui-sm text-muted-foreground">{help}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <div>
          <Label htmlFor="workflow-trigger-repository">
            {WORKFLOW_TRIGGER_COPY.repositoryLabel}
          </Label>
          <Select
            id="workflow-trigger-repository"
            value={form.repoConfigId}
            disabled={triggering || repositoriesQuery.isLoading}
            onChange={(event) => setFormState({
              ...form,
              repoConfigId: event.currentTarget.value,
            })}
          >
            <option value="">{WORKFLOW_TRIGGER_COPY.repositoryPlaceholder}</option>
            {savedRepositoryUnavailable ? (
              <option value={form.repoConfigId}>
                {WORKFLOW_TRIGGER_COPY.repositoryUnavailable(form.repoConfigId)}
              </option>
            ) : null}
            {repositories.map((repository) => (
              <option key={repository.id} value={repository.id}>{repository.label}</option>
            ))}
          </Select>
        </div>

        <div>
          <p className="mb-1 text-ui-sm text-muted-foreground">
            {WORKFLOW_TRIGGER_COPY.placementLabel}
          </p>
          <SegmentedControl<WorkflowPlacementModeV2>
            ariaLabel={WORKFLOW_TRIGGER_COPY.placementLabel}
            value={form.mode}
            items={[
              { id: "worktree", label: WORKFLOW_TRIGGER_COPY.placementWorktree, disabled: triggering },
              { id: "repo_root", label: WORKFLOW_TRIGGER_COPY.placementRepoRoot, disabled: triggering },
            ]}
            onChange={(mode) => setFormState({ ...form, mode })}
          />
          <p className="mt-1 text-ui-sm text-muted-foreground">
            {WORKFLOW_TRIGGER_COPY.placementHelp}
          </p>
        </div>
      </div>
    </ModalShell>
  );
}

function freshTriggerForm(
  key: string,
  definitionRecord: WorkflowDefinitionRecordV2,
): TriggerFormState {
  return {
    key,
    values: Object.fromEntries(
      definitionRecord.definitionJson.inputs.map((input) => [input.name, ""]),
    ),
    repoConfigId: definitionRecord.defaultRepoConfigId ?? "",
    mode: "worktree",
  };
}

function inputHelpText(input: WorkflowInputV2): string | null {
  const parts = [
    input.description,
    input.required ? null : WORKFLOW_TRIGGER_COPY.optionalHint,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Blank optional fields are omitted rather than sent as empty strings: the
 * frozen invocation records exactly what the run was given.
 */
function collectArguments(
  inputs: readonly WorkflowInputV2[],
  values: Record<string, string>,
): WorkflowArgumentsV2 {
  const argumentsValue: WorkflowArgumentsV2 = {};
  for (const input of inputs) {
    const value = values[input.name]?.trim() ?? "";
    if (value.length > 0) {
      argumentsValue[input.name] = value;
    }
  }
  return argumentsValue;
}
