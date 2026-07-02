import type { FormEvent } from "react";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { Input } from "@proliferate/ui/primitives/Input";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import {
  ArrowRight,
  ExternalLink,
  Globe,
  RefreshCw,
  Spinner,
} from "@proliferate/ui/icons";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import type { RightPanelBrowserTab } from "@/lib/domain/workspaces/shell/right-panel-model";
import type { FrameStatus } from "./BrowserPanelTypes";

export function BrowserToolbar({
  activeDraft,
  activeStatus,
  activeTab,
  urlError,
  onDraftChange,
  onReload,
  onSubmit,
}: {
  activeDraft: string;
  activeStatus: FrameStatus;
  activeTab: RightPanelBrowserTab | null;
  urlError: boolean;
  onDraftChange: (tabId: string, value: string) => void;
  onReload: (tabId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { openExternal } = useTauriShellActions();

  return (
    <div className="shrink-0 border-b border-sidebar-border bg-sidebar-background">
      <form className="flex h-10 min-w-0 items-center gap-1.5 px-2" onSubmit={onSubmit}>
        <Tooltip content={activeStatus === "loading" ? "Loading" : "Reload"} singleLine>
          <IconButton
            type="button"
            size="xs"
            tone="sidebar"
            title={activeStatus === "loading" ? "Loading" : "Reload"}
            disabled={!activeTab?.url}
            onClick={() => {
              if (activeTab) {
                onReload(activeTab.id);
              }
            }}
          >
            {activeStatus === "loading"
              ? <Spinner className="size-3.5" />
              : <RefreshCw className="size-3.5" />}
          </IconButton>
        </Tooltip>
        <div className="mx-0.5 h-4 w-px shrink-0 bg-sidebar-border" aria-hidden="true" />
        <div className="relative min-w-0 flex-1">
          <Globe
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sidebar-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={activeDraft}
            disabled={!activeTab}
            placeholder="Enter URL or localhost port"
            className={`h-7 rounded-md border-sidebar-border bg-foreground/5 pl-7 pr-8 text-xs text-sidebar-foreground placeholder:text-sidebar-muted-foreground focus:ring-sidebar-border ${
              urlError ? "border-destructive" : ""
            }`}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={urlError}
            onChange={(event) => {
              if (activeTab) {
                onDraftChange(activeTab.id, event.target.value);
              }
            }}
          />
          <IconButton
            type="submit"
            size="xs"
            tone="sidebar"
            title="Navigate"
            disabled={!activeTab || !activeDraft.trim()}
            className="absolute right-1 top-1/2 size-5 -translate-y-1/2"
          >
            <ArrowRight className="size-3.5" />
          </IconButton>
        </div>
        <Tooltip content="Open externally" singleLine>
          <IconButton
            type="button"
            size="xs"
            tone="sidebar"
            title="Open externally"
            disabled={!activeTab?.url}
            onClick={() => {
              if (activeTab?.url) {
                void openExternal(activeTab.url);
              }
            }}
          >
            <ExternalLink className="size-3.5" />
          </IconButton>
        </Tooltip>
      </form>
      {urlError && (
        <p className="border-t border-sidebar-border px-3 py-1 text-base text-sidebar-muted-foreground">
          Enter a valid http or https URL, localhost host, or port.
        </p>
      )}
    </div>
  );
}
