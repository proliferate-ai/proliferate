import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import type { WorkflowRepoRootOption } from "#product/lib/domain/workflows/workflow-repo-root-options";
import { Label } from "#product/primitives/Label";
import { Card } from "#product/primitives/patterns/Card";
import { Select } from "#product/primitives/Select";
import { Textarea } from "#product/primitives/Textarea";

export interface WorkflowBuilderDetailsCardProps {
  description: string;
  /** The RUNTIME repo-root id saved as this workflow's default; `""` = none. */
  defaultRepoConfigId: string;
  repositories: readonly WorkflowRepoRootOption[];
  repositoriesLoading: boolean;
  /** The saved default is not one the runtime lists, so it cannot be saved back. */
  repoDefaultUnavailable: boolean;
  disabled: boolean;
  onDescriptionChange: (description: string) => void;
  onDefaultRepoConfigIdChange: (repoConfigId: string) => void;
}

/**
 * Description and the repository runs of this workflow start in. The title is
 * not here: it lives in the builder's top bar, beside Save, the way the
 * design names the workflow.
 *
 * The repository picker offers RUNTIME repo roots, mirroring
 * `WorkflowTriggerDialog`: the runtime resolves `placement.repoConfigId` in its
 * own id space, this field is what seeds that placement, so cloud repo-config
 * ids would name rows the runtime has never heard of. An id the runtime does not
 * list stays visible — the picker never misreports what is stored — but it is
 * not submittable, and the save gate refuses it.
 */
export function WorkflowBuilderDetailsCard({
  description,
  defaultRepoConfigId,
  repositories,
  repositoriesLoading,
  repoDefaultUnavailable,
  disabled,
  onDescriptionChange,
  onDefaultRepoConfigIdChange,
}: WorkflowBuilderDetailsCardProps) {
  return (
    <Card as="section" surface="opaque" className="p-4">
      <h2 className="text-heading font-medium text-foreground">
        {WORKFLOW_BUILDER_COPY.detailsHeading}
      </h2>
      <div className="mt-3">
        <Label htmlFor="workflow-builder-description">
          {WORKFLOW_BUILDER_COPY.descriptionLabel}
        </Label>
        <Textarea
          id="workflow-builder-description"
          value={description}
          rows={2}
          disabled={disabled}
          placeholder={WORKFLOW_BUILDER_COPY.descriptionPlaceholder}
          onChange={(event) => onDescriptionChange(event.currentTarget.value)}
        />
      </div>
      <div className="mt-3">
        <Label htmlFor="workflow-builder-default-repository">
          {WORKFLOW_BUILDER_COPY.defaultRepositoryLabel}
        </Label>
        <Select
          id="workflow-builder-default-repository"
          value={defaultRepoConfigId}
          disabled={disabled || repositoriesLoading}
          aria-invalid={repoDefaultUnavailable ? "true" : undefined}
          onChange={(event) => onDefaultRepoConfigIdChange(event.currentTarget.value)}
        >
          <option value="">{WORKFLOW_BUILDER_COPY.defaultRepositoryPlaceholder}</option>
          {repoDefaultUnavailable ? (
            <option value={defaultRepoConfigId}>
              {WORKFLOW_BUILDER_COPY.defaultRepositoryUnavailableOption(defaultRepoConfigId)}
            </option>
          ) : null}
          {repositories.map((repository) => (
            <option key={repository.id} value={repository.id}>{repository.label}</option>
          ))}
        </Select>
        {repoDefaultUnavailable ? (
          <p className="mt-1 text-ui text-destructive" role="alert">
            {WORKFLOW_BUILDER_COPY.defaultRepositoryUnavailableHint}
          </p>
        ) : (
          <p className="mt-1 text-ui-sm text-muted-foreground">
            {WORKFLOW_BUILDER_COPY.defaultRepositoryHelp}
          </p>
        )}
      </div>
    </Card>
  );
}
