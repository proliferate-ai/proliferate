import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { Badge } from "@proliferate/ui/primitives/Badge";
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
  /** Catalog description; when present it becomes the name-block subtitle and the id moves to a hover title. */
  description?: string | null;
  provider?: string | null;
  effort?: ModelTableEffort | null;
  /** The permission/agent modes the model supports (contract §5); "—" when absent. */
  modes?: readonly string[] | null;
  fastMode?: boolean | null;
  /**
   * Retained on the row type but no longer rendered (contract §5 dropped the Status
   * column until non-`active` statuses actually occur).
   */
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
// (Design System Preview.html) translated onto product-ui tokens: 10px faint
// header on `accent`, 11px hairline-divided body rows (dense reference table),
// first row un-bordered.
const TH_CLASS =
  "border-b border-border bg-accent px-3 py-1.5 text-left text-[10px] font-medium whitespace-nowrap text-faint";
const TD_CLASS =
  "border-t border-border px-3 py-1 align-top text-[11px] whitespace-nowrap";

function Dash() {
  return <span className="text-[11px] text-faint">—</span>;
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
              "whitespace-nowrap rounded-[5px] border px-1.5 py-px text-[10px]",
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

// Quiet mode pills (contract §5 / design-system `.ds-mct-pill`): a bordered,
// muted-foreground, un-highlighted treatment so Modes reads quieter than the
// Thinking chips (whose default value is bg-filled + medium-weight). Only the
// first MAX_VISIBLE_MODES render as pills; the rest collapse into a single
// "+N" overflow pill (review finding: six full-word pills pushed Fast
// mode/Enabled off-viewport). The cell's title attribute always lists every
// mode, comma-separated, so hovering reveals the full set.
const MAX_VISIBLE_MODES = 3;

function ModesPills({ modes }: { modes?: readonly string[] | null }) {
  if (!modes || modes.length === 0) {
    return <Dash />;
  }
  const visible = modes.slice(0, MAX_VISIBLE_MODES);
  const overflowCount = modes.length - visible.length;
  return (
    <span
      className="inline-flex flex-nowrap gap-1"
      aria-label="Modes"
      title={modes.join(", ")}
    >
      {visible.map((mode) => (
        <span
          key={mode}
          className="whitespace-nowrap rounded-[5px] border border-border px-1.5 py-px text-[10px] text-muted-foreground"
        >
          {mode}
        </span>
      ))}
      {overflowCount > 0 ? (
        <span className="whitespace-nowrap rounded-[5px] border border-border px-1.5 py-px text-[10px] text-muted-foreground">
          +{overflowCount}
        </span>
      ) : null}
    </span>
  );
}

/**
 * "All Models" catalog table (CONTRACT §2/§5): a scroll-contained table with
 * Model · Provider · Thinking · Modes · Fast mode · Enabled columns. Rows are
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
            <th className={TH_CLASS}>Modes</th>
            <th className={TH_CLASS}>Fast mode</th>
            <th className={twMerge(TH_CLASS, "text-right")}>Enabled</th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => {
            const showId = model.displayName !== model.id;
            // Subtitle precedence (contract §5): description wins; the id then
            // moves to a hover title on the name block. Absent description falls
            // back to the id subtitle, but only when it differs from the name.
            const hasDescription = Boolean(model.description);
            return (
              <tr
                key={model.id}
                className={twMerge(
                  "transition-colors hover:bg-accent/40",
                  !model.enabled && "opacity-55",
                )}
              >
                <td className={twMerge(TD_CLASS, "max-w-[260px]")}>
                  <div
                    className="truncate text-[12px] font-medium text-foreground"
                    title={hasDescription ? model.id : undefined}
                  >
                    {model.displayName}
                  </div>
                  {hasDescription ? (
                    <div className="mt-[2px] truncate text-[10px] leading-[1.4] text-muted-foreground">
                      {model.description}
                    </div>
                  ) : showId ? (
                    <div className="mt-[2px] truncate font-mono text-[10px] text-faint">
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
                  <ModesPills modes={model.modes} />
                </td>
                <td className={TD_CLASS}>
                  <FastModeCell fastMode={model.fastMode} />
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
