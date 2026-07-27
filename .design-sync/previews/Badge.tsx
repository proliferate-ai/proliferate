import { Badge } from "@proliferate/ui";

export const Tones = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge tone="neutral">Neutral</Badge>
    <Badge tone="accent">Accent</Badge>
    <Badge tone="success">Passing</Badge>
    <Badge tone="info">In review</Badge>
    <Badge tone="warning">Degraded</Badge>
    <Badge tone="destructive">Failed</Badge>
    <Badge tone="sidebar">Sidebar</Badge>
  </div>
);

export const InContext = () => (
  <div className="flex flex-col gap-2">
    <div className="flex items-center gap-2">
      <span className="text-ui-sm text-foreground">Deploy #1482</span>
      <Badge tone="success">Passing</Badge>
    </div>
    <div className="flex items-center gap-2">
      <span className="text-ui-sm text-foreground">Deploy #1481</span>
      <Badge tone="destructive">Failed</Badge>
    </div>
  </div>
);
