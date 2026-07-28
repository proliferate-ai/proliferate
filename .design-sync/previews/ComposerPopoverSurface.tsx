import {
  Check,
  ClaudeSparkle,
  ComposerPopoverSurface,
  GitHub,
  PopoverMenuItem,
  Server,
  SquareTerminal,
  Switch,
} from "@proliferate/ui";

const noop = () => {};

// The click-in surface every composer control opens over: `default` is the
// 4px-padded blurred overlay used by the model / handoff pickers,
// `summary` is the taller unpadded card the integrations control uses.

export const ModelPicker = () => (
  <ComposerPopoverSurface className="w-72">
    <PopoverMenuItem
      icon={<ClaudeSparkle className="icon-paired" />}
      label="Claude Opus 4.6"
      trailing={<Check className="icon-paired" />}
      onClick={noop}
    >
      Best for long refactors
    </PopoverMenuItem>
    <PopoverMenuItem
      icon={<ClaudeSparkle className="icon-paired" />}
      label="Claude Sonnet 4.6"
      onClick={noop}
    >
      Default for new sessions
    </PopoverMenuItem>
    <PopoverMenuItem
      icon={<ClaudeSparkle className="icon-paired" />}
      label="Claude Haiku 4.5"
      onClick={noop}
    >
      Fast edits and reviews
    </PopoverMenuItem>
  </ComposerPopoverSurface>
);

export const HandoffModePicker = () => (
  <ComposerPopoverSurface className="w-64">
    <PopoverMenuItem
      label="Hand off the plan"
      trailing={<Check className="icon-paired" />}
      onClick={noop}
    />
    <PopoverMenuItem label="Hand off plan + transcript" onClick={noop} />
    <PopoverMenuItem label="Start a fresh session" onClick={noop} />
  </ComposerPopoverSurface>
);

export const SummaryVariant = () => (
  <ComposerPopoverSurface variant="summary" className="w-80">
    <div className="px-3 pb-1">
      <p className="text-ui font-medium text-foreground">Integrations</p>
      <p className="mt-0.5 text-ui-sm text-muted-foreground">
        Available to this session while it runs in the cloud sandbox.
      </p>
    </div>
    <div className="mt-2 flex flex-col">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <GitHub className="icon-paired shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-ui text-foreground">GitHub</span>
        </span>
        <Switch checked onChange={noop} />
      </div>
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <SquareTerminal className="icon-paired shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-ui text-foreground">Terminal</span>
        </span>
        <Switch checked onChange={noop} />
      </div>
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <Server className="icon-paired shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-ui text-foreground">Postgres — staging</span>
        </span>
        <Switch checked={false} onChange={noop} />
      </div>
    </div>
  </ComposerPopoverSurface>
);
