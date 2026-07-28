import { useState } from "react";
import {
  AnimatedCollapsibleContent,
  Badge,
  Button,
  ChevronDown,
  ChevronRight,
  FileDiff,
  Terminal,
} from "@proliferate/ui";

const DIFF_LINES = [
  { path: "apps/packages/ui/src/patterns/ComposerTextarea.tsx", added: 12, removed: 3 },
  { path: "apps/packages/ui/src/primitives/Command.tsx", added: 41, removed: 0 },
  { path: "apps/packages/design/src/tokens/theme.css", added: 6, removed: 6 },
];

function DiffBody() {
  return (
    <div className="flex flex-col gap-1 pt-2">
      {DIFF_LINES.map((line) => (
        <div key={line.path} className="flex items-center justify-between gap-4">
          <span className="truncate text-ui-sm text-foreground">{line.path}</span>
          <span className="shrink-0 text-ui-sm">
            <span className="text-git-green">+{line.added}</span>{" "}
            <span className="text-git-red">−{line.removed}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export const Expanded = () => (
  <div className="w-96 rounded-lg border border-border bg-surface-elevated p-3">
    <div className="flex items-center gap-2">
      <ChevronDown className="icon-paired text-muted-foreground" />
      <FileDiff className="icon-paired text-muted-foreground" />
      <span className="text-ui text-foreground">Edited 3 files</span>
      <Badge tone="info">staged</Badge>
    </div>
    <AnimatedCollapsibleContent expanded>
      <DiffBody />
    </AnimatedCollapsibleContent>
  </div>
);

export const Collapsed = () => (
  <div className="w-96 rounded-lg border border-border bg-surface-elevated p-3">
    <div className="flex items-center gap-2">
      <ChevronRight className="icon-paired text-muted-foreground" />
      <FileDiff className="icon-paired text-muted-foreground" />
      <span className="text-ui text-foreground">Edited 3 files</span>
      <Badge tone="info">staged</Badge>
    </div>
    <AnimatedCollapsibleContent expanded={false}>
      <DiffBody />
    </AnimatedCollapsibleContent>
  </div>
);

export const ToolCallDisclosure = () => {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="w-96 rounded-lg border border-border bg-surface-elevated p-3">
      <Button
        variant="unstyled"
        size="unstyled"
        className="flex w-full items-center gap-2"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? (
          <ChevronDown className="icon-paired text-muted-foreground" />
        ) : (
          <ChevronRight className="icon-paired text-muted-foreground" />
        )}
        <Terminal className="icon-paired text-muted-foreground" />
        <span className="text-ui text-foreground">
          pnpm -F @proliferate/ui build
        </span>
        <span className="ml-auto text-ui-sm text-muted-foreground">exit 0</span>
      </Button>
      <AnimatedCollapsibleContent expanded={expanded}>
        <pre className="mt-2 overflow-x-auto rounded-md bg-code-block-background p-2 text-readable-code text-foreground">
{`> @proliferate/ui@0.1.0 build
> tsc -p tsconfig.build.json

Compiled 73 entry points in 4.2s`}
        </pre>
      </AnimatedCollapsibleContent>
    </div>
  );
};
