import { type FormEvent } from "react";
import {
  Archive,
  Check,
  Cloud,
  Lock,
  RotateCw,
  ShieldAlert,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@proliferate/ui/kit/Dialog";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { PopoverSearchField } from "@proliferate/ui/primitives/PopoverSearchField";

export type CloudRepoConfigState = "missing" | "disabled" | "configured";

export interface CloudRepoPickerRepositoryView {
  id: string;
  fullName: string;
  defaultBranch: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  disabled: boolean;
  permission: string | null;
  configured: boolean;
  repoConfigState: CloudRepoConfigState;
  ownerAvatarUrl?: string | null;
  pushedAt?: string | null;
  updatedAt?: string | null;
  disabledReason?: string | null;
}

/** GitHub App prerequisite (authorize / install / org missing) blocking the picker. */
export interface CloudRepoPickerBlockerView {
  title: string;
  description: string;
  actionLabel?: string | null;
  actionLoading?: boolean;
  onAction?: (() => void) | null;
}

export interface CloudRepoPickerProps {
  query: string;
  manualValue: string;
  repositories: readonly CloudRepoPickerRepositoryView[];
  blocker?: CloudRepoPickerBlockerView | null;
  loading?: boolean;
  loadingMore?: boolean;
  addingRepoId?: string | null;
  error?: string | null;
  nextCursor?: string | null;
  onQueryChange: (value: string) => void;
  onManualValueChange: (value: string) => void;
  onAddRepository: (repo: CloudRepoPickerRepositoryView) => void;
  onAddManual: () => void;
  onLoadMore: () => void;
  onRetry?: () => void;
}

/**
 * Cloud repo picker body (authorize → pick → create). Presentational only —
 * dialog chrome comes from the host: AddRepoFlow's cloud step on desktop, or
 * CloudRepoPickerDialog on surfaces without the unified flow.
 */
export function CloudRepoPicker({
  query,
  manualValue,
  repositories,
  blocker = null,
  loading = false,
  loadingMore = false,
  addingRepoId = null,
  error = null,
  nextCursor = null,
  onQueryChange,
  onManualValueChange,
  onAddRepository,
  onAddManual,
  onLoadMore,
  onRetry,
}: CloudRepoPickerProps) {
  if (blocker) {
    return <CloudRepoPickerBlocker blocker={blocker} />;
  }

  const handleManualSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onAddManual();
  };

  return (
    <div className="flex flex-col">
      <PopoverSearchField
        value={query}
        onChange={onQueryChange}
        placeholder="Search repositories"
        ariaLabel="Search GitHub repositories"
        autoFocus
      />
      <div className="border-t border-border-light" />

      {error ? (
        <div
          role="alert"
          className="mt-2 flex items-start gap-2 rounded-lg bg-destructive-subtle px-2.5 py-2 text-ui-sm leading-[1.45] text-destructive"
        >
          <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{error}</span>
          {onRetry ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-2 text-destructive hover:text-destructive"
              onClick={onRetry}
            >
              <RotateCw size={12} aria-hidden />
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="max-h-[300px] overflow-y-auto py-1">
        {loading && repositories.length === 0 ? (
          <LoadingRepositoryRows />
        ) : repositories.length === 0 ? (
          <EmptyRepositoryState query={query} />
        ) : (
          repositories.map((repo) => (
            <RepositoryRow
              key={repo.id}
              repo={repo}
              adding={addingRepoId === repo.id}
              onAdd={onAddRepository}
            />
          ))
        )}
        {nextCursor ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 w-full"
            loading={loadingMore}
            onClick={onLoadMore}
          >
            Load more
          </Button>
        ) : null}
      </div>

      <form
        className="flex items-center gap-2 border-t border-border-light pt-3"
        onSubmit={handleManualSubmit}
      >
        <Input
          aria-label="GitHub repository"
          value={manualValue}
          placeholder="owner/repo or GitHub URL"
          className="h-8 min-w-0 flex-1 text-ui"
          onChange={(event) => onManualValueChange(event.currentTarget.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={manualValue.trim().length === 0 || addingRepoId !== null}
        >
          Add
        </Button>
      </form>
    </div>
  );
}

/** Compact prerequisite state: icon + one-liner + a single primary action. */
function CloudRepoPickerBlocker({
  blocker,
}: {
  blocker: CloudRepoPickerBlockerView;
}) {
  return (
    <div>
      <div className="flex items-start gap-3 py-1">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-control text-muted-foreground">
          <ShieldAlert size={15} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <h3 className="text-ui font-medium leading-5 text-foreground">{blocker.title}</h3>
          <p className="mt-0.5 text-ui-sm leading-[1.45] text-muted-foreground">
            {blocker.description}
          </p>
        </span>
      </div>
      {blocker.actionLabel && blocker.onAction ? (
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            variant="primary"
            size="md"
            loading={blocker.actionLoading}
            onClick={blocker.onAction}
          >
            {blocker.actionLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function LoadingRepositoryRows() {
  return (
    <div role="status" aria-label="Loading GitHub repositories">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex items-center gap-2.5 px-2 py-2">
          <div className="size-6 shrink-0 animate-pulse rounded-[5px] bg-muted" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-2.5 w-1/2 animate-pulse rounded-full bg-muted" />
            <div className="h-2 w-1/3 animate-pulse rounded-full bg-muted/75" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyRepositoryState({ query }: { query: string }) {
  const trimmedQuery = query.trim();
  return (
    <div className="px-2 py-6 text-center">
      <div className="text-ui-sm font-medium text-foreground">
        {trimmedQuery ? "No matching repositories" : "No repositories found"}
      </div>
      <p className="mx-auto mt-1 max-w-xs text-ui-sm leading-[1.45] text-muted-foreground">
        {trimmedQuery
          ? "Try another owner or repository name, or paste an owner/repo value below."
          : "Paste an owner/repo value below, or connect a GitHub account with repository access."}
      </p>
    </div>
  );
}

function RepositoryRow({
  repo,
  adding,
  onAdd,
}: {
  repo: CloudRepoPickerRepositoryView;
  adding: boolean;
  onAdd: (repo: CloudRepoPickerRepositoryView) => void;
}) {
  const blocked = Boolean(repo.disabledReason);
  const actionLabel = repo.repoConfigState === "configured"
    ? "Use"
    : repo.repoConfigState === "disabled"
      ? "Enable"
      : "Add";
  const meta = [
    repo.defaultBranch ? `default: ${repo.defaultBranch}` : "no default branch",
    repo.permission,
    repo.fork ? "fork" : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-accent">
      <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-surface-control text-muted-foreground">
        {repo.ownerAvatarUrl ? (
          <img src={repo.ownerAvatarUrl} alt="" className="size-full object-cover" />
        ) : (
          <Cloud size={12} aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-ui font-medium leading-5 text-foreground">
            {repo.fullName}
          </span>
          {repo.private ? <Lock className="size-3 shrink-0 text-muted-foreground" aria-hidden /> : null}
          {repo.archived ? <Archive className="size-3 shrink-0 text-warning" aria-hidden /> : null}
          {repo.repoConfigState === "configured" ? (
            <Check className="size-3 shrink-0 text-success" aria-hidden />
          ) : null}
        </span>
        <span className="block truncate text-ui-sm leading-[1.45] text-muted-foreground">
          {repo.disabledReason ? (
            <span className="text-warning">{repo.disabledReason}</span>
          ) : (
            meta
          )}
        </span>
      </span>
      <Button
        type="button"
        variant={repo.repoConfigState === "configured" ? "secondary" : "primary"}
        size="sm"
        className="h-7 shrink-0 px-2.5"
        aria-label={`${actionLabel} ${repo.fullName}`}
        loading={adding}
        disabled={blocked}
        onClick={() => onAdd(repo)}
      >
        {actionLabel}
      </Button>
    </div>
  );
}

export interface CloudRepoPickerDialogProps extends CloudRepoPickerProps {
  open: boolean;
  title?: string;
  description?: string;
  onClose: () => void;
}

/**
 * Standalone dialog host for surfaces that lack the unified AddRepoFlow
 * (web home / web settings). Same picker body, current modal conventions.
 */
export function CloudRepoPickerDialog({
  open,
  title = "Add cloud environment",
  description = "Pick a GitHub repository to run in your cloud sandbox.",
  onClose,
  ...picker
}: CloudRepoPickerDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
    >
      <DialogContent
        // Standard modal scrim (ModalShell recipe), matching AddRepoFlow.
        overlayClassName="bg-black/70 backdrop-blur-sm"
        className="max-w-[440px] rounded-xl p-4"
        data-telemetry-block
      >
        <DialogHeader className="gap-0.5 pr-8">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="mt-3">
          <CloudRepoPicker {...picker} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
