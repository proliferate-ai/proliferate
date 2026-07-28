import { RecentWorkStatusDot } from "@proliferate/ui";

/** The six indicator views the cloud-work inventory produces, verbatim. */
const INDICATORS = [
  { kind: "needs_input", tone: "attention", label: "Needs input", hollow: false, live: false },
  { kind: "running", tone: "progress", label: "In progress", hollow: false, live: true },
  { kind: "review_ready", tone: "success", label: "Ready for review", hollow: false, live: false },
  { kind: "ready", tone: "success", label: "Ready", hollow: false, live: false },
  { kind: "error", tone: "danger", label: "Error", hollow: false, live: false },
  { kind: "idle", tone: "muted", label: "Idle", hollow: true, live: false },
];

/**
 * The dot is 6px by design, so it only reads as intentional beside its label:
 * this is the full legend, `showLabel` on, on the default surface.
 */
export const StatusLegend = () => (
  <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-surface-elevated p-4">
    <h3 className="text-heading text-foreground">Recent work</h3>
    {INDICATORS.map((indicator) => (
      <div key={indicator.kind} className="flex items-center justify-between gap-4">
        <RecentWorkStatusDot indicator={indicator} showLabel />
        <span className="text-ui-sm text-faint">{indicator.kind}</span>
      </div>
    ))}
  </div>
);

/** Label off: the bare dot as it appears in a dense inventory row. */
export const InInventoryRows = () => (
  <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-border">
    {[
      {
        title: "Retune the desktop sidebar rows",
        repo: "proliferate/proliferate",
        indicator: INDICATORS[1],
        time: "2m",
      },
      {
        title: "Enforce billing mode on workspace start",
        repo: "proliferate/cloud-control",
        indicator: INDICATORS[0],
        time: "26m",
      },
      {
        title: "PR status dots on sidebar rows",
        repo: "proliferate/proliferate",
        indicator: INDICATORS[2],
        time: "1h",
      },
      {
        title: "Prune stale worktrees on quit",
        repo: "anyharness/anyharness",
        indicator: INDICATORS[4],
        time: "Mon",
      },
      {
        title: "Draft release notes for 0.14",
        repo: "proliferate/proliferate",
        indicator: INDICATORS[5],
        time: "Jul 4",
      },
    ].map((row) => (
      <div
        key={row.title}
        className="flex items-center gap-3 border-b border-border-light px-4 py-3 last:border-b-0"
      >
        <RecentWorkStatusDot indicator={row.indicator} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui text-foreground">{row.title}</p>
          <p className="truncate text-ui-sm text-muted-foreground">{row.repo}</p>
        </div>
        <span className="shrink-0 text-ui-sm tabular-nums text-faint">{row.time}</span>
      </div>
    ))}
  </div>
);

/**
 * `surface="sidebar"` re-tones the two quiet states (attention and muted) onto
 * the sidebar's own ink so they do not shout inside the rail. The three
 * semantic tones — progress, success, danger — are unchanged.
 */
export const SurfaceTones = () => (
  <div className="flex w-full max-w-2xl gap-4">
    <div className="flex flex-1 flex-col gap-3 rounded-lg border border-border bg-surface-elevated p-4">
      <p className="text-ui-sm font-medium text-muted-foreground">surface="default"</p>
      {INDICATORS.map((indicator) => (
        <RecentWorkStatusDot key={indicator.kind} indicator={indicator} showLabel />
      ))}
    </div>
    <div className="flex flex-1 flex-col gap-3 rounded-lg border border-border bg-sidebar p-4">
      <p className="text-ui-sm font-medium text-sidebar-muted-foreground">surface="sidebar"</p>
      {INDICATORS.map((indicator) => (
        <RecentWorkStatusDot
          key={indicator.kind}
          indicator={indicator}
          surface="sidebar"
          showLabel
        />
      ))}
    </div>
  </div>
);
