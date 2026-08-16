import { useMemo, useState } from "react";
import { useRepoRootsQuery } from "@anyharness/sdk-react";
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
import { workflowRepoRootOptions } from "#product/lib/domain/workflows/workflow-repo-root-options";
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
   * default would pool one account's invocations with another's. It does not
   * scope the repo picker — repo roots are runtime-local, cached per runtime.
   */
  authCacheScope: string;
}

const TRIGGER_FORM_ID = "workflow-trigger-form";

interface TriggerFormState {
  key: string;
  values: Record<string, string>;
  repoConfigId: string;
  mode: WorkflowPlacementModeV2;
  /** The person asked to see the location controls despite a usable default. */
  locationOpen: boolean;
}

/**
 * The gen-2 "run this workflow" dialog, inputs first: one field per declared
 * input and a Start run that hands the whole thing to the trigger courier.
 * The location half (repository + placement) collapses to a one-line summary
 * whenever the definition's saved default repository is usable, so the common
 * case reads as "fill the inputs, go" — the controls only surface when there
 * is a real choice to make (no saved default, the saved default is not a
 * listed repo root, or an explicit "Change"). It composes existing primitives
 * only — the modal frame, the field controls, and the placement segment all
 * belong to the library.
 */
export function WorkflowTriggerDialog({
  definitionRecord,
  open,
  onOpenChange,
  onLaunched,
  authCacheScope,
}: WorkflowTriggerDialogProps) {
  const inputs = definitionRecord.definition.inputs ?? [];
  const { triggerRun, triggering, error } = useWorkflowTriggerActions({
    authCacheScope,
    onLaunched,
  });
  // v1 semantics: the runtime resolves `placement.repoConfigId` against its
  // own repo-root id space (GET /v1/repo-roots), so the picker offers runtime
  // repo roots and the picked id travels into the placement unchanged despite
  // the field's name. Cloud repo-config ids are not interchangeable here and
  // only return once an explicit cloud-to-runtime mapping exists.
  const repoRootsQuery = useRepoRootsQuery({ enabled: open });
  const repositories = useMemo(
    () => workflowRepoRootOptions(repoRootsQuery.data ?? []),
    [repoRootsQuery.data],
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

  // A stored default the runtime does not list stays visible so the picker
  // never misreports what is selected, but it is not submittable: the runtime
  // rejects a repo-root id it does not own.
  const savedRepositoryUnavailable = form.repoConfigId.length > 0
    && !repositories.some((repository) => repository.id === form.repoConfigId);
  const savedRepositoryLabel = repositories.find(
    (repository) => repository.id === form.repoConfigId,
  )?.label;
  // No saved default means the person must pick before anything can run, so
  // the controls show immediately; an unavailable saved default only forces
  // them open once the list has actually loaded, so a collapsed summary does
  // not flash open while the roots are still on the wire.
  const mustChooseLocation = form.repoConfigId.length === 0
    || (!repoRootsQuery.isLoading && savedRepositoryUnavailable);
  const locationExpanded = form.locationOpen || mustChooseLocation;

  const requiredInputsSupplied = inputs.every(
    (input) => !input.required || form.values[input.name]?.trim(),
  );
  const confirmDisabled = triggering
    || !requiredInputsSupplied
    || form.repoConfigId.trim().length === 0
    || savedRepositoryUnavailable;

  const submit = () => {
    void triggerRun({
      workflowDefinitionId: definitionRecord.id,
      arguments: collectArguments(inputs, form.values),
      placement: { repoConfigId: form.repoConfigId, mode: form.mode },
    });
  };

  const description = definitionRecord.description.trim();

  return (
    <ModalShell
      open={open}
      onClose={() => onOpenChange(false)}
      disableClose={triggering}
      title={definitionRecord.title}
      description={description.length > 0 ? description : undefined}
      sizeClassName="max-w-lg"
      telemetryBlocked
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
            type="submit"
            form={TRIGGER_FORM_ID}
            variant="primary"
            size="md"
            loading={triggering}
            disabled={confirmDisabled}
          >
            {WORKFLOW_TRIGGER_COPY.confirmLabel}
          </Button>
        </>
      )}
    >
      <form
        id={TRIGGER_FORM_ID}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!confirmDisabled) {
            submit();
          }
        }}
      >
        {error ? <NoticeBanner tone="destructive">{error}</NoticeBanner> : null}
        {repoRootsQuery.isError ? (
          <NoticeBanner tone="warning">
            {WORKFLOW_TRIGGER_COPY.repositoriesLoadFailed}
          </NoticeBanner>
        ) : null}

        {inputs.length === 0 ? (
          <p className="text-ui text-muted-foreground">
            {WORKFLOW_TRIGGER_COPY.inputsEmpty}
          </p>
        ) : (
          inputs.map((input, index) => {
            const fieldId = `workflow-trigger-input-${input.name}`;
            const help = inputHelpText(input);
            return (
              <div key={input.name} className="space-y-1.5">
                <Label htmlFor={fieldId} className="text-ui font-medium text-foreground">
                  {workflowInputDisplayName(input.name)}
                </Label>
                <Input
                  id={fieldId}
                  value={form.values[input.name] ?? ""}
                  required={input.required}
                  disabled={triggering}
                  autoFocus={index === 0}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setFormState({
                    ...form,
                    values: {
                      ...form.values,
                      [input.name]: event.currentTarget.value,
                    },
                  })}
                />
                {help ? (
                  <p className="text-ui-sm text-muted-foreground">{help}</p>
                ) : null}
              </div>
            );
          })
        )}

        {locationExpanded ? (
          <>
            <div className="space-y-1.5">
              <Label
                htmlFor="workflow-trigger-repository"
                className="text-ui font-medium text-foreground"
              >
                {WORKFLOW_TRIGGER_COPY.repositoryLabel}
              </Label>
              <Select
                id="workflow-trigger-repository"
                value={form.repoConfigId}
                disabled={triggering || repoRootsQuery.isLoading}
                // `locationOpen` pins the controls: without it, picking a
                // listed root would clear `mustChooseLocation` and collapse
                // the section mid-interaction.
                onChange={(event) => setFormState({
                  ...form,
                  repoConfigId: event.currentTarget.value,
                  locationOpen: true,
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
            <div className="space-y-1.5">
              <Label className="text-ui font-medium text-foreground">
                {WORKFLOW_TRIGGER_COPY.placementLabel}
              </Label>
              <SegmentedControl<WorkflowPlacementModeV2>
                ariaLabel={WORKFLOW_TRIGGER_COPY.placementLabel}
                value={form.mode}
                items={[
                  { id: "worktree", label: WORKFLOW_TRIGGER_COPY.placementWorktree, disabled: triggering },
                  { id: "repo_root", label: WORKFLOW_TRIGGER_COPY.placementRepoRoot, disabled: triggering },
                ]}
                onChange={(mode) => setFormState({ ...form, mode, locationOpen: true })}
              />
              <p className="text-ui-sm text-muted-foreground">
                {WORKFLOW_TRIGGER_COPY.placementHelp}
              </p>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <p className="min-w-0 truncate text-ui-sm text-muted-foreground">
              {WORKFLOW_TRIGGER_COPY.locationSummaryPrefix}{" "}
              <span className="font-medium text-foreground">
                {savedRepositoryLabel ?? "…"}
              </span>
              {" · "}
              {form.mode === "worktree"
                ? WORKFLOW_TRIGGER_COPY.placementWorktree
                : WORKFLOW_TRIGGER_COPY.placementRepoRoot}
            </p>
            <Button
              type="button"
              variant="ghost"
              disabled={triggering}
              onClick={() => setFormState({ ...form, locationOpen: true })}
              className="inline h-auto shrink-0 px-0 py-0 text-ui-sm text-muted-foreground underline underline-offset-4 hover:bg-transparent hover:text-foreground"
            >
              {WORKFLOW_TRIGGER_COPY.changeLocationLabel}
            </Button>
          </div>
        )}
      </form>
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
      (definitionRecord.definition.inputs ?? []).map((input) => [input.name, ""]),
    ),
    repoConfigId: definitionRecord.defaultRepoConfigId ?? "",
    mode: "worktree",
    locationOpen: false,
  };
}

/**
 * Presentation only: input names are prompt identifiers (`@input:pr_number`),
 * shown as field labels with separators spaced out and the first letter
 * raised. The submitted argument keys stay the declared names untouched.
 */
function workflowInputDisplayName(name: string): string {
  const spaced = name.replace(/[_-]+/gu, " ").trim();
  if (spaced.length === 0) {
    return name;
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function inputHelpText(input: WorkflowInputV2): string | null {
  const parts = [
    input.description,
    input.required ? null : WORKFLOW_TRIGGER_COPY.optionalHint,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * v1 strict rule: every prompt-referenced input needs an argument, enforced by
 * both control-plane validation and the runtime. A blank optional therefore
 * cannot be omitted — a definition whose prompt reads `@input:notes` would be
 * unlaunchable — so the client supplies "". Required inputs are gated by
 * `requiredInputsSupplied` before submit, not here.
 */
function collectArguments(
  inputs: readonly WorkflowInputV2[],
  values: Record<string, string>,
): WorkflowArgumentsV2 {
  const argumentsValue: WorkflowArgumentsV2 = {};
  for (const input of inputs) {
    argumentsValue[input.name] = values[input.name]?.trim() ?? "";
  }
  return argumentsValue;
}
