import { Archive, CloudIcon, RefreshCw } from "@proliferate/ui/icons";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import {
  type ArchivedChatCleanupTone,
  type ArchivedChatRowView,
  useArchivedChatsPaneState,
} from "@/hooks/settings/facade/use-archived-chats-pane-state";
import { Button } from "@proliferate/ui/primitives/Button";

export function ArchivedChatsPane() {
  const {
    rows,
    isLoading,
    isRefreshing,
    error,
    backgroundRefreshFailed,
    refetch,
    unarchiveChat,
  } = useArchivedChatsPaneState();

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Archived chats"
        description="Archived chats are hidden from the main sidebar. Unarchive a chat to bring it back to active workspaces."
        action={
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={isRefreshing}
            onClick={() => { void refetch(); }}
            className="gap-2"
          >
            <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {backgroundRefreshFailed ? (
        <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
          Could not refresh archived chats. Showing the last loaded list.
        </div>
      ) : null}

      {isLoading ? (
        <div className="py-5 text-xs text-muted-foreground" role="status">
          Loading archived chats
        </div>
      ) : error && rows.length === 0 ? (
        <div className="py-5 text-xs text-muted-foreground" role="alert">
          Could not load archived chats.
        </div>
      ) : rows.length === 0 ? (
        <SettingsEmptyState
          size="compact"
          icon={<Archive aria-hidden="true" />}
          title="No archived chats"
          description="Archive a chat from the sidebar to move it here."
        />
      ) : (
        <div role="list" aria-label="Archived chats" className="divide-y divide-border">
          {rows.map((row) => (
            <ArchivedChatRow
              key={row.id}
              row={row}
              onUnarchive={() => unarchiveChat(row.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ArchivedChatRow({
  row,
  onUnarchive,
}: {
  row: ArchivedChatRowView;
  onUnarchive: () => void;
}) {
  return (
    <div
      role="listitem"
      className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-muted-foreground">
          {row.locationLabel === "Cloud"
            ? <CloudIcon className="size-4" />
            : <Archive className="size-4" />}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium leading-5 text-foreground">
            {row.title}
          </div>
          <div className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">
            {row.metadata}
          </div>
          <div className={`mt-1 truncate text-xs leading-4 ${cleanupToneClass(row.cleanupTone)}`}>
            {row.cleanupLabel}
          </div>
        </div>
      </div>

      <Button
        variant="secondary"
        size="sm"
        type="button"
        disabled={row.unarchiveDisabled}
        onClick={onUnarchive}
      >
        Unarchive
      </Button>
    </div>
  );
}

function cleanupToneClass(tone: ArchivedChatCleanupTone): string {
  switch (tone) {
    case "attention":
      return "text-warning";
    case "working":
      return "text-foreground";
    case "muted":
      return "text-muted-foreground";
  }
}
