import { useEffect, useMemo, useState } from "react";
import {
  useCreatePullRequestMutation,
  useGitStatusQuery,
} from "@anyharness/sdk-react";
import { ModalShell } from "@/components/ui/ModalShell";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Label } from "@/components/ui/Label";
import { Switch } from "@/components/ui/Switch";
import { GitHub } from "@/components/ui/icons";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";

interface PullRequestDialogProps {
  open: boolean;
  onClose: () => void;
}

export function PullRequestDialog({ open, onClose }: PullRequestDialogProps) {
  const selectedWorkspaceId = useHarnessStore((s) => s.selectedWorkspaceId);
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const runtimeBlockedReason = getWorkspaceRuntimeBlockReason(selectedWorkspaceId);
  const { data: gitStatus } = useGitStatusQuery({ enabled: runtimeBlockedReason === null });
  const createPullRequestMutation = useCreatePullRequestMutation();
  const repoConfigs = useRepoPreferencesStore((s) => s.repoConfigs);
  const { data: workspaceCollections } = useWorkspaces();
  const workspaces = workspaceCollections?.workspaces ?? [];

  const repoDefaultBranch = useMemo(() => {
    const ws = workspaces.find((w) => w.id === selectedWorkspaceId);
    if (!ws) return "";
    const sourceRoot = ws.sourceRepoRootPath?.trim();
    if (!sourceRoot) return "";
    return repoConfigs[sourceRoot]?.defaultBranch ?? "";
  }, [workspaces, selectedWorkspaceId, repoConfigs]);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [baseBranch, setBaseBranch] = useState(
    gitStatus?.suggestedBaseBranch ?? (repoDefaultBranch || "main"),
  );
  const [draft, setDraft] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      return;
    }
    setBaseBranch(gitStatus?.suggestedBaseBranch ?? (repoDefaultBranch || "main"));
  }, [gitStatus?.suggestedBaseBranch, open, repoDefaultBranch]);

  const headBranch = gitStatus?.currentBranch?.trim() ?? "";
  const blockedReason = runtimeBlockedReason
    ?? gitStatus?.actions.reasonIfBlocked
    ?? (!headBranch && gitStatus ? "A current branch is required before creating a pull request." : null);
  const canSubmit = !loading
    && !blockedReason
    && title.trim().length > 0
    && baseBranch.trim().length > 0;

  async function handleCreate() {
    if (runtimeBlockedReason) {
      setError(runtimeBlockedReason);
      return;
    }
    if (!title.trim() || !baseBranch.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await createPullRequestMutation.mutateAsync({
        title: title.trim(),
        body: body.trim() || undefined,
        baseBranch: baseBranch.trim(),
        draft,
      });
      setTitle("");
      setBody("");
      setDraft(false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      sizeClassName="max-w-lg"
      title={
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
            <GitHub className="size-4 text-foreground" />
          </span>
          <span className="text-base font-semibold text-foreground">Create pull request</span>
        </div>
      }
      footer={
        <div className="flex w-full items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch checked={draft} onChange={setDraft} />
            <span
              className="text-sm text-foreground cursor-pointer select-none"
              onClick={() => setDraft((d) => !d)}
            >
              Draft pull request
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              variant="inverted"
              size="sm"
              loading={loading}
              disabled={!canSubmit}
              onClick={handleCreate}
            >
              {draft ? "Create draft PR" : "Create PR"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <Label htmlFor="pull-request-title">Title</Label>
          <Input
            id="pull-request-title"
            type="text"
            placeholder="PR title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="pull-request-description">Description</Label>
          <Textarea
            id="pull-request-description"
            placeholder="Optional description"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <Label htmlFor="pull-request-base">Base branch</Label>
            <Input
              id="pull-request-base"
              type="text"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <Label>Head branch</Label>
            <div className="h-9 px-3 rounded-md border border-input bg-muted/30 text-sm text-muted-foreground flex items-center truncate">
              {headBranch || "Unknown branch"}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          The head branch must already be pushed before GitHub can create the pull request.
        </p>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {!error && blockedReason && (
          <p className="text-xs text-muted-foreground">{blockedReason}</p>
        )}
      </div>
    </ModalShell>
  );
}
