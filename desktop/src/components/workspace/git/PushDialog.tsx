import { useEffect, useState } from "react";
import {
  useGitStatusQuery,
  usePushGitMutation,
} from "@anyharness/sdk-react";
import { ModalShell } from "@/components/ui/ModalShell";
import { Button } from "@/components/ui/Button";
import { CloudUpload, GitBranchIcon } from "@/components/ui/icons";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { useHarnessStore } from "@/stores/sessions/harness-store";

interface PushDialogProps {
  open: boolean;
  onClose: () => void;
}

export function PushDialog({ open, onClose }: PushDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  const selectedWorkspaceId = useHarnessStore((s) => s.selectedWorkspaceId);
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const runtimeBlockedReason = getWorkspaceRuntimeBlockReason(selectedWorkspaceId);
  const pushMutation = usePushGitMutation();
  const { data: gitStatus } = useGitStatusQuery({ enabled: runtimeBlockedReason === null });

  const branchName = gitStatus?.currentBranch ?? "(unknown)";

  async function handlePush() {
    if (runtimeBlockedReason) {
      setError(runtimeBlockedReason);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await pushMutation.mutateAsync({});
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      sizeClassName="max-w-[420px]"
      title={
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
            <CloudUpload className="size-4 text-foreground" />
          </span>
          <span className="text-base font-semibold text-foreground">Push changes</span>
        </div>
      }
      footer={
        <Button
          variant="inverted"
          size="md"
          loading={loading}
          disabled={runtimeBlockedReason !== null}
          onClick={handlePush}
          className="w-full"
        >
          Push
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <GitBranchIcon className="size-3.5" />
            Branch
          </span>
          <span className="min-w-0 truncate text-sm text-foreground">{branchName}</span>
        </div>

        <p className="text-sm text-muted-foreground">
          Push your latest commits to the remote repository.
        </p>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {!error && runtimeBlockedReason && (
          <p className="text-xs text-muted-foreground">{runtimeBlockedReason}</p>
        )}
      </div>
    </ModalShell>
  );
}
