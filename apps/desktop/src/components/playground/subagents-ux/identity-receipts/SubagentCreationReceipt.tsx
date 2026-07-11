import { useId, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronDown, ChevronRight } from "@proliferate/ui/icons";
import { shortDelegatedWorkId } from "@/lib/domain/delegated-work/identity";
import { SubagentIdentityGlyph } from "./SubagentIdentityGlyph";

export type ReceiptDensity = "compact" | "comfortable";

export interface SubagentReceiptModel {
  subagentId: string;
  title: string;
  harnessLabel: string;
  wakeScheduled: boolean;
  timestamp: string;
  prompt?: string;
}

export function SubagentCreationReceipt({
  model,
  density,
  onOpenSession,
}: {
  model: SubagentReceiptModel;
  density: ReceiptDensity;
  onOpenSession?: (subagentId: string) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  // The agent-authored task label is the sole human-readable name; the short
  // ID surfaces only in the disclosure details.
  const shortId = shortDelegatedWorkId(model.subagentId);
  const launchFragments = [
    model.harnessLabel,
    model.wakeScheduled ? "Wake scheduled" : null,
  ].filter((value): value is string => !!value);
  const compact = density === "compact";

  return (
    <div
      role="group"
      aria-label={`${model.title} subagent created`}
      className="flex min-w-0 flex-col items-start"
    >
      {/* Codex-style inline chip row: pill with glyph + authored task label,
          then a quiet verb. The chip itself is the disclosure trigger. */}
      <div className={`flex min-w-0 max-w-full items-center ${compact ? "gap-1.5" : "gap-2"}`}>
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          aria-label={detailsOpen ? `Hide details for ${model.title}` : `Show details for ${model.title}`}
          onClick={() => setDetailsOpen((open) => !open)}
          className={`group/receipt inline-flex min-w-0 max-w-64 items-center rounded-full border border-border/60 bg-foreground/5 hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border ${
            compact ? "h-6 gap-1 pl-1.5 pr-2" : "h-7 gap-1.5 pl-2 pr-2.5"
          }`}
        >
          <SubagentIdentityGlyph
            seed={model.subagentId}
            size={compact ? 13 : 15}
            label={`Identity mark for ${model.title}`}
          />
          <span
            className={`truncate font-medium text-foreground ${compact ? "text-xs" : "text-sm"}`}
            title={model.title}
          >
            {model.title}
          </span>
          {detailsOpen
            ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            : (
              <ChevronRight
                className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/receipt:opacity-100 group-focus-visible/receipt:opacity-100"
                aria-hidden="true"
              />
            )}
        </Button>
        <span className={`shrink-0 text-muted-foreground ${compact ? "text-xs" : "text-sm"}`}>
          created
        </span>
        {!compact && launchFragments.length > 0 ? (
          <span className="hidden min-w-0 truncate font-mono text-xs text-faint sm:inline">
            {launchFragments.join(" · ")}
          </span>
        ) : null}
      </div>
      {detailsOpen && (
        <div
          id={detailsId}
          className={`mt-1 flex w-fit max-w-full flex-col gap-1 rounded-md border border-border/60 bg-foreground/5 text-xs text-muted-foreground ${
            compact ? "px-2.5 py-1.5" : "px-3 py-2"
          }`}
        >
          <DetailRow label="ID" value={shortId} mono />
          <DetailRow label="Launch" value={launchFragments.join(" · ")} />
          <DetailRow label="Created" value={model.timestamp} />
          {model.prompt ? <DetailRow label="Prompt" value={model.prompt} /> : null}
          {onOpenSession ? (
            <div className="mt-1 flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2"
                onClick={() => onOpenSession(model.subagentId)}
              >
                Open agent session
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-14 shrink-0 text-faint">{label}</span>
      <span className={`min-w-0 truncate text-foreground/80 ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}
