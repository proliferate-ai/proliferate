import {
  Archive,
  Copy,
  ExternalLink,
  GitBranch,
  Pencil,
  PopoverMenuItem,
  RefreshCw,
  ShortcutBadge,
  Trash,
} from "@proliferate/ui";

const SURFACE =
  "w-72 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-popover";

const noop = () => {};

export const WorkspaceMenu = () => (
  <div className={SURFACE}>
    <PopoverMenuItem icon={<Pencil className="icon-paired" />} label="Rename workspace" onClick={noop} />
    <PopoverMenuItem icon={<Copy className="icon-paired" />} label="Duplicate workspace" onClick={noop} />
    <PopoverMenuItem icon={<GitBranch className="icon-paired" />} label="Switch branch…" onClick={noop} />
    <PopoverMenuItem icon={<Archive className="icon-paired" />} label="Archive" onClick={noop} />
    <PopoverMenuItem
      icon={<Trash className="icon-paired" />}
      label="Delete workspace"
      className="text-destructive hover:text-destructive"
      onClick={noop}
    />
  </div>
);

export const WithTrailing = () => (
  <div className={SURFACE}>
    <PopoverMenuItem
      icon={<RefreshCw className="icon-paired" />}
      label="Restart agent"
      trailing={<ShortcutBadge label="⌘R" />}
      onClick={noop}
    />
    <PopoverMenuItem
      icon={<Copy className="icon-paired" />}
      label="Copy session link"
      trailing={<ShortcutBadge label="⌘⇧C" />}
      onClick={noop}
    />
    <PopoverMenuItem
      icon={<ExternalLink className="icon-paired" />}
      label="Open pull request"
      trailing={<ShortcutBadge label="⌘↩" />}
      onClick={noop}
    />
  </div>
);

export const WithDescription = () => (
  <div className={SURFACE}>
    <PopoverMenuItem icon={<GitBranch className="icon-paired" />} label="claude/design-sync-ui-import">
      Ahead 4 · behind 0 of origin/main
    </PopoverMenuItem>
    <PopoverMenuItem icon={<GitBranch className="icon-paired" />} label="main">
      Synced with origin 2 minutes ago
    </PopoverMenuItem>
  </div>
);

export const Densities = () => (
  <div className="flex items-start gap-6">
    <div className="flex flex-col gap-2">
      <span className="text-ui-sm text-muted-foreground">density=&quot;default&quot;</span>
      <div className={SURFACE}>
        <PopoverMenuItem icon={<Pencil className="icon-paired" />} label="Rename workspace" onClick={noop} />
        <PopoverMenuItem icon={<Archive className="icon-paired" />} label="Archive" onClick={noop} />
      </div>
    </div>
    <div className="flex flex-col gap-2">
      <span className="text-ui-sm text-muted-foreground">density=&quot;compact&quot;</span>
      <div className={SURFACE}>
        <PopoverMenuItem
          density="compact"
          icon={<Pencil className="icon-paired" />}
          label="Rename workspace"
          onClick={noop}
        />
        <PopoverMenuItem
          density="compact"
          icon={<Archive className="icon-paired" />}
          label="Archive"
          onClick={noop}
        />
      </div>
    </div>
  </div>
);

export const Disabled = () => (
  <div className={SURFACE}>
    <PopoverMenuItem icon={<Copy className="icon-paired" />} label="Copy session link" onClick={noop} />
    <PopoverMenuItem
      icon={<ExternalLink className="icon-paired" />}
      label="Open pull request"
      disabled
      onClick={noop}
    />
    <PopoverMenuItem
      icon={<Trash className="icon-paired" />}
      label="Delete workspace"
      disabled
      onClick={noop}
    />
  </div>
);
