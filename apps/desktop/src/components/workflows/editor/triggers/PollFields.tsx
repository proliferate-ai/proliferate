import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { POLL_MIN_INTERVAL_SECS, type TriggerDraft } from "@/hooks/workflows/workflows/use-workflow-trigger-drafts";
import { WorkflowSelect } from "../WorkflowSelect";
import type { WorkflowTriggerRepoOption } from "../WorkflowTriggersCard";

export function PollFields({
  draft,
  repoOptions,
  isEdit,
  onPatch,
}: {
  draft: TriggerDraft;
  repoOptions: readonly WorkflowTriggerRepoOption[];
  isEdit: boolean;
  onPatch: (patch: Partial<TriggerDraft>) => void;
}) {
  const showAuthValueInput = draft.pollReplaceAuth || !isEdit;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label>Poll URL</Label>
          <Input
            type="url"
            value={draft.pollUrl}
            onChange={(event) => onPatch({ pollUrl: event.target.value })}
            placeholder="https://issues.example.com/poll"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label>Repository</Label>
          <WorkflowSelect
            ariaLabel="Repository"
            value={draft.repoFullName}
            options={repoOptions.map((repo) => ({ value: repo.fullName, label: repo.label }))}
            onChange={(value) => onPatch({ repoFullName: value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label>Auth header name</Label>
          <Input
            value={draft.pollAuthHeader}
            onChange={(event) => onPatch({ pollAuthHeader: event.target.value })}
            placeholder="Authorization"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label>Auth header value</Label>
          {showAuthValueInput ? (
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={draft.pollAuthValue}
                onChange={(event) => onPatch({ pollAuthValue: event.target.value })}
                placeholder={draft.pollAuthHeader ? "Header value" : "No auth header set"}
                disabled={!draft.pollAuthHeader.trim()}
              />
              {draft.pollHasAuth ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPatch({ pollReplaceAuth: false, pollAuthValue: "" })}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface-elevated-secondary px-3 text-sm text-muted-foreground">
              <span className="flex-1 truncate">Configured — value hidden</span>
              <Button variant="ghost" size="sm" onClick={() => onPatch({ pollReplaceAuth: true })}>
                Replace
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <Label>Poll interval (seconds)</Label>
        <Input
          type="number"
          min={POLL_MIN_INTERVAL_SECS}
          value={draft.pollIntervalSecs}
          onChange={(event) => onPatch({ pollIntervalSecs: Number(event.target.value) || 0 })}
        />
        <span className="text-xs text-faint">Minimum {POLL_MIN_INTERVAL_SECS} seconds.</span>
      </div>

      <p className="text-xs text-faint">
        The endpoint&apos;s items must return a <code>data</code> object whose fields match this
        workflow&apos;s inputs by name and type — verified once when you save.
      </p>
    </div>
  );
}
