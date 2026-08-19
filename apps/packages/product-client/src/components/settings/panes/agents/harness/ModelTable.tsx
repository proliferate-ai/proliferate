import { twMerge } from "#product/primitives/utils/tw-merge";

export interface ModelTableRow {
  id: string;
  displayName: string;
  description?: string | null;
}

export interface ModelTableProps {
  models: readonly ModelTableRow[];
  className?: string;
}

const TH_CLASS =
  "border-b border-border bg-surface-elevated-secondary px-4 py-1.5 text-left text-ui-sm font-medium whitespace-nowrap text-faint";
const TD_CLASS = "border-t border-border px-4 py-2 align-top text-ui-sm";

/**
 * Read-only target-observed model inventory. Visibility switches and static
 * per-model tuning columns are intentionally absent: neither is executable
 * authority after the launch-options cutover.
 */
export function ModelTable({ models, className }: ModelTableProps) {
  return (
    <div className={twMerge(
      "overflow-x-auto overscroll-contain rounded-lg border border-border",
      className,
    )}>
      <table className="w-full border-separate border-spacing-0 [&_tbody_tr:first-child>td]:border-t-0">
        <thead>
          <tr><th className={TH_CLASS}>Model</th></tr>
        </thead>
        <tbody>
          {models.map((model) => {
            const showId = model.displayName !== model.id;
            return (
              <tr key={model.id} className="transition-colors hover:bg-hover">
                <td className={twMerge(TD_CLASS, "max-w-[520px]")}>
                  <div className="truncate text-ui font-medium text-foreground">
                    {model.displayName}
                  </div>
                  {model.description ? (
                    <div className="mt-[2px] truncate text-ui-sm text-muted-foreground">
                      {model.description}
                    </div>
                  ) : showId ? (
                    <div className="mt-[2px] truncate font-mono text-readable-code text-faint">
                      {model.id}
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
