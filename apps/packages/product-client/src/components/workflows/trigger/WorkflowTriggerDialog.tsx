import { useMemo, useState, type CSSProperties } from "react";
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
import { ModalShell } from "#product/primitives/patterns/ModalShell";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";

export interface WorkflowTriggerDialogProps {
  definitionRecord: WorkflowDefinitionRecordV2;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLaunched: (launch: WorkflowTriggerLaunch) => void;
  authCacheScope: string;
}

const TRIGGER_FORM_ID = "workflow-trigger-form";

interface TriggerFormState {
  key: string;
  values: Record<string, string>;
  repoConfigId: string;
  mode: WorkflowPlacementModeV2;
}

const sectionLabelStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color: "var(--color-faint)",
};

const fieldStyle: CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: 7,
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-elevated-secondary)",
  color: "var(--color-foreground)",
  font: "inherit",
  outline: "none",
};

function placementOptionStyle(selected: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    width: "100%",
    padding: "9px 10px",
    borderRadius: 9,
    border: `1px solid ${selected ? "var(--color-border-heavy)" : "var(--color-border)"}`,
    background: selected ? "var(--color-surface-elevated-secondary)" : "transparent",
    color: "var(--color-foreground)",
    font: "inherit",
    cursor: "pointer",
    textAlign: "left",
  };
}

function placementDotStyle(selected: boolean): CSSProperties {
  return {
    width: 12,
    height: 12,
    borderRadius: 999,
    flex: "none",
    marginTop: 2,
    border: `1px solid ${selected ? "var(--color-info)" : "var(--color-border-heavy)"}`,
    background: selected ? "var(--color-info)" : "transparent",
    boxShadow: selected ? "inset 0 0 0 2px var(--color-surface-elevated)" : "none",
  };
}

/**
 * Manual workflow trigger rendered in the attached design's compact modal
 * anatomy. The two placement cards map to the production v2 contract:
 * an isolated repository worktree or the repository root's existing checkout.
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
  const repoRootsQuery = useRepoRootsQuery({ enabled: open });
  const repositories = useMemo(
    () => workflowRepoRootOptions(repoRootsQuery.data ?? []),
    [repoRootsQuery.data],
  );

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
    || form.repoConfigId.trim().length === 0
    || savedRepositoryUnavailable;

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
      title={`Run ${definitionRecord.title}`}
      description={WORKFLOW_TRIGGER_COPY.manualDescription}
      headerContent={(
        <div className="flex flex-col gap-1">
          <span className="text-ui font-medium text-foreground">
            Run {definitionRecord.title}
          </span>
          <span className="text-ui-sm text-faint">
            {WORKFLOW_TRIGGER_COPY.manualDescription}
          </span>
        </div>
      )}
      sizeClassName="max-w-[460px]"
      showCloseButton={false}
      telemetryBlocked
      overlayClassName="bg-black/45"
      panelClassName="!gap-3.5 !rounded-xl border-border bg-surface-elevated shadow-modal"
      headerClassName="shrink-0 px-4 pt-4"
      bodyClassName="px-4"
      footerClassName="flex shrink-0 items-center justify-end gap-2 px-4 pb-4"
      footer={(
        <>
          <button
            type="button"
            disabled={triggering}
            className="text-ui-sm cursor-pointer hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              padding: "5px 11px",
              borderRadius: 7,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface-elevated)",
              color: "var(--color-muted-foreground)",
              font: "inherit",
            }}
            onClick={() => onOpenChange(false)}
          >
            {WORKFLOW_TRIGGER_COPY.cancelLabel}
          </button>
          <button
            type="submit"
            form={TRIGGER_FORM_ID}
            disabled={confirmDisabled}
            className="text-ui-sm cursor-pointer font-medium hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              padding: "5px 13px",
              borderRadius: 7,
              border: "1px solid var(--color-border-heavy)",
              background: "var(--color-surface-elevated-secondary)",
              color: "var(--color-foreground)",
              font: "inherit",
            }}
          >
            {triggering ? WORKFLOW_TRIGGER_COPY.runningLabel : WORKFLOW_TRIGGER_COPY.confirmLabel}
          </button>
        </>
      )}
    >
      <form
        id={TRIGGER_FORM_ID}
        className="flex flex-col gap-3.5"
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

        {inputs.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-ui-sm" style={sectionLabelStyle}>{WORKFLOW_TRIGGER_COPY.inputsLabel}</span>
            {inputs.map((input, index) => {
              const fieldId = `workflow-trigger-input-${input.name}`;
              const help = inputHelpText(input);
              return (
                <div key={input.name} className="flex flex-col gap-1.5">
                  <label htmlFor={fieldId} className="text-ui-sm font-medium text-foreground">
                    {workflowInputDisplayName(input.name)}
                  </label>
                  <input
                    id={fieldId}
                    value={form.values[input.name] ?? ""}
                    required={input.required}
                    disabled={triggering}
                    autoFocus={index === 0}
                    autoComplete="off"
                    spellCheck={false}
                    className="text-ui-sm"
                    style={fieldStyle}
                    onChange={(event) => setFormState({
                      ...form,
                      values: {
                        ...form.values,
                        [input.name]: event.currentTarget.value,
                      },
                    })}
                  />
                  {help ? <p className="text-ui-sm m-0 text-faint">{help}</p> : null}
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={WORKFLOW_TRIGGER_COPY.placementLabel}>
          <span className="text-ui-sm" style={sectionLabelStyle}>{WORKFLOW_TRIGGER_COPY.whereItRunsLabel}</span>
          <button
            type="button"
            role="radio"
            aria-checked={form.mode === "worktree"}
            disabled={triggering}
            style={placementOptionStyle(form.mode === "worktree")}
            onClick={() => setFormState({ ...form, mode: "worktree" })}
          >
            <span aria-hidden style={placementDotStyle(form.mode === "worktree")} />
            <span className="flex min-w-0 flex-col gap-0.5 text-left">
              <span className="text-ui-sm text-foreground">
                {WORKFLOW_TRIGGER_COPY.placementWorktree}
              </span>
              <span className="text-ui-sm text-faint">
                {WORKFLOW_TRIGGER_COPY.placementWorktreeHelp}
              </span>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={form.mode === "repo_root"}
            disabled={triggering}
            style={placementOptionStyle(form.mode === "repo_root")}
            onClick={() => setFormState({ ...form, mode: "repo_root" })}
          >
            <span aria-hidden style={placementDotStyle(form.mode === "repo_root")} />
            <span className="flex min-w-0 flex-col gap-0.5 text-left">
              <span className="text-ui-sm text-foreground">
                {WORKFLOW_TRIGGER_COPY.placementRepoRoot}
              </span>
              <span className="text-ui-sm text-faint">
                {WORKFLOW_TRIGGER_COPY.placementRepoRootHelp}
              </span>
            </span>
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-ui-sm" htmlFor="workflow-trigger-repository" style={sectionLabelStyle}>
            {WORKFLOW_TRIGGER_COPY.repositoryLabel}
          </label>
          <select
            id="workflow-trigger-repository"
            value={form.repoConfigId}
            disabled={triggering || repoRootsQuery.isLoading}
            className="text-ui-sm"
            style={fieldStyle}
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
          </select>
        </div>
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
  };
}

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
