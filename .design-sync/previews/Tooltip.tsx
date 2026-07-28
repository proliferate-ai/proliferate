import {
  Badge,
  Button,
  GitBranch,
  IconButton,
  Tooltip,
  Trash,
} from "@proliferate/ui";

const noop = () => {};

// NOTE: `Tooltip` is a Radix hover/focus tooltip and exposes no
// `open`/`defaultOpen` prop, so the bubble itself cannot appear in a static
// screenshot. These cells therefore show the real trigger surfaces the
// component wraps; the popover content is hover-only.

export const OnIconButtons = () => (
  <div className="flex items-center gap-1 rounded-lg border border-border p-2">
    <Tooltip content="Copy branch name">
      <IconButton title="Copy branch name" size="md" onClick={noop}>
        <GitBranch className="icon-paired" />
      </IconButton>
    </Tooltip>
    <Tooltip content="Delete this session — this cannot be undone.">
      <IconButton title="Delete session" size="md" onClick={noop}>
        <Trash className="icon-paired" />
      </IconButton>
    </Tooltip>
    <Tooltip content="Open the run in a new tab" singleLine>
      <Button size="sm" variant="secondary">Open run</Button>
    </Tooltip>
  </div>
);

export const OnTruncatedText = () => (
  <div className="flex w-[22rem] flex-col gap-2">
    <Tooltip content="server/agent/src/session/checkpointing/replay.rs">
      <span className="block w-full truncate text-ui text-foreground">
        server/agent/src/session/checkpointing/replay.rs
      </span>
    </Tooltip>
    <Tooltip content="claude/design-sync-ui-import — 14 commits ahead of main">
      <span className="block w-full truncate text-ui-sm text-muted-foreground">
        claude/design-sync-ui-import — 14 commits ahead of main
      </span>
    </Tooltip>
  </div>
);

export const OnStatusBadge = () => (
  <div className="flex items-center gap-2">
    <Tooltip content="3 checks failed on the latest push." singleLine>
      <Badge tone="destructive">Failing</Badge>
    </Tooltip>
    <Tooltip content="All 12 checks passed 6 minutes ago." singleLine>
      <Badge tone="success">Passing</Badge>
    </Tooltip>
    <Tooltip content="Waiting for the sandbox to warm up." singleLine>
      <Badge tone="info">Queued</Badge>
    </Tooltip>
  </div>
);
