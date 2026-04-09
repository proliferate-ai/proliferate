import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { ModalShell } from "@/components/ui/ModalShell";
import { Select } from "@/components/ui/Select";
import { NEW_CLOUD_WORKSPACE_LABELS } from "@/config/cloud-workspaces";
import { useNewCloudWorkspaceModalState } from "@/hooks/cloud/use-new-cloud-workspace-modal-state";
import type { NewCloudWorkspaceSeed } from "@/lib/domain/workspaces/cloud-workspace-creation";

interface NewCloudWorkspaceModalProps {
  seed: NewCloudWorkspaceSeed;
  onClose: () => void;
}

export function NewCloudWorkspaceModal({
  seed,
  onClose,
}: NewCloudWorkspaceModalProps) {
  const baseBranchId = useId();
  const branchNameId = useId();
  const {
    repoLabel,
    availableBranches,
    baseBranch,
    branchName,
    setBaseBranch,
    setBranchName,
    isLoadingBranches,
    isSubmitting,
    displayError,
    canSubmit,
    handleCreate,
  } = useNewCloudWorkspaceModalState({
    seed,
    onCreated: onClose,
  });

  return (
    <ModalShell
      open
      onClose={onClose}
      title={NEW_CLOUD_WORKSPACE_LABELS.title}
      description={NEW_CLOUD_WORKSPACE_LABELS.description}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>
            {NEW_CLOUD_WORKSPACE_LABELS.cancel}
          </Button>
          <Button
            loading={isSubmitting}
            onClick={() => {
              void handleCreate();
            }}
            disabled={!canSubmit}
          >
            {NEW_CLOUD_WORKSPACE_LABELS.submit}
          </Button>
        </>
      )}
    >
      <div className="space-y-3">
        <div>
          <Label>{NEW_CLOUD_WORKSPACE_LABELS.repositoryLabel}</Label>
          <div className="flex h-9 items-center truncate rounded-md border border-input bg-muted/30 px-3 text-sm text-muted-foreground">
            {repoLabel}
          </div>
        </div>

        <div>
          <Label htmlFor={baseBranchId}>
            {NEW_CLOUD_WORKSPACE_LABELS.baseBranchLabel}
          </Label>
          <Select
            id={baseBranchId}
            value={baseBranch}
            onChange={(event) => setBaseBranch(event.target.value)}
            disabled={isLoadingBranches || availableBranches.length === 0}
          >
            <option value="" disabled>
              {isLoadingBranches
                ? NEW_CLOUD_WORKSPACE_LABELS.baseBranchLoadingPlaceholder
                : NEW_CLOUD_WORKSPACE_LABELS.baseBranchPlaceholder}
            </option>
            {availableBranches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor={branchNameId}>
            {NEW_CLOUD_WORKSPACE_LABELS.branchNameLabel}
          </Label>
          <Input
            id={branchNameId}
            type="text"
            placeholder={NEW_CLOUD_WORKSPACE_LABELS.branchNamePlaceholder}
            value={branchName}
            onChange={(event) => setBranchName(event.target.value)}
            autoFocus={!seed.prefillBranchName}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          {NEW_CLOUD_WORKSPACE_LABELS.helperPrefix}
          <span className="text-foreground">
            {baseBranch || NEW_CLOUD_WORKSPACE_LABELS.helperBaseBranchFallback}
          </span>
          {NEW_CLOUD_WORKSPACE_LABELS.helperMiddle}
          <span className="text-foreground">
            {branchName.trim() || NEW_CLOUD_WORKSPACE_LABELS.helperBranchFallback}
          </span>
          .
        </p>

        {displayError && <p className="text-xs text-destructive">{displayError}</p>}
      </div>
    </ModalShell>
  );
}
