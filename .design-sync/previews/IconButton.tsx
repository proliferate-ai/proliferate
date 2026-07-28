import {
  IconButton,
  Copy,
  GitBranch,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash,
} from "@proliferate/ui";

const SIZES = [
  { size: "xs" as const, caption: "xs · 20px" },
  { size: "sm" as const, caption: "sm · 24px" },
  { size: "md" as const, caption: "md · 28px" },
];

export const Sizes = () => (
  <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface">
    <div className="border-b border-border px-4 py-2 text-ui text-foreground">Size scale</div>
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-8">
        <span className="w-24 shrink-0 text-ui-sm text-muted-foreground">rest</span>
        {SIZES.map((entry) => (
          <div key={entry.size} className="flex flex-col items-center gap-2">
            <IconButton size={entry.size} title={`Copy path (${entry.caption})`}>
              <Copy className="icon-paired" />
            </IconButton>
            <span className="text-ui-sm text-muted-foreground">{entry.caption}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-8">
        <span className="w-24 shrink-0 text-ui-sm text-muted-foreground">hover surface</span>
        {SIZES.map((entry) => (
          <div key={entry.size} className="flex flex-col items-center gap-2">
            {/* bg-hover is the component's own hover token — painting it makes
                the hit area (which is what `size` actually changes) visible. */}
            <IconButton size={entry.size} className="bg-hover text-foreground" title={`Copy path (${entry.caption})`}>
              <Copy className="icon-paired" />
            </IconButton>
            <span className="text-ui-sm text-muted-foreground">{entry.caption}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export const Tones = () => (
  <div className="flex w-full max-w-lg flex-col gap-4">
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-4 py-2 text-ui-sm text-muted-foreground">
        tone=&quot;default&quot; — content panes
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        <IconButton size="md" title="Rename thread"><Pencil className="icon-paired" /></IconButton>
        <IconButton size="md" title="Copy link"><Copy className="icon-paired" /></IconButton>
        <IconButton size="md" title="Refresh branches"><RefreshCw className="icon-paired" /></IconButton>
        <IconButton size="md" title="More actions"><MoreHorizontal className="icon-paired" /></IconButton>
        <IconButton size="md" className="bg-hover text-foreground" title="Delete (hover)">
          <Trash className="icon-paired" />
        </IconButton>
      </div>
    </div>
    <div className="overflow-hidden rounded-xl bg-sidebar-background">
      <div className="px-4 py-2 text-ui-sm text-sidebar-muted-foreground">
        tone=&quot;sidebar&quot; — sidebar rail
      </div>
      <div className="flex items-center gap-3 px-4 pb-3">
        <IconButton size="md" tone="sidebar" title="New thread"><Pencil className="icon-paired" /></IconButton>
        <IconButton size="md" tone="sidebar" title="Search threads"><Search className="icon-paired" /></IconButton>
        <IconButton size="md" tone="sidebar" title="Refresh"><RefreshCw className="icon-paired" /></IconButton>
        <IconButton size="md" tone="sidebar" title="Sidebar actions"><MoreHorizontal className="icon-paired" /></IconButton>
        <IconButton size="md" tone="sidebar" className="bg-hover text-sidebar-foreground" title="Delete (hover)">
          <Trash className="icon-paired" />
        </IconButton>
      </div>
    </div>
  </div>
);

export const States = () => (
  <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface">
    <div className="border-b border-border px-4 py-2 text-ui text-foreground">States</div>
    <div className="flex items-center gap-10 p-4">
      <div className="flex flex-col items-center gap-2">
        <IconButton size="md" title="Refresh branches"><RefreshCw className="icon-paired" /></IconButton>
        <span className="text-ui-sm text-muted-foreground">enabled</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <IconButton size="md" className="bg-hover text-foreground" title="Refresh branches">
          <RefreshCw className="icon-paired" />
        </IconButton>
        <span className="text-ui-sm text-muted-foreground">hover</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <IconButton size="md" disabled title="Refresh branches"><RefreshCw className="icon-paired" /></IconButton>
        <span className="text-ui-sm text-muted-foreground">disabled</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <IconButton size="md" disabled tone="sidebar" title="Delete workspace"><Trash className="icon-paired" /></IconButton>
        <span className="text-ui-sm text-muted-foreground">sidebar disabled</span>
      </div>
    </div>
  </div>
);

export const InRowContext = () => (
  <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card">
    {[
      { name: "main", detail: "updated 4 minutes ago" },
      { name: "claude/design-sync-ui-import", detail: "ahead 3 · behind 0" },
      { name: "release/2026.07", detail: "protected" },
    ].map((branch) => (
      <div key={branch.name} className="flex items-center gap-3 border-b border-border-light px-4 py-2 last:border-b-0">
        <GitBranch className="icon-paired shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui text-foreground">{branch.name}</span>
          <span className="block truncate text-ui-sm text-muted-foreground">{branch.detail}</span>
        </span>
        <IconButton title={`Copy ${branch.name}`}><Copy className="icon-paired" /></IconButton>
        <IconButton title={`Delete ${branch.name}`}><Trash className="icon-paired" /></IconButton>
      </div>
    ))}
  </div>
);
