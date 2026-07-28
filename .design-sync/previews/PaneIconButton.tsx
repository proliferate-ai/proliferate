import {
  Columns2,
  MoreHorizontal,
  PaneIconButton,
  RefreshCw,
  SplitPanelRight,
  Terminal,
  X,
} from "@proliferate/ui";

export const Default = () => (
  <div className="flex items-center gap-1">
    <PaneIconButton label="Split pane right">
      <SplitPanelRight className="icon-paired" />
    </PaneIconButton>
    <PaneIconButton label="Two-column layout">
      <Columns2 className="icon-paired" />
    </PaneIconButton>
    <PaneIconButton label="Restart command">
      <RefreshCw className="icon-paired" />
    </PaneIconButton>
    <PaneIconButton label="Close pane">
      <X className="icon-paired" />
    </PaneIconButton>
  </div>
);

export const States = () => (
  <div className="flex flex-col gap-4">
    <div className="flex items-center gap-3">
      <PaneIconButton label="Pane options">
        <MoreHorizontal className="icon-paired" />
      </PaneIconButton>
      <span className="text-ui-sm text-muted-foreground">Rest</span>
    </div>
    <div className="flex items-center gap-3">
      <PaneIconButton label="Two-column layout" active>
        <Columns2 className="icon-paired" />
      </PaneIconButton>
      <span className="text-ui-sm text-muted-foreground">Active — layout is applied</span>
    </div>
    <div className="flex items-center gap-3">
      <PaneIconButton label="Restart command" disabled>
        <RefreshCw className="icon-paired" />
      </PaneIconButton>
      <span className="text-ui-sm text-muted-foreground">Disabled — no command running</span>
    </div>
  </div>
);

export const PaneToolbar = () => (
  <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-surface">
    <div className="flex items-center justify-between gap-3 border-b border-border px-2 py-1">
      <div className="flex min-w-0 items-center gap-2 px-1">
        <Terminal className="icon-paired text-muted-foreground" />
        <span className="truncate text-ui-sm text-foreground">
          proliferate/server — cargo test -p proliferate-cloud
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <PaneIconButton label="Restart command">
          <RefreshCw className="icon-paired" />
        </PaneIconButton>
        <PaneIconButton label="Split pane right" active>
          <SplitPanelRight className="icon-paired" />
        </PaneIconButton>
        <PaneIconButton label="Pane options">
          <MoreHorizontal className="icon-paired" />
        </PaneIconButton>
        <PaneIconButton label="Close pane">
          <X className="icon-paired" />
        </PaneIconButton>
      </div>
    </div>
    <div className="flex flex-col gap-1 px-3 py-3 font-mono text-readable-code text-muted-foreground">
      <span>running 128 tests</span>
      <span>test cloud::sandbox::spawns_environment ... ok</span>
      <span className="text-foreground">test result: ok. 128 passed; 0 failed</span>
    </div>
  </div>
);
