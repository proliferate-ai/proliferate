import { Badge, Button, GitBranch, PageHeader, Plus, RefreshCw } from "@proliferate/ui";

export const Default = () => (
  <div className="w-full max-w-4xl">
    <PageHeader
      title="Workspaces"
      description="Every sandbox this organization is running, with the branch and agent attached to it."
    />
  </div>
);

export const WithActions = () => (
  <div className="w-full max-w-4xl">
    <PageHeader
      title="Repositories"
      description="Repositories connected through the Proliferate GitHub App."
      actions={
        <>
          <Button variant="secondary" size="sm">
            <RefreshCw className="icon-paired" />
            Resync
          </Button>
          <Button size="sm">
            <Plus className="icon-paired" />
            Add repository
          </Button>
        </>
      }
    />
  </div>
);

export const TitleOnly = () => (
  <div className="w-full max-w-4xl">
    <PageHeader title="Billing" />
  </div>
);

export const RichTitle = () => (
  <div className="w-full max-w-4xl">
    <PageHeader
      title={
        <span className="flex items-center gap-3">
          anthropics/proliferate
          <Badge tone="success">Connected</Badge>
        </span>
      }
      description={
        <span className="flex items-center gap-2">
          <GitBranch className="icon-paired" />
          Default branch main · last synced 4 minutes ago
        </span>
      }
      action={
        <Button variant="secondary" size="sm">
          Repository settings
        </Button>
      }
    />
  </div>
);
