import { useNavigate } from "react-router-dom";
import { Button } from "#product/primitives/Button";
import { ArrowRight } from "#product/primitives/icons/core";
import { CheckCircleFilled } from "#product/primitives/icons/status";
import { ModalShell } from "#product/primitives/patterns/ModalShell";
import { buildSettingsHref } from "#product/lib/domain/settings/navigation";

interface RepoSetupModalProps {
  sourceRoot: string;
  repoName: string;
  onClose: () => void;
}

export function RepoSetupModal({
  sourceRoot,
  repoName,
  onClose,
}: RepoSetupModalProps) {
  const navigate = useNavigate();

  function handleCustomizeDefaults() {
    onClose();
    navigate(buildSettingsHref({
      section: "repo",
      repo: sourceRoot,
    }));
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Repository added"
      description="Available for new worktrees."
      sizeClassName="max-w-md"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={handleCustomizeDefaults}
          >
            Customize defaults
            <ArrowRight className="icon-paired" />
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={onClose}
          >
            Done
          </Button>
        </>
      }
    >
      <div className="rounded-lg border border-border bg-surface-elevated-secondary p-3">
        <div className="flex min-w-0 items-start gap-3">
          <CheckCircleFilled className="mt-0.5 icon-large shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-ui font-medium text-foreground">{repoName}</div>
            <div className="truncate text-ui-sm text-muted-foreground">{sourceRoot}</div>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
