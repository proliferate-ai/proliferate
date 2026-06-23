import { AlertCircle, Check, Search } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Input } from "@proliferate/ui/primitives/Input";
import { ProductNotice } from "../layout/ProductNotice";
import { PluginList, PluginListMessage, PluginRow } from "./PluginCards";
import { PluginConnectionModal } from "./PluginConnectionModal";
import type { PluginsSurfaceProps } from "./plugin-types";

export type {
  PluginCompletionNotice,
  PluginIconRenderer,
  PluginIconSize,
  PluginModalMode,
  PluginModalTab,
  PluginsSurfaceProps,
} from "./plugin-types";

export function PluginsSurface({
  items,
  query,
  loading,
  error,
  surface,
  selectedItem,
  modalMode,
  draft,
  submitting,
  pendingItemIds,
  modalError,
  completionNotice,
  canShare,
  canCancelSubmission,
  cancelingSubmission,
  shareOrganizationName,
  deleteTarget,
  deletePending,
  renderIcon,
  onQueryChange,
  onRetry,
  onOpenItem,
  onCloseItem,
  onCancelSubmission,
  onDraftSettingsChange,
  onDraftSecretChange,
  onSubmitSelected,
  onToggleEnabled,
  onShareChange,
  onOpenDocs,
  onOpenDesktop,
  onRequestDelete,
  onCloseDelete,
  onConfirmDelete,
}: PluginsSurfaceProps) {
  const pendingIds = useMemo(() => new Set(pendingItemIds), [pendingItemIds]);
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const searchEmpty = !loading && !error && items.length === 0 && hasQuery;
  const empty = !loading && !error && items.length === 0 && !hasQuery;

  return (
    <>
      <section className="space-y-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search integrations..."
            className="pl-9"
            aria-label="Search integrations"
          />
        </div>

        {completionNotice ? (
          <ProductNotice
            tone={completionNotice.tone}
            icon={completionNotice.tone === "destructive" ? <AlertCircle size={16} /> : <Check size={16} />}
            title={completionNotice.title}
            description={completionNotice.description}
          />
        ) : null}

        {loading && items.length === 0 ? <PluginListMessage title="Loading integrations" /> : null}

        {error && items.length === 0 ? (
          <PluginListMessage
            title="Couldn't load integrations"
            description={error}
            action={<Button variant="outline" onClick={onRetry}>Retry</Button>}
          />
        ) : null}

        {empty ? (
          <PluginListMessage title="No integrations are available right now." />
        ) : null}

        {searchEmpty ? (
          <PluginListMessage
            title={`No integrations match "${trimmedQuery}"`}
            description="Try a different search term."
          />
        ) : null}

        {items.length > 0 ? (
          <PluginList>
            {items.map((item) => {
              const mode = item.state === "installed" ? "manage" : "connect";
              return (
                <PluginRow
                  key={item.id}
                  item={item}
                  pending={pendingIds.has(item.id)}
                  renderIcon={renderIcon}
                  onOpen={() => onOpenItem(item, mode)}
                  onConnect={() => onOpenItem(item, mode)}
                  onDisconnect={() => onRequestDelete(item)}
                  onOpenDesktop={onOpenDesktop}
                />
              );
            })}
          </PluginList>
        ) : null}
      </section>

      <PluginConnectionModal
        item={selectedItem}
        mode={modalMode}
        draft={draft}
        submitting={submitting}
        error={modalError}
        surface={surface}
        canShare={canShare}
        canCancelSubmission={canCancelSubmission}
        cancelingSubmission={cancelingSubmission}
        shareOrganizationName={shareOrganizationName}
        onClose={onCloseItem}
        onCancelSubmission={onCancelSubmission}
        onDraftSettingsChange={onDraftSettingsChange}
        onDraftSecretChange={onDraftSecretChange}
        onSubmit={onSubmitSelected}
        onToggleEnabled={onToggleEnabled}
        onShareChange={onShareChange}
        onOpenDocs={onOpenDocs}
        onOpenDesktop={onOpenDesktop}
        onRequestDelete={onRequestDelete}
        renderIcon={renderIcon}
      />

      <ConfirmationDialog
        open={deleteTarget !== null}
        title={deleteTarget ? `Disconnect ${deleteTarget.entry.name}?` : "Disconnect integration?"}
        description="This removes the integration connection from personal cloud access. Existing sessions keep their transcript history."
        confirmLabel="Disconnect"
        confirmVariant="destructive"
        loading={deletePending}
        disableClose={deletePending}
        onClose={onCloseDelete}
        onConfirm={onConfirmDelete}
      />
    </>
  );
}
