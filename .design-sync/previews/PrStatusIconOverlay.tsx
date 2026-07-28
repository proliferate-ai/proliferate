import { GitBranch, PrStatusIconOverlay } from "@proliferate/ui";

const ROWS = [
  {
    label: "Sandbox idle-timeout reaper",
    detail: "fix/sandbox-idle-timeout",
    status: { kind: "open" as const, number: 805 },
    active: true,
  },
  {
    label: "Design-sync preview cards",
    detail: "claude/design-sync-ui-import",
    status: { kind: "pending" as const, number: 806 },
    active: false,
  },
  {
    label: "Token-based highlighting",
    detail: "feat/token-highlighting",
    status: { kind: "checks_failing" as const, number: 802 },
    active: false,
  },
  {
    label: "Model catalog table",
    detail: "feat/model-catalog-table",
    status: { kind: "merged" as const, number: 794 },
    active: false,
  },
  {
    label: "Billing usage rollup",
    detail: "no pull request yet",
    status: null,
    active: false,
  },
];

// The dot-on-icon pattern from the web sidebar: the overlay anchors the PR dot
// on the bottom-right of a row's git glyph, and renders children unchanged
// when there is no PR.
export const SidebarWorkspaceRows = () => (
  <div className="w-64 rounded-lg bg-sidebar-background p-1">
    {ROWS.map((row) => (
      <div
        key={row.label}
        className={`flex h-10 items-center gap-2 rounded-md px-2 ${
          row.active ? "bg-selected" : ""
        }`}
      >
        <span className="flex w-4 shrink-0 items-center justify-center">
          <PrStatusIconOverlay status={row.status}>
            <GitBranch className="icon-paired text-sidebar-muted-foreground" />
          </PrStatusIconOverlay>
        </span>
        <span className="flex min-w-0 flex-1 flex-col justify-center">
          <span className="truncate text-sidebar-row text-sidebar-foreground">{row.label}</span>
          <span className="truncate text-ui-sm text-sidebar-muted-foreground">{row.detail}</span>
        </span>
      </div>
    ))}
  </div>
);

const STATES = [
  { kind: "open" as const, number: 805, caption: "Open" },
  { kind: "pending" as const, number: 806, caption: "Pending" },
  { kind: "checks_failing" as const, number: 802, caption: "Failing" },
  { kind: "changes_requested" as const, number: 799, caption: "Changes" },
  { kind: "draft" as const, number: 811, caption: "Draft" },
  { kind: "merged" as const, number: 794, caption: "Merged" },
];

export const EveryStateOnAGlyph = () => (
  <div className="flex w-full max-w-lg flex-wrap items-start gap-6 rounded-xl border border-border bg-card p-5">
    {STATES.map((state) => (
      <div key={state.kind} className="flex w-20 flex-col items-center gap-2">
        <PrStatusIconOverlay status={state}>
          <GitBranch className="size-5 text-muted-foreground" />
        </PrStatusIconOverlay>
        <span className="text-ui-sm text-muted-foreground">{state.caption}</span>
      </div>
    ))}
  </div>
);

export const PassthroughWithoutStatus = () => (
  <div className="flex w-full max-w-md items-center gap-6 rounded-xl border border-border bg-card p-5">
    <div className="flex flex-col items-center gap-2">
      <PrStatusIconOverlay status={null}>
        <GitBranch className="size-5 text-muted-foreground" />
      </PrStatusIconOverlay>
      <span className="text-ui-sm text-muted-foreground">status = null</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <PrStatusIconOverlay status={{ kind: "open", number: 805 }}>
        <GitBranch className="size-5 text-muted-foreground" />
      </PrStatusIconOverlay>
      <span className="text-ui-sm text-muted-foreground">status = open</span>
    </div>
    <p className="min-w-0 flex-1 text-ui-sm text-muted-foreground">
      With no status the children render untouched — no wrapper span, no dot.
    </p>
  </div>
);
