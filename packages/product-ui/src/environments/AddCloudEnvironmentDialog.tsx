import { useEffect, type FormEvent } from "react";
import {
  Archive,
  Check,
  ChevronDown,
  Cloud,
  GitBranch,
  Lock,
  Plus,
  RotateCw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";

import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";

export type AddCloudEnvironmentConfigState = "missing" | "disabled" | "configured";

export interface AddCloudEnvironmentRepositoryView {
  id: string;
  fullName: string;
  defaultBranch: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  disabled: boolean;
  permission: string | null;
  configured: boolean;
  repoConfigState: AddCloudEnvironmentConfigState;
  ownerAvatarUrl?: string | null;
  pushedAt?: string | null;
  updatedAt?: string | null;
  disabledReason?: string | null;
}

interface AddCloudEnvironmentDialogProps {
  open: boolean;
  query: string;
  manualValue: string;
  repositories: readonly AddCloudEnvironmentRepositoryView[];
  loading?: boolean;
  loadingMore?: boolean;
  addingRepoId?: string | null;
  error?: string | null;
  nextCursor?: string | null;
  onQueryChange: (value: string) => void;
  onManualValueChange: (value: string) => void;
  onAddRepository: (repo: AddCloudEnvironmentRepositoryView) => void;
  onAddManual: () => void;
  onLoadMore: () => void;
  onRetry?: () => void;
  onClose: () => void;
}

export function AddCloudEnvironmentDialog({
  open,
  query,
  manualValue,
  repositories,
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
  onClose,
}: AddCloudEnvironmentDialogProps) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const handleManualSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onAddManual();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 py-6 backdrop-blur-sm"
      role="presentation"
      data-telemetry-block
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-modal="true"
        aria-labelledby="add-cloud-environment-title"
        role="dialog"
        className="flex max-h-[min(42rem,calc(100vh-3rem))] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border-light px-4 py-3">
          <div className="min-w-0">
            <h2 id="add-cloud-environment-title" className="text-sm font-medium text-foreground">
              Add cloud environment
            </h2>
            <p className="mt-1 text-xs leading-4 text-muted-foreground">
              Choose a GitHub repository. This creates cloud configuration and does not clone locally.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close add cloud environment"
            onClick={onClose}
          >
            <X size={14} />
          </Button>
        </header>

        <div className="grid gap-3 border-b border-border-light px-4 py-3">
          <form className="flex min-w-0 gap-2" onSubmit={handleManualSubmit}>
            <div className="relative min-w-0 flex-1">
              <GitBranch className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="GitHub repository"
                value={manualValue}
                placeholder="owner/repo or GitHub URL"
                className="pl-8"
                onChange={(event) => onManualValueChange(event.currentTarget.value)}
              />
            </div>
            <Button type="submit" variant="primary" disabled={manualValue.trim().length === 0}>
              <Plus size={14} />
              Add
            </Button>
          </form>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search GitHub repositories"
              value={query}
              placeholder="Search repositories your GitHub account can access"
              className="pl-8"
              onChange={(event) => onQueryChange(event.currentTarget.value)}
            />
          </div>
        </div>

        {error ? (
          <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive-subtle px-4 py-3 text-sm text-destructive">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">{error}</div>
            {onRetry ? (
              <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                <RotateCw size={13} />
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="web-scrollbar min-h-0 flex-1 overflow-y-auto">
          {loading && repositories.length === 0 ? (
            <div className="grid gap-2 px-4 py-4">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="h-14 animate-pulse rounded-lg border border-border-light bg-background/50"
                />
              ))}
            </div>
          ) : repositories.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No repositories found.
            </div>
          ) : (
            <div className="divide-y divide-border-light">
              {repositories.map((repo) => (
                <RepositoryRow
                  key={repo.id}
                  repo={repo}
                  adding={addingRepoId === repo.id}
                  onAdd={onAddRepository}
                />
              ))}
            </div>
          )}
        </div>

        {nextCursor ? (
          <div className="border-t border-border-light px-4 py-3">
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              loading={loadingMore}
              onClick={onLoadMore}
            >
              <ChevronDown size={14} />
              Load more
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function RepositoryRow({
  repo,
  adding,
  onAdd,
}: {
  repo: AddCloudEnvironmentRepositoryView;
  adding: boolean;
  onAdd: (repo: AddCloudEnvironmentRepositoryView) => void;
}) {
  const blocked = Boolean(repo.disabledReason);
  const actionLabel = repo.repoConfigState === "configured"
    ? "Use"
    : repo.repoConfigState === "disabled"
      ? "Enable"
      : "Add";

  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
        {repo.ownerAvatarUrl ? (
          <img src={repo.ownerAvatarUrl} alt="" className="size-full object-cover" />
        ) : (
          <Cloud size={14} className="text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {repo.fullName}
          </span>
          {repo.private ? <Lock className="size-3.5 shrink-0 text-muted-foreground" /> : null}
          {repo.archived ? <Archive className="size-3.5 shrink-0 text-warning" /> : null}
          {repo.repoConfigState === "configured" ? (
            <Check className="size-3.5 shrink-0 text-success" />
          ) : null}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="truncate">
            {repo.defaultBranch ? `default: ${repo.defaultBranch}` : "no default branch"}
          </span>
          {repo.permission ? <span>{repo.permission}</span> : null}
          {repo.fork ? <span>fork</span> : null}
          {repo.disabledReason ? <span className="text-warning">{repo.disabledReason}</span> : null}
        </div>
      </div>
      <Button
        type="button"
        variant={repo.repoConfigState === "configured" ? "secondary" : "primary"}
        loading={adding}
        disabled={blocked}
        onClick={() => onAdd(repo)}
      >
        {actionLabel}
      </Button>
    </div>
  );
}
