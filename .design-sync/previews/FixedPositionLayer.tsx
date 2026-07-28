import {
  Badge,
  Button,
  FixedPositionLayer,
  Input,
  CheckCircleFilled,
  Clock,
  GitBranch,
  Pencil,
  Trash,
} from "@proliferate/ui";

// Ported from the manual chat-group editor: a portal-free panel pinned to a
// caller-measured point (the row's bounding rect), which is exactly what
// FixedPositionLayer exists for.
export const AnchoredGroupEditor = () => (
  <div className="relative h-96 w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-surface">
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      <Badge tone="accent">Review</Badge>
      <span className="text-ui text-muted-foreground">3 threads</span>
    </div>
    <FixedPositionLayer
      position={{ top: 56, left: 24 }}
      className="absolute w-72 rounded-xl border border-border bg-popover p-3 shadow-lg"
    >
      <div className="mb-3 text-ui font-medium text-foreground">Rename group</div>
      <div className="flex flex-col gap-2">
        <span className="text-ui-sm font-medium text-muted-foreground">Name</span>
        <Input aria-label="Group name" defaultValue="Review" />
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm">Cancel</Button>
        <Button type="button" size="sm">Save</Button>
      </div>
    </FixedPositionLayer>
  </div>
);

export const AnchoredContextMenu = () => (
  <div className="relative h-96 w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-surface">
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-ui text-foreground">
        <GitBranch className="icon-paired text-muted-foreground" />
        claude/design-sync-ui-import
      </div>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-ui text-muted-foreground">
        <GitBranch className="icon-paired" />
        release/2026.07
      </div>
    </div>
    <FixedPositionLayer
      position={{ top: 40, left: 200 }}
      className="absolute w-56 rounded-xl border border-border bg-popover p-1 shadow-lg"
    >
      <div className="flex items-center gap-2 rounded-lg bg-hover px-2 py-1.5 text-ui-sm text-foreground">
        <Pencil className="icon-paired text-muted-foreground" />
        Rename branch
      </div>
      <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-ui-sm text-foreground">
        <Clock className="icon-paired text-muted-foreground" />
        View 12 commits
      </div>
      <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-ui-sm text-destructive">
        <Trash className="icon-paired" />
        Delete branch
      </div>
    </FixedPositionLayer>
  </div>
);

export const CornerLayers = () => (
  <div className="relative h-96 w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-surface">
    <FixedPositionLayer
      position={{ top: 12, left: 12 }}
      className="absolute rounded-lg border border-border bg-surface-elevated px-2 py-1 text-ui-sm text-muted-foreground"
    >
      top / left
    </FixedPositionLayer>
    <FixedPositionLayer
      position={{ top: 12, right: 12 }}
      className="absolute rounded-lg border border-border bg-surface-elevated px-2 py-1 text-ui-sm text-muted-foreground"
    >
      top / right
    </FixedPositionLayer>
    <FixedPositionLayer
      position={{ bottom: 12, left: 12 }}
      className="absolute rounded-lg border border-border bg-surface-elevated px-2 py-1 text-ui-sm text-muted-foreground"
    >
      bottom / left
    </FixedPositionLayer>
    <FixedPositionLayer
      position={{ bottom: 12, right: 12 }}
      className="absolute flex items-center gap-2 rounded-lg border border-border bg-surface-elevated px-2 py-1 text-ui-sm text-foreground"
    >
      <CheckCircleFilled className="icon-paired text-success" />
      Sandbox ready
    </FixedPositionLayer>
  </div>
);

export const FixedOverlayBar = () => (
  <div className="h-96 w-full max-w-2xl">
    <div className="rounded-xl border border-border bg-surface p-4 text-ui text-muted-foreground">
      Transcript content scrolls under the pinned bar below.
    </div>
    <FixedPositionLayer
      position={{ bottom: 16, left: 16, right: 16 }}
      className="fixed flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-elevated px-4 py-3 shadow-lg"
    >
      <span className="text-ui text-foreground">3 files changed on claude/design-sync-ui-import</span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm">Discard</Button>
        <Button type="button" size="sm">Commit</Button>
      </div>
    </FixedPositionLayer>
  </div>
);
