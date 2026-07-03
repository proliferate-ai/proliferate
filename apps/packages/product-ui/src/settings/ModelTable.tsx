import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { Badge, type BadgeTone } from "@proliferate/ui/primitives/Badge";
import { Switch } from "@proliferate/ui/primitives/Switch";

export interface ModelTableEffort {
  values: readonly string[];
  /** The observed default effort value, visually highlighted among the chips. */
  default?: string | null;
}

export interface ModelTableRow {
  id: string;
  /** Falls back to `id` (caller-normalized); the monospace id line is shown only when it differs. */
  displayName: string;
  provider?: string | null;
  effort?: ModelTableEffort | null;
  fastMode?: boolean | null;
  status?: string | null;
  enabled: boolean;
  /** Toggle is read-only (e.g. runtime-resolved gateway rows have no override endpoint). */
  toggleDisabled?: boolean;
}

export interface ModelTableProps {
  models: readonly ModelTableRow[];
  onToggle: (id: string, enabled: boolean) => void;
  className?: string;
}

// Header/body cell classes mirror the design-system `.ds-mct` treatment
// (Design System Preview.html) translated onto product-ui tokens: 11px faint
// header on `accent`, 13px hairline-divided body rows, first row un-bordered.
const TH_CLASS =
  "border-b border-border bg-accent px-3 py-2 text-left text-[11px] font-medium whitespace-nowrap text-faint";
const TD_CLASS =
  "border-t border-border px-3 py-[11px] align-top text-[13px] whitespace-nowrap";

const STATUS_TONE: Record<string, BadgeTone> = {
  active: "success",
  candidate: "info",
  deprecated: "warning",
  hidden: "neutral",
};

function Dash() {
  return <span className="text-[12px] text-faint">—</span>;
}

function EffortChips({ effort }: { effort?: ModelTableEffort | null }) {
  if (!effort || effort.values.length === 0) {
    return <Dash />;
  }
  return (
    <span className="inline-flex flex-nowrap gap-1" aria-label="Thinking levels">
      {effort.values.map((value) => {
        const isDefault = value === effort.default;
        return (
          <span
            key={value}
            data-default={isDefault ? "true" : undefined}
            className={twMerge(
              "whitespace-nowrap rounded-[5px] border px-1.5 py-px text-[11px]",
              isDefault
                ? "border-border bg-accent font-medium text-foreground"
                : "border-border text-muted-foreground",
            )}
          >
            {value}
          </span>
        );
      })}
    </span>
  );
}

function FastModeCell({ fastMode }: { fastMode?: boolean | null }) {
  if (fastMode == null) {
    return <Dash />;
  }
  return fastMode ? <Badge tone="success">On</Badge> : <Badge tone="neutral">Off</Badge>;
}

function StatusCell({ status }: { status?: string | null }) {
  if (!status) {
    return <Dash />;
  }
  const tone = STATUS_TONE[status] ?? "neutral";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <Badge tone={tone}>{label}</Badge>;
}

/**
 * "All Models" catalog table (CONTRACT §2): a scroll-contained table with
 * Model · Provider · Thinking · Fast mode · Status · Enabled columns. Rows are
 * intentionally sparse — probe-only models carry only an id and render "—" for
 * every unknown cell. Styled after the design-system `.ds-mct` treatment.
 * `ModelConfigGrid` still backs the org agent-policy grid; only the All-Models
 * tab renders this table.
 */
export function ModelTable({ models, onToggle, className }: ModelTableProps) {
  return (
    <div
      className={twMerge(
        "overflow-x-auto rounded-[var(--radius)] border border-border",
        className,
      )}
    >
      <table className="w-full min-w-[720px] border-separate border-spacing-0 [&_tbody_tr:first-child>td]:border-t-0">
        <thead>
          <tr>
            <th className={TH_CLASS}>Model</th>
            <th className={TH_CLASS}>Provider</th>
            <th className={TH_CLASS}>Thinking</th>
            <th className={TH_CLASS}>Fast mode</th>
            <th className={TH_CLASS}>Status</th>
            <th className={twMerge(TH_CLASS, "text-right")}>Enabled</th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => {
            const showId = model.displayName !== model.id;
            return (
              <tr
                key={model.id}
                className={twMerge(
                  "transition-colors hover:bg-accent/40",
                  !model.enabled && "opacity-55",
                )}
              >
                <td className={twMerge(TD_CLASS, "max-w-[260px]")}>
                  <div className="truncate font-medium text-foreground">
                    {model.displayName}
                  </div>
                  {showId ? (
                    <div className="mt-[3px] truncate font-mono text-[12px] text-faint">
                      {model.id}
                    </div>
                  ) : null}
                </td>
                <td className={TD_CLASS}>
                  {model.provider ? (
                    <span className="text-foreground">{model.provider}</span>
                  ) : (
                    <Dash />
                  )}
                </td>
                <td className={TD_CLASS}>
                  <EffortChips effort={model.effort} />
                </td>
                <td className={TD_CLASS}>
                  <FastModeCell fastMode={model.fastMode} />
                </td>
                <td className={TD_CLASS}>
                  <StatusCell status={model.status} />
                </td>
                <td className={twMerge(TD_CLASS, "text-right")}>
                  <Switch
                    checked={model.enabled}
                    disabled={model.toggleDisabled}
                    size="compact"
                    onChange={(next) => onToggle(model.id, next)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
