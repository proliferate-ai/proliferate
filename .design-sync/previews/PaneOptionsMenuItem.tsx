import {
  Columns2,
  Copy,
  PaneOptionsMenuItem,
  RefreshCw,
  ShortcutBadge,
  SplitPanelRight,
  Terminal,
  Trash,
  WrapText,
} from "@proliferate/ui";

const SURFACE =
  "w-72 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-popover";

const noop = () => {};

export const PaneMenu = () => (
  <div className={SURFACE}>
    <PaneOptionsMenuItem icon={<SplitPanelRight className="icon-paired" />} label="Split pane right" onClick={noop} />
    <PaneOptionsMenuItem icon={<Columns2 className="icon-paired" />} label="Two-column layout" onClick={noop} />
    <PaneOptionsMenuItem icon={<RefreshCw className="icon-paired" />} label="Restart command" onClick={noop} />
    <PaneOptionsMenuItem icon={<Terminal className="icon-paired" />} label="Open in terminal" onClick={noop} />
    <PaneOptionsMenuItem
      icon={<Trash className="icon-paired" />}
      label="Close pane"
      className="text-destructive hover:text-destructive"
      onClick={noop}
    />
  </div>
);

export const WithTrailing = () => (
  <div className={SURFACE}>
    <PaneOptionsMenuItem
      icon={<Copy className="icon-paired" />}
      label="Copy pane output"
      trailing={<ShortcutBadge label="⌘C" />}
      onClick={noop}
    />
    <PaneOptionsMenuItem
      icon={<WrapText className="icon-paired" />}
      label="Wrap long lines"
      trailing={<span className="text-ui-sm">On</span>}
      onClick={noop}
    />
    <PaneOptionsMenuItem
      icon={<RefreshCw className="icon-paired" />}
      label="Restart command"
      trailing={<ShortcutBadge label="⌘R" />}
      onClick={noop}
    />
  </div>
);

export const IconSlotAlignment = () => (
  <div className="flex items-start gap-6">
    <div className="flex flex-col gap-2">
      <span className="text-ui-sm text-muted-foreground">reserveIconSlot</span>
      <div className={SURFACE}>
        <PaneOptionsMenuItem icon={<Terminal className="icon-paired" />} label="Open in terminal" onClick={noop} />
        <PaneOptionsMenuItem reserveIconSlot label="Clear scrollback" onClick={noop} />
        <PaneOptionsMenuItem reserveIconSlot label="Reset pane size" onClick={noop} />
      </div>
    </div>
    <div className="flex flex-col gap-2">
      <span className="text-ui-sm text-muted-foreground">no icon slot</span>
      <div className={SURFACE}>
        <PaneOptionsMenuItem label="Clear scrollback" onClick={noop} />
        <PaneOptionsMenuItem label="Reset pane size" onClick={noop} />
      </div>
    </div>
  </div>
);

export const Disabled = () => (
  <div className={SURFACE}>
    <PaneOptionsMenuItem icon={<SplitPanelRight className="icon-paired" />} label="Split pane right" onClick={noop} />
    <PaneOptionsMenuItem icon={<RefreshCw className="icon-paired" />} label="Restart command" disabled onClick={noop} />
    <PaneOptionsMenuItem icon={<Trash className="icon-paired" />} label="Close pane" disabled onClick={noop} />
  </div>
);
