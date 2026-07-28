import {
  ArrowRight,
  Badge,
  ChevronRight,
  FolderClosedFilled,
  GitBranch,
  ListRow,
  Server,
  UserAvatar,
} from "@proliferate/ui";

const noop = () => {};

export const RepositoryList = () => (
  <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card">
    <ListRow
      title="proliferate/proliferate"
      description="main · 3 running agents · updated 4 minutes ago"
      leading={<FolderClosedFilled className="icon-paired text-file-icon-folder" />}
      trailing={<ChevronRight className="icon-paired text-muted-foreground" />}
      onClick={noop}
    />
    <ListRow
      title="proliferate/anyharness"
      description="release/2026.07 · no agents · updated yesterday"
      leading={<FolderClosedFilled className="icon-paired text-file-icon-folder" />}
      trailing={<ChevronRight className="icon-paired text-muted-foreground" />}
      onClick={noop}
    />
    <ListRow
      title="proliferate/design-tokens"
      description="main · read-only for agents"
      leading={<FolderClosedFilled className="icon-paired text-file-icon-muted" />}
      trailing={<ChevronRight className="icon-paired text-muted-foreground" />}
      onClick={noop}
    />
  </div>
);

export const WithTrailingStatus = () => (
  <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card">
    <ListRow
      title="sandbox-us-east-2"
      description="8 vCPU · 32 GB · warm pool"
      leading={<Server className="icon-paired text-muted-foreground" />}
      trailing={<Badge tone="success">Ready</Badge>}
      onClick={noop}
    />
    <ListRow
      title="staging"
      description="4 vCPU · 16 GB · rebuilding image"
      leading={<Server className="icon-paired text-muted-foreground" />}
      trailing={<Badge tone="info">Building</Badge>}
      onClick={noop}
    />
    <ListRow
      title="sandbox-eu-west-1"
      description="Image build failed 12 minutes ago"
      leading={<Server className="icon-paired text-muted-foreground" />}
      trailing={<Badge tone="destructive">Failed</Badge>}
      onClick={noop}
    />
    <ListRow
      title="prod"
      description="Agents may read but not write"
      leading={<Server className="icon-paired text-muted-foreground" />}
      trailing={<Badge tone="neutral">Locked</Badge>}
      onClick={noop}
    />
  </div>
);

export const WithAvatarLeading = () => (
  <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card">
    <ListRow
      title="Ada Whitfield"
      description="Owner · ada@proliferate.dev"
      leading={<UserAvatar displayName="Ada Whitfield" className="size-8" />}
      trailing={<Badge tone="accent">Owner</Badge>}
      onClick={noop}
    />
    <ListRow
      title="Marco Silva"
      description="Member · marco@proliferate.dev"
      leading={<UserAvatar displayName="Marco Silva" className="size-8" />}
      trailing={<Badge tone="neutral">Member</Badge>}
      onClick={noop}
    />
    <ListRow
      title="Priya Raman"
      description="Invited 2 days ago · priya@proliferate.dev"
      leading={<UserAvatar displayName="Priya Raman" className="size-8" />}
      trailing={<Badge tone="info">Pending</Badge>}
      onClick={noop}
    />
  </div>
);

export const TitleOnlyAndDisabled = () => (
  <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card">
    <ListRow title="Playground" onClick={noop} />
    <ListRow
      title="Component library"
      description="/playground/library · every sanctioned export with a live render"
      trailing={<ArrowRight className="icon-paired text-muted-foreground" />}
      onClick={noop}
    />
    <ListRow
      title="Workflow runs"
      description="Requires a connected repository"
      leading={<GitBranch className="icon-paired text-muted-foreground" />}
      disabled
      onClick={noop}
    />
  </div>
);
