import {
  Button,
  CircleAlert,
  CloudIcon,
  GitBranch,
  ProductNotice,
  Shield,
} from "@proliferate/ui";

/** Every tone, in the order the prop declares them. */
export const Tones = () => (
  <div className="flex w-full max-w-2xl flex-col gap-3">
    <ProductNotice
      tone="neutral"
      title="Worktrees live outside the repository"
      description="Each workspace is created under ~/.proliferate/worktrees and removed when you archive it."
    />
    <ProductNotice
      tone="info"
      icon={<CloudIcon className="icon-paired" />}
      title="Cloud compute is available for this repository"
      description="proliferate/cloud-control is configured for managed sandboxes. New cloud workspaces start in about 20 seconds."
    />
    <ProductNotice
      tone="warning"
      icon={<CircleAlert className="icon-paired" />}
      title="Uncommitted changes on claude/design-sync-ui-import"
      description="Archiving this workspace will delete its worktree. Commit or stash first if you need the changes."
    />
    <ProductNotice
      tone="destructive"
      icon={<CircleAlert className="icon-paired" />}
      title="Cleanup failed for stale-worktree-0f2c"
      description="git worktree prune exited with code 128. Retry the cleanup, or remove the directory by hand."
    />
  </div>
);

/** The title is optional — description-only notices keep a single tight block. */
export const DescriptionOnly = () => (
  <div className="flex w-full max-w-2xl flex-col gap-3">
    <ProductNotice description="Workspaces you archive stay available under Settings → Archived chats." />
    <ProductNotice
      tone="info"
      icon={<GitBranch className="icon-paired" />}
      description="Branches are created from origin/main unless the repository declares a different default."
    />
    <ProductNotice
      tone="warning"
      description="Two sessions are writing to this worktree. The second one will be paused until the first finishes."
    />
  </div>
);

/** In a settings pane, the notice is the row a section leads with. */
export const InSettingsSection = () => (
  <div className="w-full max-w-2xl rounded-lg border border-border bg-surface-elevated p-6">
    <h2 className="text-heading text-foreground">Single sign-on</h2>
    <p className="mt-1 text-ui-sm text-muted-foreground">
      Members of acme-robotics sign in through your identity provider.
    </p>
    <div className="mt-4">
      <ProductNotice
        tone="warning"
        icon={<Shield className="icon-paired" />}
        title="SSO is enforced for this organisation"
        description="Password and GitHub sign-in are disabled. Break-glass admins can still use a recovery code."
      />
    </div>
    <div className="mt-4 flex items-center gap-2">
      <Button size="sm">Edit connection</Button>
      <Button size="sm" variant="secondary">
        View recovery codes
      </Button>
    </div>
  </div>
);
