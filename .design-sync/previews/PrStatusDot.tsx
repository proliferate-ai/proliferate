import { GitBranch, PrStatusDot } from "@proliferate/ui";

const STATES = [
  { kind: "open" as const, number: 805, caption: "Open" },
  { kind: "pending" as const, number: 806, caption: "Checks pending (hollow)" },
  { kind: "checks_failing" as const, number: 802, caption: "Checks failing" },
  { kind: "changes_requested" as const, number: 799, caption: "Changes requested" },
  { kind: "draft" as const, number: 811, caption: "Draft" },
  { kind: "merged" as const, number: 794, caption: "Merged" },
  { kind: "closed" as const, number: 788, caption: "Closed" },
];

// The dot is 6px, so a bare cell reads as empty — every cell below puts it
// where the product does: after a branch name in a row, or in a labelled
// legend.
export const AllStates = () => (
  <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card">
    {STATES.map((state) => (
      <div
        key={state.kind}
        className="flex items-center gap-2.5 border-b border-border-light px-3 py-2 last:border-b-0"
      >
        <PrStatusDot status={state} />
        <span className="min-w-0 flex-1 text-ui text-foreground">{state.caption}</span>
        <span className="text-ui-sm tabular-nums text-faint">#{state.number}</span>
      </div>
    ))}
  </div>
);

const WORKSPACES = [
  {
    title: "Sandbox idle-timeout reaper",
    branch: "fix/sandbox-idle-timeout",
    status: { kind: "open" as const, number: 805 },
    label: "#805",
  },
  {
    title: "Design-sync preview cards",
    branch: "claude/design-sync-ui-import",
    status: { kind: "pending" as const, number: 806 },
    label: "#806",
  },
  {
    title: "Token-based transcript highlighting",
    branch: "feat/token-highlighting",
    status: { kind: "checks_failing" as const, number: 802 },
    label: "#802",
  },
  {
    title: "Model catalog table",
    branch: "feat/model-catalog-table",
    status: { kind: "merged" as const, number: 794 },
    label: "#794",
  },
];

export const InWorkspaceRows = () => (
  <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card">
    {WORKSPACES.map((workspace) => (
      <div
        key={workspace.branch}
        className="flex items-center gap-3 border-b border-border-light px-3 py-2.5 last:border-b-0"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui text-foreground">{workspace.title}</span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <GitBranch className="icon-paired shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate text-ui-sm text-muted-foreground">
              {workspace.branch}
            </span>
            <PrStatusDot status={workspace.status} className="shrink-0" />
            <span className="text-ui-sm text-faint">{workspace.label}</span>
          </span>
        </span>
      </div>
    ))}
  </div>
);

export const CustomLabel = () => (
  <div className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-border bg-card p-4">
    <p className="text-ui-sm text-muted-foreground">
      `label` overrides the default `PR #n · State` tooltip; `withNativeTitle`
      is turned off when a Tooltip primitive already carries it.
    </p>
    <div className="flex items-center gap-2">
      <PrStatusDot
        status={{ kind: "changes_requested", number: 799, label: "2 reviewers requested changes" }}
      />
      <span className="text-ui text-foreground">proliferate-ai/proliferate #799</span>
    </div>
    <div className="flex items-center gap-2">
      <PrStatusDot status={{ kind: "merged", number: 794 }} withNativeTitle={false} />
      <span className="text-ui text-foreground">proliferate-ai/anyharness #794</span>
    </div>
  </div>
);
