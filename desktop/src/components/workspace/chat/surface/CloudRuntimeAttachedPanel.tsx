import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ComposerAttachedPanel } from "@/components/workspace/chat/input/ComposerAttachedPanel";
import { LoaderCircle } from "@/components/ui/icons";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";

function SectionRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-border/40 px-4 py-2">
      <span className="w-20 shrink-0 text-base font-medium uppercase tracking-[0.06em] text-muted-foreground/50">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function CloudRuntimeAttachedPanel() {
  const [expanded, setExpanded] = useState(true);
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const state = selectedCloudRuntime.state;

  if (!state || state.phase === "ready" || !state.title || !state.subtitle) {
    return null;
  }

  return (
    <ComposerAttachedPanel
      header={(
        <>
          <Badge className="shrink-0 rounded-full px-2 py-0.5 text-base">
            <span className="inline-flex items-center gap-1">
              {state.phase === "resuming" && <LoaderCircle className="size-3 animate-spin" />}
              <span>Cloud workspace</span>
            </span>
          </Badge>
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {state.title}
          </span>
          <span className="truncate text-sm text-muted-foreground">
            {state.subtitle}
          </span>
        </>
      )}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((value) => !value)}
    >
      <SectionRow label="Status">
        <span className="text-base text-muted-foreground">
          {state.actionBlockReason}
        </span>
      </SectionRow>
      {state.showRetry && selectedCloudRuntime.retry && (
        <SectionRow label="Actions">
          <Button
            size="sm"
            onClick={() => {
              selectedCloudRuntime.retry?.();
            }}
          >
            Retry
          </Button>
        </SectionRow>
      )}
    </ComposerAttachedPanel>
  );
}
