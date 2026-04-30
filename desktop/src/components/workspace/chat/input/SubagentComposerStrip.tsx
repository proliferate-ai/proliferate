import { Button } from "@/components/ui/Button";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { ChevronDown, ProliferateIcon } from "@/components/ui/icons";
import { useSubagentComposerStrip } from "@/hooks/chat/subagents/use-subagent-composer-strip";
import { ComposerControlButton } from "@/components/workspace/chat/input/ComposerControlButton";
import { ComposerPopoverSurface } from "@/components/workspace/chat/input/ComposerPopoverSurface";
import { DelegatedWorkComposerPanel } from "@/components/workspace/chat/input/DelegatedWorkComposerPanel";

export function ConnectedSubagentComposerStrip() {
  const viewModel = useSubagentComposerStrip();
  if (!viewModel) {
    return null;
  }

  return (
    <SubagentComposerStrip
      rows={viewModel.rows}
      parent={viewModel.parent}
      summary={viewModel.summary}
      onOpenSubagent={viewModel.openSubagent}
      onOpenParent={viewModel.openParent}
    />
  );
}

interface SubagentComposerStripProps {
  rows: Array<{
    sessionLinkId: string;
    childSessionId: string;
    label: string;
    statusLabel: string;
    meta: string | null;
    latestCompletionLabel: string | null;
    wakeScheduled: boolean;
    color: string;
  }>;
  parent: {
    parentSessionId: string;
    label: string;
    meta: string | null;
  } | null;
  summary: {
    label: string;
    detail: string | null;
    active: boolean;
  };
  onOpenSubagent: (childSessionId: string) => void;
  onOpenParent: (parentSessionId: string) => void;
}

export function SubagentComposerStrip({
  rows,
  parent,
  summary,
  onOpenSubagent,
  onOpenParent,
}: SubagentComposerStripProps) {
  return (
    <DelegatedWorkComposerPanel>
      <SubagentComposerControl
        rows={rows}
        parent={parent}
        summary={summary}
        onOpenSubagent={onOpenSubagent}
        onOpenParent={onOpenParent}
      />
    </DelegatedWorkComposerPanel>
  );
}

export function SubagentComposerControl({
  rows,
  parent,
  summary,
  onOpenSubagent,
  onOpenParent,
}: SubagentComposerStripProps) {
  return (
    <PopoverButton
      side="top"
      align="start"
      offset={6}
      className="w-auto border-0 bg-transparent p-0 shadow-none"
      trigger={(
        <ComposerControlButton
          icon={<ProliferateIcon className="size-4" />}
          label={summary.label}
          detail={summary.detail}
          trailing={<ChevronDown className="size-3 text-[color:var(--color-composer-control-muted-foreground)]" />}
          active={summary.active}
          className="max-w-full"
          aria-label="Subagents"
        />
      )}
    >
      {(close) => (
        <ComposerPopoverSurface className="w-[min(28rem,calc(100vw-2rem))] p-0" data-telemetry-mask>
          <div className="border-b border-border px-3 py-2">
            <div className="text-sm font-medium text-foreground">{summary.label}</div>
            {summary.detail && (
              <div className="text-xs text-muted-foreground">{summary.detail}</div>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {parent && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-start gap-2 rounded-lg px-2 py-2 text-left"
                title={`Open ${parent.label}`}
                onClick={() => {
                  onOpenParent(parent.parentSessionId);
                  close();
                }}
              >
                <ProliferateIcon className="size-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {parent.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {parent.meta ?? "Parent agent"}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">Parent</span>
              </Button>
            )}
            {rows.map((row) => (
              <Button
                key={row.sessionLinkId}
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-start gap-2 rounded-lg px-2 py-2 text-left"
                title={`Open ${row.label}`}
                onClick={() => {
                  onOpenSubagent(row.childSessionId);
                  close();
                }}
              >
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-full"
                  style={{ color: row.color }}
                  aria-hidden="true"
                >
                  <ProliferateIcon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {row.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.meta ?? "Subagent"}
                  </span>
                </span>
                <span className={`shrink-0 text-xs ${statusClassName(row)}`}>
                  {row.wakeScheduled
                    ? "Wake scheduled"
                    : (row.latestCompletionLabel ?? row.statusLabel)}
                </span>
              </Button>
            ))}
          </div>
        </ComposerPopoverSurface>
      )}
    </PopoverButton>
  );
}

function statusClassName(row: SubagentComposerStripProps["rows"][number]): string {
  if (row.statusLabel === "Failed") {
    return "text-destructive";
  }
  if (row.statusLabel === "Working" || row.wakeScheduled) {
    return "text-foreground";
  }
  return "text-muted-foreground";
}
