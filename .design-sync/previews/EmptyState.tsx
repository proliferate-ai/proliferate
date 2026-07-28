import {
  Button,
  EmptyState,
  FolderPlus,
  Plus,
  RotateCcw,
} from "@proliferate/ui";

export const NoWorkflows = () => (
  <div className="w-full max-w-2xl">
    <EmptyState
      title="No workflows yet"
      description="Create a definition with inputs, stages, and prompts. Workflows run on every push to the branches you pick."
      action={(
        <Button type="button" variant="secondary" size="sm">
          <Plus className="icon-paired" />
          New workflow
        </Button>
      )}
    />
  </div>
);

export const LoadFailure = () => (
  <div className="w-full max-w-2xl">
    <EmptyState
      title="Could not load workspaces"
      description="The environment service did not respond. Refresh the page or sign in again."
      action={(
        <Button type="button" variant="secondary" size="sm">
          <RotateCcw className="icon-paired" />
          Retry
        </Button>
      )}
    />
  </div>
);

export const TitleOnly = () => (
  <div className="w-full max-w-2xl">
    <EmptyState title="No branches match “release/”" />
  </div>
);

export const InsidePanel = () => (
  <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card">
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      <span className="text-heading font-medium text-foreground">Cloud environments</span>
      <Button type="button" variant="ghost" size="sm">
        <Plus className="icon-paired" />
        New
      </Button>
    </div>
    <div className="p-4">
      <EmptyState
        title="No cloud environments"
        description="Connect a repository to provision your first sandbox image."
        action={(
          <Button type="button" size="sm">
            <FolderPlus className="icon-paired" />
            Connect repository
          </Button>
        )}
      />
    </div>
  </div>
);
