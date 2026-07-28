import {
  Archive,
  Button,
  ChevronDown,
  Copy,
  ExternalLink,
  GitBranch,
  MoreHorizontal,
  PaneIconButton,
  PopoverButton,
  PopoverMenuItem,
  ShortcutBadge,
  Trash,
} from "@proliferate/ui";

const noop = () => {};

export const OpenMenu = () => (
  <PopoverButton
    externalOpen
    align="start"
    side="bottom"
    trigger={
      <Button variant="secondary" size="sm">
        <MoreHorizontal className="icon-paired" />
        Workspace actions
      </Button>
    }
  >
    {(close) => (
      <>
        <PopoverMenuItem icon={<Copy className="icon-paired" />} label="Copy session link" onClick={close} />
        <PopoverMenuItem icon={<GitBranch className="icon-paired" />} label="Switch branch…" onClick={close} />
        <PopoverMenuItem icon={<Archive className="icon-paired" />} label="Archive workspace" onClick={close} />
        <PopoverMenuItem
          icon={<Trash className="icon-paired" />}
          label="Delete workspace"
          className="text-destructive hover:text-destructive"
          onClick={close}
        />
      </>
    )}
  </PopoverButton>
);

export const WithShortcuts = () => (
  <PopoverButton
    externalOpen
    align="start"
    side="right"
    offset={8}
    trigger={
      <PaneIconButton label="Pane options">
        <MoreHorizontal className="icon-paired" />
      </PaneIconButton>
    }
  >
    {(close) => (
      <>
        <PopoverMenuItem
          icon={<Copy className="icon-paired" />}
          label="Copy pane output"
          trailing={<ShortcutBadge label="⌘C" />}
          onClick={close}
        />
        <PopoverMenuItem
          icon={<ExternalLink className="icon-paired" />}
          label="Open pull request"
          trailing={<ShortcutBadge label="⌘↩" />}
          onClick={close}
        />
      </>
    )}
  </PopoverButton>
);

export const ClosedTrigger = () => (
  <PopoverButton
    trigger={
      <Button variant="secondary" size="sm">
        <GitBranch className="icon-paired" />
        claude/design-sync-ui-import
        <ChevronDown className="icon-paired" />
      </Button>
    }
  >
    {() => <PopoverMenuItem label="Sync with origin/main" onClick={noop} />}
  </PopoverButton>
);
