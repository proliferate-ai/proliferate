import { useState, type FormEvent } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  workflowAgentOptions,
  workflowDefaultAgentKind,
  type WorkflowAgentCatalog,
  type WorkflowDefinitionDraft,
  type WorkflowDefinitionStage,
  type WorkflowValidationIssue,
} from "@proliferate/product-domain/workflows/definition";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Select } from "@proliferate/ui/primitives/Select";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { ProductPageShell } from "../layout/ProductPageShell";
import { WorkflowInputEditor } from "./WorkflowInputEditor";
import { createPromptStep, WorkflowStageEditor } from "./WorkflowStageEditor";

export interface WorkflowRepositoryOption {
  id: string;
  label: string;
}

export interface WorkflowDefinitionEditorProps {
  mode: "create" | "edit";
  draft: WorkflowDefinitionDraft;
  catalog: WorkflowAgentCatalog | null;
  repositories: readonly WorkflowRepositoryOption[];
  issues: readonly WorkflowValidationIssue[];
  serverError?: string | null;
  catalogWarning?: string | null;
  saving?: boolean;
  deleting?: boolean;
  loadingRepositories?: boolean;
  onChange: (draft: WorkflowDefinitionDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  onReload?: () => void;
}

export function WorkflowDefinitionEditor({
  mode,
  draft,
  catalog,
  repositories,
  issues,
  serverError = null,
  catalogWarning = null,
  saving = false,
  deleting = false,
  loadingRepositories = false,
  onChange,
  onSave,
  onCancel,
  onDelete,
  onReload,
}: WorkflowDefinitionEditorProps) {
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const busy = saving || deleting;
  const titleIssue = issues.find((issue) => issue.path === "title") ?? null;
  const formTitle = mode === "create" ? "New workflow" : draft.title || "Edit workflow";
  const savedRepositoryUnavailable = draft.defaultRepoConfigId !== null
    && !repositories.some((repository) => repository.id === draft.defaultRepoConfigId);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave();
  };

  return (
    <>
      <ProductPageShell
        title={formTitle}
        description="Define inputs and sequential agent stages. This PR stores and validates the definition only."
        actions={(
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" form="workflow-definition-form" loading={saving} disabled={deleting}>
              <Save className="size-3.5" aria-hidden />
              {mode === "create" ? "Create" : "Save"}
            </Button>
          </div>
        )}
        maxWidthClassName="max-w-5xl"
        telemetryBlocked
      >
        <form id="workflow-definition-form" className="space-y-4" onSubmit={submit}>
          {serverError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
              {serverError}
              {onReload ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="ml-2"
                  disabled={busy}
                  onClick={onReload}
                >
                  Reload
                </Button>
              ) : null}
            </div>
          ) : null}
          {catalogWarning ? (
            <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning" role="status">
              {catalogWarning}
              {onReload && !serverError ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="ml-2"
                  disabled={busy}
                  onClick={onReload}
                >
                  Reload
                </Button>
              ) : null}
            </div>
          ) : null}
          {issues.length > 0 ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
              Fix {issues.length} {issues.length === 1 ? "issue" : "issues"} before saving. {issues[0]?.message}
            </div>
          ) : null}

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="workflow-definition-title">Title</Label>
                <Input
                  id="workflow-definition-title"
                  value={draft.title}
                  disabled={busy}
                  aria-invalid={titleIssue ? "true" : undefined}
                  placeholder="Issue diagnosis"
                  onChange={(event) => onChange({ ...draft, title: event.currentTarget.value })}
                />
                {titleIssue ? (
                  <p className="mt-1 text-xs text-destructive" role="alert">{titleIssue.message}</p>
                ) : null}
              </div>
              <div>
                <Label htmlFor="workflow-definition-repo">Default repository</Label>
                <Select
                  id="workflow-definition-repo"
                  value={draft.defaultRepoConfigId ?? ""}
                  disabled={busy || loadingRepositories}
                  onChange={(event) => onChange({
                    ...draft,
                    defaultRepoConfigId: event.currentTarget.value || null,
                  })}
                >
                  <option value="">No repository</option>
                  {savedRepositoryUnavailable ? (
                    <option value={draft.defaultRepoConfigId ?? ""}>
                      Saved repository unavailable ({draft.defaultRepoConfigId})
                    </option>
                  ) : null}
                  {repositories.map((repository) => (
                    <option key={repository.id} value={repository.id}>{repository.label}</option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Runs may override this default later.
                </p>
              </div>
            </div>
            <div className="mt-4">
              <Label htmlFor="workflow-definition-description">Description</Label>
              <Textarea
                id="workflow-definition-description"
                value={draft.description}
                rows={3}
                disabled={busy}
                placeholder="What this workflow does and when to use it."
                onChange={(event) => onChange({ ...draft, description: event.currentTarget.value })}
              />
            </div>
          </section>

          <WorkflowInputEditor
            inputs={draft.inputs}
            issues={issues}
            disabled={busy}
            onChange={(inputs) => onChange({ ...draft, inputs })}
          />

          <div className="space-y-4">
            {draft.stages.map((stage, stageIndex) => (
              <WorkflowStageEditor
                key={stageIndex}
                stage={stage}
                stageIndex={stageIndex}
                stageCount={draft.stages.length}
                catalog={catalog}
                issues={issues}
                disabled={busy}
                onChange={(nextStage) => onChange({
                  ...draft,
                  stages: replaceStage(draft.stages, stageIndex, nextStage),
                })}
                onRemove={() => onChange({
                  ...draft,
                  stages: draft.stages.filter((_, index) => index !== stageIndex),
                })}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={busy || workflowAgentOptions(catalog).length === 0}
              onClick={() => onChange({
                ...draft,
                stages: [...draft.stages, createStage(catalog)],
              })}
            >
              <Plus className="size-3.5" aria-hidden />
              Add stage
            </Button>
            {mode === "edit" && onDelete ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => setDeleteConfirmationOpen(true)}
              >
                <Trash2 className="size-3.5" aria-hidden />
                Delete workflow
              </Button>
            ) : null}
          </div>
        </form>
      </ProductPageShell>
      <ConfirmationDialog
        open={deleteConfirmationOpen}
        title="Delete workflow?"
        description="This removes the workflow definition. It cannot be opened again."
        confirmLabel="Delete"
        confirmVariant="destructive"
        onClose={() => setDeleteConfirmationOpen(false)}
        onConfirm={() => {
          setDeleteConfirmationOpen(false);
          onDelete?.();
        }}
      />
    </>
  );
}

function createStage(catalog: WorkflowAgentCatalog | null): WorkflowDefinitionStage {
  return {
    harnessConfig: {
      agentKind: workflowDefaultAgentKind(catalog),
      modelId: null,
      effort: null,
    },
    steps: [createPromptStep()],
  };
}

function replaceStage(
  stages: readonly WorkflowDefinitionStage[],
  stageIndex: number,
  nextStage: WorkflowDefinitionStage,
): WorkflowDefinitionStage[] {
  return stages.map((stage, index) => index === stageIndex ? nextStage : stage);
}
