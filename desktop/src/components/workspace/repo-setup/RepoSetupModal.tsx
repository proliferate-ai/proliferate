import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { ArrowRight, CheckCircleFilled } from "@/components/ui/icons";
import { ModalShell } from "@/components/ui/ModalShell";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";

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
            <ArrowRight className="size-4" />
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
      <div className="rounded-lg border border-border bg-foreground/5 p-3">
        <div className="flex min-w-0 items-start gap-3">
          <CheckCircleFilled className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{repoName}</div>
            <div className="truncate text-xs text-muted-foreground">{sourceRoot}</div>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
