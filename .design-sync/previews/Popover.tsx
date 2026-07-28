import {
  Badge,
  Button,
  ChevronDown,
  GitBranch,
  Popover,
  PopoverContent,
  PopoverMenuItem,
  PopoverTrigger,
  RefreshCw,
  Settings,
  Trash,
} from "@proliferate/ui";

const noop = () => {};

export const Open = () => (
  <Popover defaultOpen>
    <PopoverTrigger asChild>
      <Button variant="secondary" size="sm">
        <Settings className="icon-paired" />
        Run settings
        <ChevronDown className="icon-paired" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={6}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-ui-sm font-medium text-foreground">Cloud sandbox</span>
          <span className="text-ui-sm text-muted-foreground">
            4 vCPU · 8 GB · us-east-1
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <span className="text-ui-sm text-muted-foreground">Auto-shutdown</span>
          <Badge tone="success">30 min idle</Badge>
        </div>
      </div>
    </PopoverContent>
  </Popover>
);

export const MenuContent = () => (
  <Popover defaultOpen>
    <PopoverTrigger asChild>
      <Button variant="secondary" size="sm">
        <GitBranch className="icon-paired" />
        claude/design-sync-ui-import
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={6} className="w-72 p-1">
      <PopoverMenuItem icon={<RefreshCw className="icon-paired" />} label="Sync with origin/main" onClick={noop} />
      <PopoverMenuItem icon={<GitBranch className="icon-paired" />} label="Create branch from here" onClick={noop} />
      <PopoverMenuItem
        icon={<Trash className="icon-paired" />}
        label="Discard local changes"
        className="text-destructive hover:text-destructive"
        onClick={noop}
      />
    </PopoverContent>
  </Popover>
);

export const Closed = () => (
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="secondary" size="sm">
        <Settings className="icon-paired" />
        Run settings
        <ChevronDown className="icon-paired" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start">
      <span className="text-ui-sm text-foreground">Cloud sandbox settings</span>
    </PopoverContent>
  </Popover>
);
